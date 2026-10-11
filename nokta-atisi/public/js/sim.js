// Nokta Atışı - oyun simülasyonu (ev sahibinde ya da çevrimdışı modda çalışır)
(function (root) {
  const D = typeof require !== 'undefined' && typeof module !== 'undefined' ? require('./data.js') : root.DATA;
  const { TILE, COLS, ROWS, grid, SITES, SPAWNS, WEAPONS, ARMORS, AGENTS, RULES, ECO } = D;
  const R = RULES.PLAYER_R;

  // Öldürme ödülü silaha göre değişir
  const KILL_REWARD = { bicak: 150, ari: 150, sahin: 100 };

  // ---------- Dünya yardımcıları ----------
  function solid(tx, ty) {
    return tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS || grid[ty][tx] === 1;
  }
  function collides(x, y, r) {
    const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE);
    const y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!solid(tx, ty)) continue;
        const cx = Math.max(tx * TILE, Math.min(x, (tx + 1) * TILE));
        const cy = Math.max(ty * TILE, Math.min(y, (ty + 1) * TILE));
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy < r * r) return true;
      }
    }
    return false;
  }
  // Işın duvara kaç piksel sonra çarpıyor (DDA)
  function raycast(x, y, ang, maxD) {
    const dx = Math.cos(ang), dy = Math.sin(ang);
    let tx = Math.floor(x / TILE), ty = Math.floor(y / TILE);
    if (solid(tx, ty)) return 0;
    const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1;
    const tdx = dx === 0 ? Infinity : Math.abs(TILE / dx);
    const tdy = dy === 0 ? Infinity : Math.abs(TILE / dy);
    let nx = dx === 0 ? Infinity : (dx > 0 ? (tx + 1) * TILE - x : x - tx * TILE) / Math.abs(dx);
    let ny = dy === 0 ? Infinity : (dy > 0 ? (ty + 1) * TILE - y : y - ty * TILE) / Math.abs(dy);
    for (;;) {
      let d;
      if (nx < ny) { d = nx; nx += tdx; tx += sx; } else { d = ny; ny += tdy; ty += sy; }
      if (d >= maxD) return maxD;
      if (solid(tx, ty)) return d;
    }
  }
  function distToSeg(px, py, ax, ay, bx, by) {
    const vx = bx - ax, vy = by - ay;
    const l2 = vx * vx + vy * vy;
    let t = l2 === 0 ? 0 : ((px - ax) * vx + (py - ay) * vy) / l2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + vx * t, cy = ay + vy * t;
    return Math.hypot(px - cx, py - cy);
  }
  function angDiff(a, b) {
    let d = a - b;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
  }
  function inSiteRect(x, y) {
    for (const k in SITES) {
      const s = SITES[k];
      if (x >= s.x && x <= s.x + s.w && y >= s.y && y <= s.y + s.h) return k;
    }
    return null;
  }

  // ---------- Simülasyon ----------
  class Sim {
    // opts.players: [{id, name, bot, squad}]  squad: 0 | 1  (0 ilk başta saldıran)
    constructor(opts) {
      this.players = [];
      this.byId = new Map();
      this.events = [];
      this.smokes = [];
      this.time = 0;
      this.round = 0;
      this.score = [0, 0];
      this.swapped = false;      // taraflar değişti mi
      this.lossStreak = [0, 0];
      this.phase = 'buy';
      this.timer = 0;
      this.spike = { state: 'carried', x: 0, y: 0, carrier: 0, progress: 0, checkpoint: false, defuser: 0, site: null, planter: 0 };
      this.lastWinSquad = -1;
      this.over = false;
      this.matchWinner = -1;
      this.botSkill = opts.skill == null ? 0.6 : opts.skill;
      this.plan = null;
      this._setupPlayers(opts.players);
      this.startRound(true);
    }

    sideOf(squad) { return (squad === 0) !== this.swapped ? 'atk' : 'def'; }

    _setupPlayers(list) {
      const count = [0, 0];
      for (const p of list) {
        const squad = p.squad;
        const side = this.sideOf(squad);
        const agent = AGENTS[side][count[squad] % 5];
        const e = {
          id: p.id, name: p.name, bot: !!p.bot, squad, team: side, agent: agent.id, slotIdx: count[squad],
          x: 0, y: 0, ang: 0, hp: 100, armor: 0, alive: true, money: ECO.START,
          inv: { 1: null, 2: 'caylak', 3: 'bicak' }, cur: 'caylak', ammo: {}, paid: {},
          reloadT: 0, fireCd: 0, fireHeld: false, spd: 0,
          kills: 0, deaths: 0, assists: 0, roundKills: 0,
          charges: 0, boostT: 0, blindT: 0, healLeft: 0, revealT: 0, revealTeam: '',
          dmgFrom: {},          // saldıran id -> son hasar zamanı
          in: { mx: 0, my: 0, ang: 0, fire: false, walk: false, reload: false, use: false },
          pendingAbility: false, plantP: 0, lastShot: -9, lastHurt: -9, bt: null,
        };
        count[squad]++;
        this.players.push(e);
        this.byId.set(e.id, e);
      }
    }

    emit(ev) { this.events.push(ev); }
    drainEvents() { const e = this.events; this.events = []; return e; }

    agentOf(e) { return AGENTS[e.team].find((a) => a.id === e.agent); }

    giveAmmo(e) {
      e.ammo = {};
      for (const slot of [1, 2]) {
        const id = e.inv[slot];
        if (id) e.ammo[id] = { mag: WEAPONS[id].mag, res: WEAPONS[id].res };
      }
    }
    bestWeapon(e) { return e.inv[1] || e.inv[2] || 'bicak'; }

    // ---------- Raund akışı ----------
    startRound(first) {
      this.round++;
      this.phase = 'buy';
      this.timer = RULES.BUY_TIME;
      this.smokes = [];
      const half = this.round === RULES.HALF_AT + 1;
      if (half) {
        this.swapped = !this.swapped;
        this.lossStreak = [0, 0];
      }
      const fresh = first || half;
      const slotCount = { atk: 0, def: 0 };
      for (const e of this.players) {
        e.team = this.sideOf(e.squad);
        const ag = AGENTS[e.team][e.slotIdx % 5];
        e.agent = ag.id;
        if (fresh) {
          e.money = ECO.START;
          e.inv = { 1: null, 2: 'caylak', 3: 'bicak' };
          e.armor = 0;
        } else if (!e.alive) {
          e.inv = { 1: null, 2: 'caylak', 3: 'bicak' };
          e.armor = 0;
        }
        e.alive = true;
        e.hp = RULES.HP;
        e.paid = {};
        e.dmgFrom = {};
        e.roundKills = 0;
        e.reloadT = 0; e.fireCd = 0; e.fireHeld = false;
        e.boostT = 0; e.blindT = 0; e.healLeft = 0; e.revealT = 0;
        e.plantP = 0;
        e.charges = ag.yetenek === 'duman' || ag.yetenek === 'flas' ? 2 : 1;
        this.giveAmmo(e);
        e.cur = this.bestWeapon(e);
        const sp = SPAWNS[e.team][slotCount[e.team]++ % 5];
        e.x = sp.x; e.y = sp.y;
        e.ang = e.team === 'atk' ? 0 : Math.PI;
        e.in.ang = e.ang;
        e.spd = 0;
        if (e.bot) this.botRoundReset(e);
      }
      this.spike = { state: 'none', x: 0, y: 0, carrier: 0, progress: 0, checkpoint: false, defuser: 0, site: null, planter: 0 };
      const atk = this.players.filter((p) => p.team === 'atk');
      if (atk.length) {
        const c = atk[Math.floor(Math.random() * atk.length)];
        this.spike.state = 'carried';
        this.spike.carrier = c.id;
        this.spike.x = c.x; this.spike.y = c.y;
      }
      if (this.botTeamPlan) this.botTeamPlan();
      this.emit({ e: 'phase', ph: 'buy', rd: this.round, half });
    }

    beginLive() {
      this.phase = 'live';
      this.timer = RULES.ROUND_TIME;
      this.emit({ e: 'phase', ph: 'live', rd: this.round });
    }

    teamAlive(team) { return this.players.filter((p) => p.team === team && p.alive).length; }

    endRound(winSquad, reason) {
      if (this.phase !== 'live') return;
      this.phase = 'end';
      this.timer = RULES.END_TIME;
      this.score[winSquad]++;
      const loseSquad = 1 - winSquad;
      // ekonomi
      for (const e of this.players) {
        if (e.squad === winSquad) {
          e.money = Math.min(ECO.MAX, e.money + ECO.WIN);
        } else {
          const idx = Math.min(this.lossStreak[loseSquad], ECO.LOSS.length - 1);
          e.money = Math.min(ECO.MAX, e.money + ECO.LOSS[idx]);
        }
      }
      this.lossStreak[winSquad] = 0;
      this.lossStreak[loseSquad]++;
      this.lastWinSquad = winSquad;
      this.emit({ e: 'roundEnd', win: winSquad, reason, sc: this.score.slice(), winSide: this.sideOf(winSquad) });
      if (this.score[winSquad] >= RULES.WIN_ROUNDS) {
        this.over = true;
        this.matchWinner = winSquad;
        this.emit({ e: 'matchEnd', win: winSquad, sc: this.score.slice() });
      }
    }

    checkWin() {
      if (this.phase !== 'live') return;
      const sp = this.spike;
      const atkAlive = this.teamAlive('atk');
      const defAlive = this.teamAlive('def');
      const atkSq = this.players.find((p) => p.team === 'atk');
      const defSq = this.players.find((p) => p.team === 'def');
      if (!atkSq || !defSq) return;
      if (defAlive === 0) return this.endRound(atkSq.squad, 'elim');
      if (sp.state === 'planted') {
        if (this.timer <= 0) return this.explode();
      } else {
        if (atkAlive === 0) return this.endRound(defSq.squad, 'elim');
        if (this.timer <= 0) return this.endRound(defSq.squad, 'time');
      }
    }

    explode() {
      const sp = this.spike;
      sp.state = 'exploded';
      const atkSq = this.players.find((p) => p.team === 'atk');
      this.emit({ e: 'explode', x: sp.x, y: sp.y });
      this.endRound(atkSq.squad, 'explode');
      for (const p of this.players) {
        if (!p.alive) continue;
        const d = Math.hypot(p.x - sp.x, p.y - sp.y);
        if (d < 420) { p.hp = 0; p.alive = false; p.deaths++; this.emit({ e: 'kill', k: 0, v: p.id, w: 'spike' }); }
      }
    }

    // ---------- Komutlar (satın alma vb.) ----------
    command(id, cmd) {
      const e = this.byId.get(id);
      if (!e || !cmd) return;
      if (cmd.t === 'buy') this.buy(e, cmd.item);
    }
    buy(e, item) {
      if (this.phase !== 'buy' || !e.alive) return false;
      if (ARMORS[item]) {
        const a = ARMORS[item];
        if (e.armor >= a.amount) return false;
        const refund = e.paid.armor || 0;
        if (e.money + refund < a.cost) { this.emit({ e: 'buyFail', id: e.id }); return false; }
        e.money += refund - a.cost;
        e.paid.armor = a.cost;
        e.armor = a.amount;
        this.emit({ e: 'buy', id: e.id, item });
        return true;
      }
      const w = WEAPONS[item];
      if (!w || w.cost <= 0) return false;
      const slot = w.slot;
      if (e.inv[slot] === item) return false;
      const refund = e.paid['s' + slot] || 0;
      if (e.money + refund < w.cost) { this.emit({ e: 'buyFail', id: e.id }); return false; }
      e.money += refund - w.cost;
      e.paid['s' + slot] = w.cost;
      e.inv[slot] = item;
      e.ammo[item] = { mag: w.mag, res: w.res };
      e.cur = item;
      e.reloadT = 0;
      this.emit({ e: 'buy', id: e.id, item });
      return true;
    }

    setInput(id, inp) {
      const e = this.byId.get(id);
      if (!e || !inp) return;
      const i = e.in;
      i.mx = Math.max(-1, Math.min(1, +inp.mx || 0));
      i.my = Math.max(-1, Math.min(1, +inp.my || 0));
      if (isFinite(inp.ang)) i.ang = +inp.ang;
      i.fire = !!inp.fire;
      i.walk = !!inp.walk;
      i.use = !!inp.use;
      if (inp.reload) i.reload = true;
      if (inp.ability) e.pendingAbility = true;
      if (inp.slot >= 1 && inp.slot <= 3) this.switchSlot(e, inp.slot);
      if (Array.isArray(inp.cmds)) for (const c of inp.cmds.slice(0, 6)) this.command(id, c);
    }
    switchSlot(e, slot) {
      const id = e.inv[slot];
      if (!id || id === e.cur) return;
      e.cur = id;
      e.reloadT = 0;
      e.fireHeld = true;
    }

    // ---------- Oyuncu güncelleme ----------
    updatePlayer(e, dt) {
      if (!e.alive) return;
      const inp = e.in;
      e.ang = inp.ang;
      // etkiler
      if (e.boostT > 0) e.boostT -= dt;
      if (e.blindT > 0) e.blindT -= dt;
      if (e.revealT > 0) e.revealT -= dt;
      if (e.healLeft > 0) {
        const h = Math.min(e.healLeft, 18 * dt);
        e.healLeft -= h;
        e.hp = Math.min(RULES.HP, e.hp + h);
      }
      // hareket
      let mx = inp.mx, my = inp.my;
      const m = Math.hypot(mx, my);
      let speed = 0;
      if (m > 0.01) {
        mx /= m; my /= m;
        speed = e.boostT > 0 ? RULES.BOOST : inp.walk ? RULES.WALK : RULES.RUN;
        if (e.cur === 'sahin' || e.cur === 'kartal') speed *= 0.96;
        if (e.cur === 'bicak') speed *= 1.06;
      }
      const sx = mx * speed * dt, sy = my * speed * dt;
      let nx = e.x + sx, ny = e.y;
      if (!collides(nx, ny, R)) e.x = nx;
      ny = e.y + sy;
      if (!collides(e.x, ny, R)) e.y = ny;
      // alım fazında başlangıç odasından çıkılamaz
      if (this.phase === 'buy') {
        if (e.team === 'atk') e.x = Math.min(e.x, 9 * TILE - R);
        else e.x = Math.max(e.x, 37 * TILE + R);
      }
      e.spd = speed > 0 ? Math.min(1, speed / RULES.RUN) : 0;
      e.moveAmt = speed * dt;

      // yetenek
      if (e.pendingAbility) {
        e.pendingAbility = false;
        if (this.phase !== 'end') this.useAbility(e);
      }
      // ateş / şarjör
      if (e.fireCd > 0) e.fireCd -= dt;
      const w = WEAPONS[e.cur];
      const am = e.ammo[e.cur];
      if (inp.reload) {
        inp.reload = false;
        if (am && e.reloadT <= 0 && am.mag < w.mag && am.res > 0) this.startReload(e);
      }
      if (e.reloadT > 0) {
        e.reloadT -= dt;
        if (e.reloadT <= 0) {
          const take = Math.min(w.mag - am.mag, am.res);
          am.mag += take; am.res -= take;
          e.reloadT = 0;
        }
      }
      const canShoot = this.phase === 'live' && !e.plantP;
      if (inp.fire && canShoot) {
        const edge = !e.fireHeld;
        if ((w.auto || edge) && e.fireCd <= 0 && e.reloadT <= 0) {
          if (w.id === 'bicak') this.melee(e, w);
          else if (am && am.mag > 0) this.shoot(e, w, am);
          else if (am && am.res > 0) this.startReload(e);
          else if (edge) this.emit({ e: 'empty', id: e.id });
        }
      }
      e.fireHeld = inp.fire;

      this.updateSpikeActions(e, dt);
    }

    startReload(e) {
      const w = WEAPONS[e.cur];
      e.reloadT = w.reload;
      this.emit({ e: 'reload', id: e.id });
    }

    // hedef bul: ışın ile en yakın düşman
    traceShot(e, ang, range) {
      const wallD = raycast(e.x, e.y, ang, range);
      const dx = Math.cos(ang), dy = Math.sin(ang);
      let best = null, bestT = wallD;
      for (const p of this.players) {
        if (!p.alive || p.team === e.team) continue;
        const vx = p.x - e.x, vy = p.y - e.y;
        const t = vx * dx + vy * dy;
        if (t < 0 || t > wallD + R) continue;
        const perp = Math.abs(vx * dy - vy * dx);
        if (perp > R) continue;
        const tt = t - Math.sqrt(R * R - perp * perp);
        if (tt >= 0 && tt < bestT) { best = p; bestT = tt; }
      }
      return { victim: best, dist: bestT, ex: e.x + dx * bestT, ey: e.y + dy * bestT };
    }

    shoot(e, w, am) {
      am.mag--;
      e.fireCd = 1 / w.rate;
      e.lastShot = this.time;
      const moveExtra = e.spd > 0.7 ? 3.5 : e.spd > 0.3 ? 1.5 : 0;
      const mult = w.tur === 'Keskin' ? 5 : w.tur === 'Pompalı' ? 0.5 : 1;
      const spreadDeg = w.spread + moveExtra * mult;
      const ends = [];
      const hits = {};
      for (let i = 0; i < w.pellets; i++) {
        const r1 = Math.random() - 0.5, r2 = Math.random() - 0.5;
        const a = e.ang + ((r1 + r2) * spreadDeg * Math.PI) / 180 * (w.pellets > 1 ? 1.4 : 1);
        const tr = this.traceShot(e, a, w.range);
        ends.push([Math.round(tr.ex), Math.round(tr.ey)]);
        if (tr.victim) hits[tr.victim.id] = (hits[tr.victim.id] || 0) + w.dmg;
      }
      for (const vid in hits) this.damage(this.byId.get(+vid), e, hits[vid], w);
      this.emit({ e: 'shot', id: e.id, x: Math.round(e.x), y: Math.round(e.y), a: e.ang, w: w.id, ends });
      if (am.mag === 0 && am.res > 0) this.startReload(e);
    }

    melee(e, w) {
      e.fireCd = 1 / w.rate;
      const tr = this.traceShot(e, e.ang, w.range);
      if (tr.victim) this.damage(tr.victim, e, w.dmg, w);
      this.emit({ e: 'shot', id: e.id, x: Math.round(e.x), y: Math.round(e.y), a: e.ang, w: 'bicak', ends: [] });
    }

    damage(v, a, dmg, w) {
      if (!v || !v.alive) return;
      let toHp = dmg;
      if (v.armor > 0) {
        const absorb = Math.min(v.armor, dmg * 0.66);
        v.armor -= absorb;
        toHp = dmg - absorb;
      }
      v.hp -= toHp;
      v.lastHurt = this.time;
      v.dmgFrom[a.id] = this.time;
      this.emit({ e: 'hit', v: v.id, a: a.id, d: Math.round(dmg), x: Math.round(v.x), y: Math.round(v.y) });
      if (v.hp <= 0) this.kill(v, a, w);
    }

    kill(v, a, w) {
      v.hp = 0;
      v.alive = false;
      v.deaths++;
      v.plantP = 0;
      a.kills++;
      a.roundKills++;
      a.money = Math.min(ECO.MAX, a.money + (KILL_REWARD[w.id] || ECO.KILL));
      // asist: son 4 sn içinde hasar veren diğerleri
      for (const id in v.dmgFrom) {
        const o = this.byId.get(+id);
        if (!o || o.id === a.id || o.team !== a.team) continue;
        if (this.time - v.dmgFrom[id] <= 4) {
          o.assists++;
          o.money = Math.min(ECO.MAX, o.money + ECO.ASSIST);
          this.emit({ e: 'assist', id: o.id });
        }
      }
      this.emit({ e: 'kill', k: a.id, v: v.id, w: w.id, x: Math.round(v.x), y: Math.round(v.y) });
      // spike taşıyıcısı ölürse yere düşer
      const sp = this.spike;
      if (sp.state === 'carried' && sp.carrier === v.id) {
        sp.state = 'dropped'; sp.x = v.x; sp.y = v.y; sp.carrier = 0;
        this.emit({ e: 'spikeDrop' });
      }
      if (sp.defuser === v.id) { sp.defuser = 0; sp.progress = sp.checkpoint ? RULES.DEFUSE_TIME / 2 : 0; }
    }

    // ---------- Yetenekler ----------
    useAbility(e) {
      if (!e.alive || e.charges <= 0 || this.phase === 'end') return;
      const ag = this.agentOf(e);
      const t = ag.yetenek;
      if (t === 'sifa' && e.hp >= RULES.HP) return;
      e.charges--;
      const dist = Math.min(260, raycast(e.x, e.y, e.ang, 260) - 14);
      const px = e.x + Math.cos(e.ang) * Math.max(0, dist);
      const py = e.y + Math.sin(e.ang) * Math.max(0, dist);
      if (t === 'duman') {
        this.smokes.push({ x: px, y: py, r: 95, t: 7 });
      } else if (t === 'flas') {
        this.flashes = this.flashes || [];
        this.flashes.push({ x: px, y: py, by: e.id, t: 0.45 });
      } else if (t === 'sifa') {
        e.healLeft += 60;
      } else if (t === 'hiz') {
        e.boostT = 4;
      } else if (t === 'radar') {
        for (const p of this.players) {
          if (p.team !== e.team && p.alive && Math.hypot(p.x - e.x, p.y - e.y) < 460) {
            p.revealT = 3; p.revealTeam = e.team;
          }
        }
      }
      this.emit({ e: 'ability', id: e.id, k: t, x: Math.round(px), y: Math.round(py) });
    }

    updateSmokesAndFlashes(dt) {
      for (const s of this.smokes) s.t -= dt;
      this.smokes = this.smokes.filter((s) => s.t > 0);
      if (this.flashes) {
        for (const f of this.flashes) f.t -= dt;
        for (const f of this.flashes) {
          if (f.t > 0) continue;
          this.emit({ e: 'flashPop', x: Math.round(f.x), y: Math.round(f.y) });
          for (const p of this.players) {
            if (!p.alive) continue;
            const d = Math.hypot(p.x - f.x, p.y - f.y);
            if (d > 650) continue;
            if (!this.hasLOS(f.x, f.y, p.x, p.y)) continue;
            // flaşa bakıyor mu?
            const toF = Math.atan2(f.y - p.y, f.x - p.x);
            const diff = Math.abs(angDiff(p.ang, toF));
            if (diff > (110 * Math.PI) / 180) continue;
            p.blindT = Math.max(p.blindT, 2.4 - (d / 650) * 1.2);
          }
        }
        this.flashes = this.flashes.filter((f) => f.t > 0);
      }
    }

    smokeBlocks(ax, ay, bx, by) {
      for (const s of this.smokes) if (distToSeg(s.x, s.y, ax, ay, bx, by) < s.r * 0.85) return true;
      return false;
    }
    hasLOS(ax, ay, bx, by) {
      const d = Math.hypot(bx - ax, by - ay);
      if (d < 1) return true;
      const wd = raycast(ax, ay, Math.atan2(by - ay, bx - ax), d);
      return wd >= d - 1;
    }
    canSee(ax, ay, bx, by) {
      return this.hasLOS(ax, ay, bx, by) && !this.smokeBlocks(ax, ay, bx, by);
    }

    // ---------- Spike ----------
    updateSpikeActions(e, dt) {
      const sp = this.spike;
      const inp = e.in;
      if (this.phase !== 'live') { e.plantP = 0; return; }
      // yerden alma
      if (sp.state === 'dropped' && e.team === 'atk' && Math.hypot(e.x - sp.x, e.y - sp.y) < 26) {
        sp.state = 'carried'; sp.carrier = e.id;
        this.emit({ e: 'spikePick', id: e.id });
      }
      // kurma
      if (e.team === 'atk' && sp.state === 'carried' && sp.carrier === e.id) {
        const site = inSiteRect(e.x, e.y);
        if (inp.use && site && e.moveAmt < 0.5) {
          if (!e.plantP) this.emit({ e: 'plantStart', id: e.id });
          e.plantP = (e.plantP || 0) + dt;
          sp.progress = e.plantP;
          if (e.plantP >= RULES.PLANT_TIME) {
            e.plantP = 0;
            sp.state = 'planted'; sp.x = e.x; sp.y = e.y; sp.site = site; sp.planter = e.id;
            sp.progress = 0; sp.checkpoint = false; sp.defuser = 0;
            this.timer = RULES.SPIKE_TIME;
            e.money = Math.min(ECO.MAX, e.money + ECO.PLANT);
            this.emit({ e: 'planted', id: e.id, site, x: Math.round(e.x), y: Math.round(e.y) });
          }
        } else if (e.plantP) {
          e.plantP = 0; sp.progress = 0;
          this.emit({ e: 'plantStop', id: e.id });
        }
      } else if (e.plantP) {
        e.plantP = 0;
      }
      // çözme
      if (sp.state === 'planted' && e.team === 'def') {
        const near = Math.hypot(e.x - sp.x, e.y - sp.y) < 42;
        const trying = inp.use && near && e.moveAmt < 0.5;
        if (trying && (sp.defuser === 0 || sp.defuser === e.id)) {
          if (sp.defuser === 0) { sp.defuser = e.id; this.emit({ e: 'defuseStart', id: e.id }); }
          sp.progress += dt;
          if (sp.progress >= RULES.DEFUSE_TIME / 2) sp.checkpoint = true;
          if (sp.progress >= RULES.DEFUSE_TIME) {
            sp.state = 'defused'; sp.defuser = 0;
            e.money = Math.min(ECO.MAX, e.money + ECO.DEFUSE);
            this.emit({ e: 'defused', id: e.id });
            this.endRound(e.squad, 'defuse');
          }
        } else if (sp.defuser === e.id) {
          sp.defuser = 0;
          sp.progress = sp.checkpoint ? RULES.DEFUSE_TIME / 2 : 0;
          this.emit({ e: 'defuseStop', id: e.id });
        }
      }
    }

    // ---------- Ana adım ----------
    tick(dt) {
      this.time += dt;
      if (this.over && this.phase === 'end') {
        // maç bitti, sadece hareket
      }
      if (this.phase === 'buy') {
        this.timer -= dt;
        if (this.timer <= 0) this.beginLive();
      } else if (this.phase === 'live') {
        this.timer -= dt;
      } else if (this.phase === 'end') {
        this.timer -= dt;
        if (this.timer <= 0 && !this.over) this.startRound(false);
      }
      for (const e of this.players) {
        if (e.bot && this.botThink) this.botThink(e, dt);
        this.updatePlayer(e, dt);
      }
      const sp = this.spike;
      if (sp.state === 'carried') {
        const c = this.byId.get(sp.carrier);
        if (c) { sp.x = c.x; sp.y = c.y; }
      }
      this.updateSmokesAndFlashes(dt);
      this.checkWin();
    }

    // ---------- Anlık görüntü ----------
    snapshot() {
      const sp = this.spike;
      return {
        ph: this.phase, tm: Math.max(0, +this.timer.toFixed(2)), rd: this.round,
        sc: this.score, sw: this.swapped, over: this.over, mw: this.matchWinner,
        sp: { s: sp.state, x: Math.round(sp.x), y: Math.round(sp.y), c: sp.carrier, p: +sp.progress.toFixed(2), d: sp.defuser, st: sp.site, cp: sp.checkpoint },
        sm: this.smokes.map((s) => [Math.round(s.x), Math.round(s.y), s.r, +s.t.toFixed(1)]),
        ps: this.players.map((e) => ({
          id: e.id, x: +e.x.toFixed(1), y: +e.y.toFixed(1), a: +e.ang.toFixed(3),
          hp: Math.ceil(e.hp), ar: Math.ceil(e.armor), al: e.alive ? 1 : 0, tm: e.team,
          w: e.cur, mg: e.ammo[e.cur] ? e.ammo[e.cur].mag : 0, rs: e.ammo[e.cur] ? e.ammo[e.cur].res : 0,
          rl: e.reloadT > 0 ? +(1 - e.reloadT / (WEAPONS[e.cur].reload || 1)).toFixed(2) : 0,
          mo: e.money, k: e.kills, d: e.deaths, as: e.assists,
          ch: e.charges, bl: +Math.max(0, e.blindT).toFixed(1), bo: e.boostT > 0 ? 1 : 0,
          rv: e.revealT > 0 ? e.revealTeam : '', pl: e.plantP ? +(e.plantP / RULES.PLANT_TIME).toFixed(2) : 0,
          sl: [e.inv[1], e.inv[2]], mv: e.spd > 0.6 ? 1 : 0, wk: e.spd > 0 && e.spd <= 0.6 ? 1 : 0,
        })),
      };
    }

    roster() {
      return this.players.map((e) => ({ id: e.id, name: e.name, bot: e.bot, squad: e.squad, agent: e.agent, team: e.team }));
    }
  }

  const api = { Sim, solid, collides, raycast, angDiff, distToSeg, inSiteRect };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SIM = api;
})(typeof window !== 'undefined' ? window : globalThis);
