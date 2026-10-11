// Nokta Atışı - bot yapay zekâsı (Sim.prototype'a eklenir)
(function (root) {
  const D = typeof require !== 'undefined' && typeof module !== 'undefined' ? require('./data.js') : root.DATA;
  const S = typeof require !== 'undefined' && typeof module !== 'undefined' ? require('./sim.js') : root.SIM;
  const { TILE, COLS, ROWS, SITES, WEAPONS, RULES } = D;
  const { Sim, solid, angDiff } = S;

  const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // ---------- Yol bulma (hedef karesinden BFS mesafe alanı) ----------
  const fields = new Map();
  function field(tx, ty) {
    const key = ty * COLS + tx;
    let f = fields.get(key);
    if (f) return f;
    f = new Int16Array(COLS * ROWS).fill(-1);
    const q = [key];
    f[key] = 0;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], cx = c % COLS, cy = (c / COLS) | 0, d = f[c];
      for (const [dx, dy] of DIRS) {
        const nx = cx + dx, ny = cy + dy;
        if (solid(nx, ny)) continue;
        if (dx && dy && (solid(cx + dx, cy) || solid(cx, cy + dy))) continue;
        const n = ny * COLS + nx;
        if (f[n] !== -1) continue;
        f[n] = d + 1;
        q.push(n);
      }
    }
    fields.set(key, f);
    return f;
  }
  function nextTile(cx, cy, tx, ty) {
    const f = field(tx, ty);
    let best = null, bd = f[cy * COLS + cx];
    if (bd < 0) return null;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx, ny = cy + dy;
      if (solid(nx, ny)) continue;
      if (dx && dy && (solid(cx + dx, cy) || solid(cx, cy + dy))) continue;
      const v = f[ny * COLS + nx];
      if (v >= 0 && v < bd) { bd = v; best = [nx, ny]; }
    }
    return best;
  }

  // Bölge içindeki açık kareler
  function tilesIn(x0, y0, x1, y1) {
    const out = [];
    for (let y = Math.max(0, y0); y <= Math.min(ROWS - 1, y1); y++)
      for (let x = Math.max(0, x0); x <= Math.min(COLS - 1, x1); x++) if (!solid(x, y)) out.push([x, y]);
    return out;
  }
  const siteTiles = {}, siteCore = {};
  for (const k in SITES) {
    const s = SITES[k];
    const x0 = Math.floor(s.x / TILE), y0 = Math.floor(s.y / TILE);
    const x1 = Math.ceil((s.x + s.w) / TILE) - 1, y1 = Math.ceil((s.y + s.h) / TILE) - 1;
    siteTiles[k] = tilesIn(x0, y0, x1, y1);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    siteCore[k] = siteTiles[k].filter(([x, y]) => Math.abs(x - cx) <= 2 && Math.abs(y - cy) <= 1.5);
  }
  const stageTiles = { A: tilesIn(23, 4, 28, 7), B: tilesIn(23, 22, 28, 25) };
  const midTiles = tilesIn(33, 13, 36, 16);
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const tileOf = (x, y) => [Math.floor(x / TILE), Math.floor(y / TILE)];

  // ---------- Satın alma ----------
  function botBuy(sim, e) {
    const m = e.money;
    const pistol = sim.round === 1 || sim.round === RULES.HALF_AT + 1;
    const hasRifle = ['yildirim', 'kartal', 'sahin'].includes(e.inv[1]);
    if (!pistol && m < 1500 && Math.random() < 0.35) return; // ekonomi için tasarruf
    if (pistol) {
      if (m >= 850 && Math.random() < 0.5) { sim.buy(e, 'kasirga'); return; }
      sim.buy(e, 'hafif');
      return;
    }
    if (!hasRifle) {
      if (m >= 3900) { sim.buy(e, Math.random() < 0.2 ? 'sahin' : 'kartal'); }
      else if (m >= 2650) sim.buy(e, 'yildirim');
      else if (m >= 2000) sim.buy(e, Math.random() < 0.5 ? 'ari' : 'gurz');
      else if (m >= 1500) sim.buy(e, 'ari');
      else if (m >= 850) sim.buy(e, Math.random() < 0.5 ? 'kasirga' : 'firtina');
      else if (m >= 450 && !e.inv[1]) sim.buy(e, 'firtina');
    }
    if (e.money >= 1000 && e.armor < 50) sim.buy(e, 'agir');
    else if (e.money >= 400 && e.armor < 25) sim.buy(e, 'hafif');
  }

  // ---------- Raund başı ----------
  Sim.prototype.botRoundReset = function (e) {
    const sk = this.botSkill;
    e.bt = {
      skill: clamp(sk + rnd(-0.08, 0.08) + (e.team === 'def' ? 0.12 : 0), 0.1, 1),
      tid: 0, seeT: 0, react: 0.5, err: 0, errT: 0,
      burstT: 0, pauseT: 0, strafe: Math.random() < 0.5 ? 1 : -1, strafeT: 0,
      last: null, lastT: -99, hold: null, stage: null, post: null,
      stuckT: 0, px: e.x, py: e.y, wander: 0, wx: 0, wy: 0,
      look: e.ang, lookT: 0, abil: 3 + Math.random() * 5, t: 0,
    };
    botBuy(this, e);
  };

  Sim.prototype.botTeamPlan = function () {
    const site = Math.random() < 0.5 ? 'A' : 'B';
    const rush = Math.random() < 0.25;
    this.plan = { site, execAt: rush ? 0 : rnd(6, 22), t: 0, lastTick: -1, plant: pick(siteCore[site]) };
    const defs = this.players.filter((p) => p.team === 'def' && p.bot);
    const r0 = Math.random();
    const roles = r0 < 0.5 ? ['A', 'B', 'A', 'B', 'M'] : r0 < 0.75 ? ['A', 'A', 'A', 'B', 'M'] : ['B', 'B', 'B', 'A', 'M'];
    defs.forEach((p, i) => {
      const r = roles[i % 5];
      p.bt.hold = r === 'M' ? pick(midTiles) : pick(siteTiles[r]);
    });
    for (const p of this.players) {
      if (p.team !== 'atk' || !p.bot) continue;
      p.bt.stage = pick(stageTiles[site]);
      p.bt.hold = pick(siteTiles[site]);
    }
  };

  // ---------- Yardımcılar ----------
  function turnTo(e, b, target, dt, rate) {
    const d = angDiff(target, e.in.ang);
    const step = clamp(d, -rate * dt, rate * dt);
    e.in.ang = e.in.ang + step;
  }

  // Karenin merkezine git; vardıysa true
  function goTile(e, b, tx, ty, dt) {
    const inp = e.in;
    const [cx, cy] = tileOf(e.x, e.y);
    let gx, gy;
    if (cx === tx && cy === ty) {
      gx = (tx + 0.5) * TILE; gy = (ty + 0.5) * TILE;
      if (Math.hypot(gx - e.x, gy - e.y) < 9) return true;
    } else {
      const n = nextTile(cx, cy, tx, ty);
      if (!n) return true;
      gx = (n[0] + 0.5) * TILE; gy = (n[1] + 0.5) * TILE;
    }
    let dx = gx - e.x, dy = gy - e.y;
    const l = Math.hypot(dx, dy) || 1;
    dx /= l; dy /= l;
    // takılma tespiti
    b.stuckT += dt;
    if (b.stuckT > 0.5) {
      if (Math.hypot(e.x - b.px, e.y - b.py) < 6) b.wander = 0.35, b.wx = rnd(-1, 1), b.wy = rnd(-1, 1);
      b.stuckT = 0; b.px = e.x; b.py = e.y;
    }
    if (b.wander > 0) { b.wander -= dt; dx = b.wx; dy = b.wy; }
    inp.mx = dx; inp.my = dy;
    return false;
  }

  function useAbility(sim, e, b, kind, chance) {
    if (e.charges <= 0 || Math.random() > chance) return;
    const ag = sim.agentOf(e);
    if (ag.yetenek !== kind) return;
    e.pendingAbility = true;
  }

  function nearestAtkTo(sim, x, y) {
    let best = null, bd = 1e9;
    for (const p of sim.players) {
      if (p.team !== 'atk' || !p.alive || !p.bot) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  // ---------- Ana düşünme ----------
  Sim.prototype.botThink = function (e, dt) {
    const b = e.bt;
    const inp = e.in;
    inp.fire = false; inp.use = false; inp.walk = false; inp.mx = 0; inp.my = 0;
    if (!b || !e.alive || this.phase !== 'live') return;
    b.t += dt;
    const plan = this.plan;
    if (plan && plan.lastTick !== this.time) { plan.lastTick = this.time; plan.t += dt; }
    const sk = b.skill;
    const sp = this.spike;
    const w = WEAPONS[e.cur];
    const am = e.ammo[e.cur];

    // ----- hedef bul -----
    let target = null, bd = 1e9;
    if (e.blindT <= 0) {
      for (const p of this.players) {
        if (!p.alive || p.team === e.team) continue;
        const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy);
        if (d > RULES.VIEW_RANGE) continue;
        if (d > 70 && Math.abs(angDiff(e.ang, Math.atan2(dy, dx))) > 1.35) continue;
        if (!this.canSee(e.x, e.y, p.x, p.y)) continue;
        if (d < bd) { bd = d; target = p; }
      }
    }
    // vurulduysa saldırana dön
    if (!target && this.time - e.lastHurt < 0.35) {
      let bt = -1, who = null;
      for (const id in e.dmgFrom) if (e.dmgFrom[id] > bt) { bt = e.dmgFrom[id]; who = this.byId.get(+id); }
      if (who && who.alive) { b.last = { x: who.x, y: who.y }; b.lastT = this.time; }
    }

    if (target) {
      if (b.tid !== target.id) {
        b.tid = target.id; b.seeT = 0;
        b.react = (0.8 - 0.55 * sk) * rnd(0.7, 1.3);
      }
      b.seeT += dt;
      b.last = { x: target.x, y: target.y }; b.lastT = this.time;
      if (e.team === 'def' && plan) {
        // takıma haber ver: hangi bölgede düşman var
        const sa = Math.hypot(target.x - (SITES.A.x + SITES.A.w / 2), target.y - (SITES.A.y + SITES.A.h / 2));
        const sb = Math.hypot(target.x - (SITES.B.x + SITES.B.w / 2), target.y - (SITES.B.y + SITES.B.h / 2));
        plan.alert = sa < sb ? 'A' : 'B';
        plan.alertT = this.time;
      }
      b.errT -= dt;
      if (b.errT <= 0) { b.errT = 0.35; b.err = rnd(-1, 1) * (0.12 * (1 - sk) + 0.012) * (1 + bd / 700); }
      const want = Math.atan2(target.y - e.y, target.x - e.x) + b.err;
      turnTo(e, b, want, dt, 2.5 + 9 * sk);
      const aligned = Math.abs(angDiff(want, inp.ang)) < Math.atan2(RULES.PLAYER_R, bd) * 1.2 + 0.05;
      const canFire = b.seeT >= b.react && aligned && bd <= w.range * 0.95 && am && am.mag > 0 && e.reloadT <= 0 && !e.plantP;
      if (canFire) {
        if (w.auto) {
          if (b.burstT > 0) { inp.fire = true; b.burstT -= dt; if (b.burstT <= 0) b.pauseT = rnd(0.1, 0.3) * (1.3 - sk); }
          else if (b.pauseT > 0) b.pauseT -= dt;
          else b.burstT = rnd(0.15, 0.5);
        } else {
          inp.fire = !e.fireHeld;
        }
      }
      // hareket: ateşte dur, aralarda yana kay
      const standing = inp.fire || w.id === 'sahin' || b.burstT > 0;
      if (bd > w.range * 0.85) {
        const [tx, ty] = tileOf(target.x, target.y);
        goTile(e, b, tx, ty, dt);
      } else if (!standing) {
        b.strafeT -= dt;
        if (b.strafeT <= 0) { b.strafe = -b.strafe; b.strafeT = rnd(0.4, 1.0); }
        const a = Math.atan2(target.y - e.y, target.x - e.x) + Math.PI / 2;
        inp.mx = Math.cos(a) * b.strafe; inp.my = Math.sin(a) * b.strafe;
      }
      // yetenekler
      b.abil -= dt;
      if (b.abil <= 0) {
        b.abil = rnd(2, 5);
        useAbility(this, e, b, 'flas', bd < 420 ? 0.7 : 0);
        useAbility(this, e, b, 'duman', bd > 450 ? 0.4 : 0);
      }
      return;
    }
    b.tid = 0;
    b.seeT = 0;
    b.burstT = 0;

    // son görülen yere bak (kısa süre)
    const recent = b.last && this.time - b.lastT < 0.9;
    if (recent) {
      turnTo(e, b, Math.atan2(b.last.y - e.y, b.last.x - e.x), dt, 3 + 8 * sk);
      if (this.time - b.lastT < 0.5) return; // bir an dur
    }

    // şarjör
    if (am && w.mag > 0 && am.mag < w.mag * 0.4 && am.res > 0 && e.reloadT <= 0) inp.reload = true;
    // iyileşme
    if (e.hp < 55) useAbility(this, e, b, 'sifa', 0.05);

    // ----- hedef belirle -----
    let goal = null, hold = false, plantNow = false, defuseNow = false;
    const atkExec = plan && (plan.t >= plan.execAt || this.timer < 20);
    if (e.team === 'atk') {
      if (sp.state === 'planted') {
        if (!b.post || b.postRd !== this.round) {
          const site = sp.site || (plan && plan.site) || 'A';
          const cand = siteTiles[site].filter(([x, y]) => {
            const cx = (x + 0.5) * TILE, cy = (y + 0.5) * TILE;
            const d = Math.hypot(cx - sp.x, cy - sp.y);
            return d > 50 && d < 260 && this.hasLOS(cx, cy, sp.x, sp.y);
          });
          b.post = pick(cand.length ? cand : siteTiles[site]); b.postRd = this.round;
        }
        goal = b.post; hold = true;
      } else if (sp.state === 'dropped' && nearestAtkTo(this, sp.x, sp.y) === e) {
        goal = tileOf(sp.x, sp.y);
      } else if (sp.state === 'carried' && sp.carrier === e.id) {
        if (atkExec) {
          goal = plan.plant;
          const [tx, ty] = tileOf(e.x, e.y);
          if (tx === goal[0] && ty === goal[1] && Math.hypot((goal[0] + 0.5) * TILE - e.x, (goal[1] + 0.5) * TILE - e.y) < 12) plantNow = true;
          else if (this.plantOk(e)) plantNow = Math.hypot((goal[0] + 0.5) * TILE - e.x, (goal[1] + 0.5) * TILE - e.y) < 70;
        } else goal = b.stage;
      } else {
        goal = atkExec ? b.hold : b.stage; hold = true;
      }
    } else {
      if (sp.state === 'planted') {
        goal = tileOf(sp.x, sp.y);
        const d = Math.hypot(sp.x - e.x, sp.y - e.y);
        if (d < 30) {
          if (sp.defuser === 0 || sp.defuser === e.id) defuseNow = true;
        }
      } else {
        goal = b.hold; hold = true;
        if (plan && plan.alert && this.time - plan.alertT < 25 && this.time - plan.alertT > 0.3) {
          if (b.alertSite !== plan.alert) { b.alertSite = plan.alert; b.alertHold = pick(siteTiles[plan.alert]); }
          goal = b.alertHold;
        }
      }
    }
    if (!goal) return;

    if (defuseNow || plantNow) {
      inp.use = true; // sabit dur
      turnTo(e, b, b.look, dt, 4);
      return;
    }
    // defans: spike'a yakınken doğrudan yürü
    if (e.team === 'def' && sp.state === 'planted' && Math.hypot(sp.x - e.x, sp.y - e.y) < 70) {
      const dx = sp.x - e.x, dy = sp.y - e.y, l = Math.hypot(dx, dy) || 1;
      inp.mx = dx / l; inp.my = dy / l;
      turnTo(e, b, Math.atan2(dy, dx), dt, 6);
      return;
    }
    const arrived = goTile(e, b, goal[0], goal[1], dt);
    // yetenek kullanımı
    b.abil -= dt;
    if (b.abil <= 0) {
      b.abil = rnd(3, 7);
      const dist = Math.hypot((goal[0] + 0.5) * TILE - e.x, (goal[1] + 0.5) * TILE - e.y);
      if (e.team === 'atk' && atkExec && dist < 420 && dist > 150) { useAbility(this, e, b, 'hiz', 0.6); useAbility(this, e, b, 'duman', 0.5); }
      useAbility(this, e, b, 'radar', dist < 500 ? 0.6 : 0.1);
    }
    if (arrived && hold) {
      // bekle ve çevreyi tara
      b.lookT -= dt;
      if (b.lookT <= 0) {
        b.lookT = rnd(0.8, 2);
        const cx = e.team === 'atk' ? 44 * TILE : 3 * TILE, cy = 15 * TILE;
        const sites = e.team === 'atk' ? siteCore[(plan && plan.site) || 'A'][0] : null;
        const tx = sites ? (sites[0] + 0.5) * TILE : cx;
        const ty = sites ? (sites[1] + 0.5) * TILE : cy;
        b.look = Math.atan2(ty - e.y, tx - e.x) + rnd(-0.7, 0.7);
      }
      turnTo(e, b, b.look, dt, 3);
    } else if (inp.mx || inp.my) {
      turnTo(e, b, Math.atan2(inp.my, inp.mx), dt, 5 + 6 * sk);
      b.look = inp.ang;
    }
  };

  // Spike kurma uygunluğu
  Sim.prototype.plantOk = function (e) {
    const x = e.x, y = e.y;
    for (const k in SITES) {
      const s = SITES[k];
      if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return true;
    }
    return false;
  };

  const api = { siteTiles };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BOTS = api;
})(typeof window !== 'undefined' ? window : globalThis);
