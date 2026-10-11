// Nokta Atışı - istemci (çizim, giriş, ağ, arayüz)
(function () {
  'use strict';
  const D = window.DATA, S = window.SIM, A = window.GAMEAUDIO;
  const { TILE, COLS, ROWS, grid, SITES, WEAPONS, ARMORS, AGENTS, RULES, BUY_LIST } = D;
  const MAPW = COLS * TILE, MAPH = ROWS * TILE;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const COL = { ally: '#3ad1c4', enemy: '#ff5a4d', gold: '#ffd45e', txt: '#e8edf5', dim: '#8b97ad' };
  const REASON = { elim: 'Tüm düşmanlar elendi', explode: 'Spike patladı', defuse: 'Spike çözüldü', time: 'Süre doldu' };
  const SIDE = { atk: 'SALDIRAN', def: 'SAVUNAN' };

  const cv = $('cv');
  const ctx = cv.getContext('2d');
  const fog = document.createElement('canvas');
  const fctx = fog.getContext('2d');
  let W = 0, H = 0, dpr = 1;

  const G = {
    screen: 'menu', mode: null, myId: 0, hostId: 0, ws: null, lobby: [],
    sim: null, snap: null, pmap: new Map(), roster: new Map(),
    disp: new Map(), pred: null, fx: [], feed: [], banner: null, big: null,
    keys: {}, mouse: { x: 0, y: 0 }, fire: false, aim: 0,
    one: { reload: false, ability: false, slot: 0, cmds: [] },
    cam: { x: MAPW / 2, y: MAPH / 2, s: 1 },
    spec: 0, buyOpen: false, showScore: false, over: null, phase: '', lastPhaseSig: '',
    netEv: [], sendT: 0, inT: 0, acc: 0, last: 0, beepT: 0, stepT: new Map(),
    vis: new Set(), skill: 0.6, ownSquad: 0, fill: true, toastT: 0, lastBuySig: '',
  };

  // ======================================================================
  //  Harita ön çizimi
  // ======================================================================
  const mapImg = document.createElement('canvas');
  mapImg.width = MAPW; mapImg.height = MAPH;
  (function buildMap() {
    const c = mapImg.getContext('2d');
    c.fillStyle = '#10151f'; c.fillRect(0, 0, MAPW, MAPH);
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (grid[y][x] === 1) continue;
        c.fillStyle = (x + y) % 2 ? '#273149' : '#2b3650';
        c.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
    // başlangıç bölgeleri
    c.fillStyle = 'rgba(255,90,77,0.10)'; c.fillRect(2 * TILE, 11 * TILE, 7 * TILE, 8 * TILE);
    c.fillStyle = 'rgba(58,209,196,0.10)'; c.fillRect(37 * TILE, 11 * TILE, 9 * TILE, 8 * TILE);
    // spike bölgeleri
    for (const k in SITES) {
      const s = SITES[k];
      c.fillStyle = 'rgba(255,212,94,0.07)'; c.fillRect(s.x, s.y, s.w, s.h);
      c.strokeStyle = 'rgba(255,212,94,0.35)'; c.setLineDash([8, 6]); c.lineWidth = 2;
      c.strokeRect(s.x + 1, s.y + 1, s.w - 2, s.h - 2); c.setLineDash([]);
      c.fillStyle = 'rgba(255,212,94,0.18)'; c.font = 'bold 120px Segoe UI, Arial'; c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(k, s.x + s.w / 2, s.y + s.h / 2 + 6);
    }
    // duvarlar (yalnızca açık alanla komşu olanlar parlak)
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (grid[y][x] !== 1) continue;
        const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
          const nx = x + dx, ny = y + dy;
          return nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS && grid[ny][nx] === 0;
        });
        if (edge) {
          c.fillStyle = '#6b7896'; c.fillRect(x * TILE, y * TILE, TILE, TILE);
          c.fillStyle = '#56627f'; c.fillRect(x * TILE + 2, y * TILE + 2, TILE - 4, TILE - 4);
        }
      }
    }
  })();

  // ======================================================================
  //  Ağ
  // ======================================================================
  function wsSend(o) { if (G.ws && G.ws.readyState === 1) G.ws.send(JSON.stringify(o)); }

  function connectLan() {
    show('lobby');
    $('lobbyInfo').textContent = 'Sunucuya bağlanıyor…';
    $('status').textContent = '';
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    let ws;
    try { ws = new WebSocket(proto + location.host); } catch (e) { $('lobbyInfo').textContent = 'Bağlanılamadı. Sayfayı sunucu adresinden açtığından emin ol.'; return; }
    G.ws = ws;
    ws.onopen = () => { wsSend({ t: 'name', name: nick() }); };
    ws.onclose = () => {
      if (G.ws !== ws) return;
      G.ws = null;
      if (G.mode === 'host' || G.mode === 'client') leaveGame(true);
      if (G.screen === 'lobby') $('lobbyInfo').textContent = 'Bağlantı koptu. Geri dönüp tekrar dene.';
    };
    ws.onerror = () => { if (G.screen === 'lobby') $('lobbyInfo').textContent = 'Sunucuya bağlanılamadı. Sunucu çalışıyor mu?'; };
    ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      onNet(m);
    };
  }

  function onNet(m) {
    switch (m.t) {
      case 'welcome': G.myId = m.id; G.hostId = m.hostId; break;
      case 'lobby': G.lobby = m.players; G.hostId = m.hostId; renderLobby(); break;
      case 'input': if (G.mode === 'host' && G.sim) G.sim.setInput(m.from, m.d); break;
      case 'left': break;
      case 'start': if (G.mode !== 'host') startClient(m); break;
      case 'state': if (G.mode === 'client') onState(m.s, m.ev || []); break;
      case 'end': if (G.mode === 'client') { leaveGame(false); toast('Maç ev sahibi tarafından bitirildi'); } break;
      case 'hostLeft':
        if (G.mode === 'client' || G.mode === 'host') { leaveGame(false); toast('Ev sahibi ayrıldı, maç bitti'); }
        break;
    }
  }

  function renderLobby() {
    const isHost = G.myId === G.hostId;
    $('lobbyInfo').textContent = isHost ? 'Sen ev sahibisin. Herkes bağlanınca maçı başlat.' : 'Ev sahibinin maçı başlatması bekleniyor…';
    $('plist').innerHTML = G.lobby.map((p, i) =>
      `<div class="pl"><span>${esc(p.name)}${p.id === G.myId ? ' (sen)' : ''}</span><span class="tag">${p.host ? 'EV SAHİBİ · ' : ''}Takım ${(i % 2) + 1}</span></div>`).join('');
    $('btnStart').disabled = !isHost;
    $('fillRow').style.display = isHost ? 'flex' : 'none';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  function nick() { return ($('nick').value || '').trim().slice(0, 16) || 'Oyuncu'; }

  // ======================================================================
  //  Maç başlatma
  // ======================================================================
  function resetMatchState() {
    G.snap = null; G.pmap = new Map(); G.disp = new Map(); G.pred = null; G.fx = []; G.feed = [];
    G.banner = null; G.big = null; G.over = null; G.buyOpen = false; G.showScore = false;
    G.netEv = []; G.spec = 0; G.lastPhaseSig = ''; G.stepT = new Map(); G.vis = new Set(); G.beepT = 0;
    G.one = { reload: false, ability: false, slot: 0, cmds: [] };
    $('endbox').style.display = 'none'; $('buy').style.display = 'none'; $('score').style.display = 'none';
  }

  function enterGame() {
    show('game');
    A.resume();
    G.last = performance.now(); G.acc = 0;
  }

  function startOffline() {
    resetMatchState();
    G.mode = 'offline'; G.myId = 1;
    const me = +$('side').value; // 0: saldıran, 1: savunan
    const list = [{ id: 1, name: nick(), bot: false, squad: me }];
    const names = ['Kıvrak', 'Demir', 'Gölge', 'Yıldız', 'Bora', 'Çınar', 'Tufan', 'Atlas', 'Nehir', 'Kaplan'];
    let n = 0, id = 1000;
    for (let sq = 0; sq < 2; sq++) {
      const have = list.filter((p) => p.squad === sq).length;
      for (let i = have; i < 5; i++) list.push({ id: id++, name: '[BOT] ' + names[n++ % names.length], bot: true, squad: sq });
    }
    G.skill = +$('diff').value;
    G.sim = new S.Sim({ players: list, skill: G.skill });
    G.roster = new Map(G.sim.roster().map((r) => [r.id, r]));
    enterGame();
  }

  function startHost() {
    const humans = G.lobby.slice(0, 10);
    const fill = $('fill').checked;
    const list = [];
    humans.forEach((p, i) => list.push({ id: p.id, name: p.name, bot: false, squad: i % 2 }));
    if (fill) {
      const names = ['Kıvrak', 'Demir', 'Gölge', 'Yıldız', 'Bora', 'Çınar', 'Tufan', 'Atlas', 'Nehir', 'Kaplan'];
      let n = 0, id = 1000;
      for (let sq = 0; sq < 2; sq++) {
        const have = list.filter((p) => p.squad === sq).length;
        for (let i = have; i < 5; i++) list.push({ id: id++, name: '[BOT] ' + names[n++ % names.length], bot: true, squad: sq });
      }
    }
    const sq0 = list.filter((p) => p.squad === 0).length, sq1 = list.length - sq0;
    if (!sq0 || !sq1) { $('status').textContent = 'Maç için iki takımda da oyuncu gerekli (botla doldurmayı aç ya da en az 2 kişi olun).'; return; }
    resetMatchState();
    G.mode = 'host';
    G.skill = 0.6;
    G.sim = new S.Sim({ players: list, skill: G.skill });
    G.roster = new Map(G.sim.roster().map((r) => [r.id, r]));
    wsSend({ t: 'start', roster: G.sim.roster() });
    enterGame();
  }

  function startClient(m) {
    resetMatchState();
    G.mode = 'client';
    G.roster = new Map(m.roster.map((r) => [r.id, r]));
    enterGame();
  }

  function leaveGame(silent) {
    const was = G.mode;
    if (was === 'host' && G.ws && !silent) wsSend({ t: 'end' });
    G.mode = null; G.sim = null; G.snap = null;
    $('endbox').style.display = 'none'; $('buy').style.display = 'none'; $('score').style.display = 'none';
    if (was === 'host' || was === 'client') { if (G.ws) show('lobby'); else show('menu'); renderLobby(); }
    else show('menu');
  }

  // ======================================================================
  //  Ekran yönetimi
  // ======================================================================
  function show(name) {
    G.screen = name;
    for (const id of ['menu', 'lobby']) $(id).classList.toggle('on', id === name);
    cv.style.display = name === 'game' ? 'block' : 'none';
    if (name !== 'game') { $('buy').style.display = 'none'; $('score').style.display = 'none'; $('endbox').style.display = 'none'; }
    if (name === 'menu' && G.ws) { try { G.ws.close(); } catch (e) {} G.ws = null; }
    if (name === 'game') resize();
  }
  function toast(t) {
    const el = $('toast'); el.textContent = t; el.style.display = 'block';
    clearTimeout(G.toastT); G.toastT = setTimeout(() => (el.style.display = 'none'), 3500);
  }
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    fog.width = cv.width; fog.height = cv.height;
  }
  window.addEventListener('resize', resize);

  $('btnOffline').onclick = () => { A.resume(); startOffline(); };
  $('btnLan').onclick = () => { A.resume(); connectLan(); };
  $('btnLeave').onclick = () => show('menu');
  $('btnStart').onclick = () => startHost();
  $('btnEndBack').onclick = () => leaveGame(false);
  try { $('nick').value = localStorage.getItem('na_nick') || ''; } catch (e) {}
  $('nick').addEventListener('change', () => { try { localStorage.setItem('na_nick', nick()); } catch (e) {} if (G.ws) wsSend({ t: 'name', name: nick() }); });

  // ======================================================================
  //  Giriş
  // ======================================================================
  window.addEventListener('keydown', (e) => {
    if (G.screen !== 'game') return;
    if (e.target && e.target.tagName === 'INPUT') return;
    const k = e.code;
    if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
    if (e.repeat) return;
    G.keys[k] = true;
    if (k === 'KeyR') G.one.reload = true;
    else if (k === 'KeyE') G.one.ability = true;
    else if (k === 'Digit1') G.one.slot = 1;
    else if (k === 'Digit2') G.one.slot = 2;
    else if (k === 'Digit3') G.one.slot = 3;
    else if (k === 'KeyB') { if (G.snap && G.snap.ph === 'buy') G.buyOpen = !G.buyOpen; }
    else if (k === 'Tab') G.showScore = true;
    else if (k === 'Escape') { if (G.buyOpen) G.buyOpen = false; else leaveGame(false); }
  });
  window.addEventListener('keyup', (e) => {
    G.keys[e.code] = false;
    if (e.code === 'Tab') G.showScore = false;
  });
  window.addEventListener('blur', () => { G.keys = {}; G.fire = false; });
  cv.addEventListener('mousemove', (e) => { G.mouse.x = e.clientX; G.mouse.y = e.clientY; });
  cv.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    A.resume();
    const me = G.pmap.get(G.myId);
    if (me && !me.al) cycleSpec(); else G.fire = true;
  });
  window.addEventListener('mouseup', (e) => { if (e.button === 0) G.fire = false; });
  cv.addEventListener('contextmenu', (e) => e.preventDefault());

  function cycleSpec() {
    if (!G.snap) return;
    const me = G.pmap.get(G.myId);
    const team = me ? me.tm : 'atk';
    const al = G.snap.ps.filter((p) => p.tm === team && p.al);
    if (!al.length) return;
    const i = al.findIndex((p) => p.id === G.spec);
    G.spec = al[(i + 1) % al.length].id;
  }

  function currentInput() {
    const k = G.keys;
    const mx = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    const my = (k.KeyS || k.ArrowDown ? 1 : 0) - (k.KeyW || k.ArrowUp ? 1 : 0);
    return { mx, my, ang: G.aim, fire: G.fire && !G.buyHover, walk: !!(k.ShiftLeft || k.ShiftRight), use: !!k.KeyF };
  }

  // ======================================================================
  //  Ana döngü
  // ======================================================================
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - G.last) / 1000);
    G.last = now;
    if (G.screen !== 'game') return;
    update(dt);
    draw(dt);
  }

  function update(dt) {
    const inp = currentInput();
    const sim = G.sim;
    // nişan açısı: oyuncunun ekrandaki konumuna göre
    const f = focusPos();
    const scr = worldToScreen(f.x, f.y);
    G.aim = Math.atan2(G.mouse.y - scr.y, G.mouse.x - scr.x);
    inp.ang = G.aim;

    if (G.mode === 'offline' || G.mode === 'host') {
      // tek adımlı sabit zaman
      sim.setInput(G.myId, Object.assign({}, inp, { reload: G.one.reload, ability: G.one.ability, slot: G.one.slot, cmds: G.one.cmds }));
      G.one = { reload: false, ability: false, slot: 0, cmds: [] };
      G.acc += dt;
      let steps = 0;
      while (G.acc >= 1 / 60 && steps < 8) {
        sim.tick(1 / 60); G.acc -= 1 / 60; steps++;
        const ev = sim.drainEvents();
        if (ev.length) { handleEvents(ev); if (G.mode === 'host') for (const x of ev) G.netEv.push(x); }
      }
      if (steps >= 8) G.acc = 0;
      onSnapshot(sim.snapshot());
      if (G.mode === 'host') {
        G.sendT += dt;
        if (G.sendT >= 1 / 30) { G.sendT = 0; wsSend({ t: 'state', s: G.snap, ev: G.netEv }); G.netEv = []; }
      }
    } else if (G.mode === 'client') {
      G.inT += dt;
      if (G.inT >= 1 / 30) {
        G.inT = 0;
        wsSend({ t: 'input', d: Object.assign({}, inp, { reload: G.one.reload, ability: G.one.ability, slot: G.one.slot, cmds: G.one.cmds }) });
        G.one = { reload: false, ability: false, slot: 0, cmds: [] };
      }
      predict(dt, inp);
    }
    updateDisp(dt);
    updateAudioAndFx(dt);
  }

  // Anlık görüntü geldi (offline/host: her kare, istemci: ağdan)
  function onSnapshot(s) {
    G.snap = s;
    const m = new Map();
    for (const p of s.ps) m.set(p.id, p);
    G.pmap = m;
  }
  function onState(s, ev) {
    onSnapshot(s);
    // tahmin düzeltmesi
    const me = G.pmap.get(G.myId);
    if (me) {
      if (!G.pred) G.pred = { x: me.x, y: me.y };
      const err = Math.hypot(me.x - G.pred.x, me.y - G.pred.y);
      const inp = currentInput();
      if (!me.al || err > 60) { G.pred.x = me.x; G.pred.y = me.y; }
      else if (err > 25 || (!inp.mx && !inp.my)) { G.pred.x += (me.x - G.pred.x) * 0.35; G.pred.y += (me.y - G.pred.y) * 0.35; }
    }
    handleEvents(ev);
  }

  // İstemci tarafı hareket tahmini
  function predict(dt, inp) {
    const me = G.pmap.get(G.myId);
    if (!me) return;
    if (!G.pred) G.pred = { x: me.x, y: me.y };
    if (!me.al) return;
    let mx = inp.mx, my = inp.my;
    const m = Math.hypot(mx, my);
    if (m < 0.01) return;
    mx /= m; my /= m;
    let speed = me.bo ? RULES.BOOST : inp.walk ? RULES.WALK : RULES.RUN;
    if (me.w === 'sahin' || me.w === 'kartal') speed *= 0.96;
    if (me.w === 'bicak') speed *= 1.06;
    const R = RULES.PLAYER_R, P = G.pred;
    if (!S.collides(P.x + mx * speed * dt, P.y, R)) P.x += mx * speed * dt;
    if (!S.collides(P.x, P.y + my * speed * dt, R)) P.y += my * speed * dt;
    if (G.snap.ph === 'buy') {
      if (me.tm === 'atk') P.x = Math.min(P.x, 9 * TILE - R); else P.x = Math.max(P.x, 37 * TILE + R);
    }
  }

  function updateDisp(dt) {
    if (!G.snap) return;
    const k = 1 - Math.exp(-dt * 22);
    for (const p of G.snap.ps) {
      let d = G.disp.get(p.id);
      if (!d) { d = { x: p.x, y: p.y, a: p.a }; G.disp.set(p.id, d); }
      if (G.mode !== 'client') { d.x = p.x; d.y = p.y; d.a = p.a; }
      else {
        if (Math.hypot(p.x - d.x, p.y - d.y) > 200) { d.x = p.x; d.y = p.y; }
        d.x += (p.x - d.x) * k; d.y += (p.y - d.y) * k;
        d.a += S.angDiff(p.a, d.a) * k;
      }
      if (p.id === G.myId && p.al) {
        d.a = G.aim;
        if (G.mode === 'client' && G.pred) { d.x = G.pred.x; d.y = G.pred.y; }
      }
    }
  }

  // ======================================================================
  //  Kamera / görüş
  // ======================================================================
  function focusId() {
    const s = G.snap;
    if (!s) return G.myId;
    const me = G.pmap.get(G.myId);
    if (me && me.al) return me.id;
    const team = me ? me.tm : 'atk';
    const spec = G.pmap.get(G.spec);
    if (spec && spec.al && spec.tm === team) return spec.id;
    const al = s.ps.find((p) => p.tm === team && p.al);
    if (al) { G.spec = al.id; return al.id; }
    return me ? me.id : (s.ps[0] && s.ps[0].id);
  }
  function focusPos() {
    const id = focusId();
    const d = G.disp.get(id);
    return d || { x: MAPW / 2, y: MAPH / 2 };
  }
  function updateCamera() {
    const s = clamp(H / 720, 0.85, 1.7);
    const f = focusPos();
    const vw = W / s, vh = H / s;
    let cx = f.x, cy = f.y;
    cx = vw >= MAPW ? MAPW / 2 : clamp(cx, vw / 2, MAPW - vw / 2);
    cy = vh >= MAPH ? MAPH / 2 : clamp(cy, vh / 2, MAPH - vh / 2);
    G.cam.x = cx; G.cam.y = cy; G.cam.s = s;
  }
  function worldToScreen(x, y) {
    updateCamera();
    const c = G.cam;
    return { x: (x - c.x) * c.s + W / 2, y: (y - c.y) * c.s + H / 2 };
  }

  function smokeBlocks(ax, ay, bx, by) {
    const sm = G.snap ? G.snap.sm : [];
    for (const s of sm) if (S.distToSeg(s[0], s[1], ax, ay, bx, by) < s[2] * 0.85) return true;
    return false;
  }
  function seenByTeam(team, x, y) {
    if (!G.snap) return false;
    for (const a of G.snap.ps) {
      if (!a.al || a.tm !== team) continue;
      const d0 = G.disp.get(a.id) || a;
      const dx = x - d0.x, dy = y - d0.y, d = Math.hypot(dx, dy);
      if (d > RULES.VIEW_RANGE) continue;
      if (a.bl > 0) continue;
      const ang = Math.atan2(dy, dx);
      if (d > 90 && Math.abs(S.angDiff(d0.a, ang)) > (RULES.FOV * Math.PI) / 360) continue;
      if (S.raycast(d0.x, d0.y, ang, d) < d - 1) continue;
      if (smokeBlocks(d0.x, d0.y, x, y)) continue;
      return true;
    }
    return false;
  }

  // ======================================================================
  //  Olaylar (ses, efekt, banner)
  // ======================================================================
  function nameOf(id) { const r = G.roster.get(id); return r ? r.name : 'Oyuncu'; }
  function myTeam() { const me = G.pmap.get(G.myId); return me ? me.tm : 'atk'; }
  function mySquad() { const r = G.roster.get(G.myId); return r ? r.squad : 0; }
  function posOf(id) { const d = G.disp.get(id); return d ? { x: d.x, y: d.y } : null; }
  function addFx(o) { o.t = 0; G.fx.push(o); }

  function handleEvents(evs) {
    const myId = G.myId;
    for (const ev of evs) {
      switch (ev.e) {
        case 'shot': {
          const w = WEAPONS[ev.w];
          const shooter = G.pmap.get(ev.id);
          const ally = shooter && shooter.tm === myTeam();
          const pos = { x: ev.x, y: ev.y };
          if (w) A.playWeapon(w, ev.id === myId ? null : pos, ev.id === myId ? 0.8 : 1);
          const vis = ally || seenByTeam(myTeam(), ev.x, ev.y);
          if (vis) {
            for (const en of ev.ends) addFx({ k: 'trace', x1: ev.x, y1: ev.y, x2: en[0], y2: en[1], max: 0.07, col: ally ? '#9ff5ee' : '#ffb0a8' });
            addFx({ k: 'muzzle', x: ev.x, y: ev.y, a: ev.a, max: 0.06 });
          }
          break;
        }
        case 'hit': {
          if (ev.a === myId) A.play('vurus');
          if (ev.v === myId) { A.play('hasar_aldim'); addFx({ k: 'hurt', max: 0.35 }); }
          const v = G.pmap.get(ev.v);
          if (v && (v.tm === myTeam() || seenByTeam(myTeam(), ev.x, ev.y))) addFx({ k: 'txt', x: ev.x, y: ev.y - 14, text: String(ev.d), max: 0.8, col: ev.a === myId ? COL.gold : '#fff' });
          break;
        }
        case 'kill': {
          const w = ev.w === 'spike' ? 'Spike' : (WEAPONS[ev.w] ? WEAPONS[ev.w].ad : '');
          const k = ev.k ? G.pmap.get(ev.k) : null, v = G.pmap.get(ev.v);
          G.feed.push({ k: ev.k ? nameOf(ev.k) : 'Spike', v: nameOf(ev.v), w, kAlly: k && k.tm === myTeam(), vAlly: v && v.tm === myTeam(), me: ev.k === myId || ev.v === myId, t: 0 });
          if (G.feed.length > 6) G.feed.shift();
          if (ev.k === myId) A.play('oldurme'); else if (ev.v === myId) A.play('olum'); else A.play('olum', posOf(ev.v), 0.7);
          break;
        }
        case 'assist': if (ev.id === myId) { A.play('oldurme', null, 0.5); addFx({ k: 'msg', text: 'ASİST +100$', max: 1.6 }); } break;
        case 'reload': A.play('sarjor', ev.id === myId ? null : posOf(ev.id), 0.6); break;
        case 'empty': if (ev.id === myId) A.play('bos'); break;
        case 'buy': if (ev.id === myId) A.play('satin_al'); break;
        case 'buyFail': if (ev.id === myId) { A.play('hata'); toast('Yetersiz para'); } break;
        case 'plantStart': A.play('spike_kuruluyor', posOf(ev.id)); break;
        case 'planted':
          A.play('spike_kuruldu'); G.big = { text: 'SPIKE KURULDU (' + ev.site + ')', t: 0, max: 2.4, col: COL.gold };
          G.beepT = 0; break;
        case 'defuseStart': A.play('spike_kuruluyor', posOf(ev.id)); break;
        case 'defused': A.play('spike_cozuldu'); break;
        case 'explode': A.play('patlama'); addFx({ k: 'blast', x: ev.x, y: ev.y, max: 1.0 }); break;
        case 'spikeDrop': addFx({ k: 'msg', text: 'SPIKE DÜŞTÜ', max: 2 }); break;
        case 'spikePick': break;
        case 'ability': {
          const map = { duman: 'yet_duman', flas: 'yet_flas', sifa: 'yet_sifa', hiz: 'yet_hiz', radar: 'yet_radar' };
          A.play(map[ev.k], posOf(ev.id), 0.8);
          if (ev.k === 'flas') addFx({ k: 'ping', x: ev.x, y: ev.y, max: 0.45, col: '#fff7a0', r1: 14 });
          break;
        }
        case 'flashPop': A.play('yet_flas', { x: ev.x, y: ev.y }, 1); addFx({ k: 'ping', x: ev.x, y: ev.y, max: 0.5, col: '#ffffff', r1: 90 }); break;
        case 'phase':
          if (ev.ph === 'buy') {
            G.fx = []; G.stepT = new Map();
            A.play('alim_basla');
            G.buyOpen = true; G.big = ev.half ? { text: 'TARAFLAR DEĞİŞTİ', t: 0, max: 3, col: COL.gold } : null;
          } else if (ev.ph === 'live') {
            A.play('raund_basla'); G.buyOpen = false;
            G.big = { text: 'RAUND ' + ev.rd, t: 0, max: 1.4, col: '#fff' };
          }
          break;
        case 'roundEnd': {
          const won = ev.win === mySquad();
          A.play(won ? 'raund_kazan' : 'raund_kaybet');
          G.banner = { text: won ? 'RAUND KAZANILDI' : 'RAUND KAYBEDİLDİ', sub: REASON[ev.reason] || '', col: won ? COL.ally : COL.enemy, t: 0, max: RULES.END_TIME };
          break;
        }
        case 'matchEnd': {
          const won = ev.win === mySquad();
          G.over = { won, sc: ev.sc, t: 0 };
          setTimeout(() => A.play(won ? 'zafer' : 'yenilgi'), 700);
          break;
        }
      }
    }
  }

  function updateAudioAndFx(dt) {
    const s = G.snap;
    if (!s) return;
    const f = focusPos();
    A.setListener(f.x, f.y);
    // efekt ömürleri
    for (const e of G.fx) e.t += dt;
    G.fx = G.fx.filter((e) => e.t < e.max);
    for (const e of G.feed) e.t += dt;
    G.feed = G.feed.filter((e) => e.t < 7);
    if (G.banner) { G.banner.t += dt; if (G.banner.t > G.banner.max) G.banner = null; }
    if (G.big) { G.big.t += dt; if (G.big.t > G.big.max) G.big = null; }
    if (G.over) {
      G.over.t += dt;
      if (G.over.t > 3.2 && $('endbox').style.display !== 'flex') showEnd();
    }
    // spike bip sesi
    if (s.sp.s === 'planted') {
      G.beepT -= dt;
      if (G.beepT <= 0) {
        A.play('spike_bip', { x: s.sp.x, y: s.sp.y }, 1);
        G.beepT = Math.max(0.1, 0.12 + (s.tm / RULES.SPIKE_TIME) * 0.9);
      }
    }
    // ayak sesleri (koşan düşmanlar)
    for (const p of s.ps) {
      if (!p.al || p.id === G.myId || !p.mv) continue;
      let t = (G.stepT.get(p.id) || 0) - dt;
      if (t <= 0) { A.play('adim', { x: p.x, y: p.y }, 1.2); t = 0.34; }
      G.stepT.set(p.id, t);
    }
    // arayüz panelleri
    G.buyHover = false;
    const buyShow = G.buyOpen && s.ph === 'buy' && !G.over;
    if (buyShow) updateBuy(); else $('buy').style.display = 'none';
    if (G.showScore) updateScore(); else $('score').style.display = 'none';
  }

  // ======================================================================
  //  Çizim
  // ======================================================================
  function draw(dt) {
    const s = G.snap;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#080b10';
    ctx.fillRect(0, 0, cv.width, cv.height);
    if (!s) return;
    updateCamera();
    const c = G.cam;
    const base = [dpr * c.s, 0, 0, dpr * c.s, dpr * (W / 2 - c.x * c.s), dpr * (H / 2 - c.y * c.s)];
    ctx.setTransform(...base);
    ctx.drawImage(mapImg, 0, 0);

    const fid = focusId();
    const fp = G.pmap.get(fid);
    const fd = G.disp.get(fid) || { x: 0, y: 0, a: 0 };
    const myT = myTeam();
    const blind = fp ? fp.bl : 0;

    // görüş alanı (sis)
    drawFog(base, fd, fp && fp.al, blind);

    // görünen düşmanlar
    G.vis = new Set();
    for (const p of s.ps) {
      if (p.tm === myT || !p.al) continue;
      const d = G.disp.get(p.id) || p;
      if (p.rv === myT || seenByTeam(myT, d.x, d.y)) G.vis.add(p.id);
    }

    ctx.setTransform(...base);
    drawSpike(s, myT);
    // ölüler
    for (const p of s.ps) {
      if (p.al) continue;
      const d = G.disp.get(p.id) || p;
      ctx.strokeStyle = p.tm === myT ? 'rgba(58,209,196,.5)' : 'rgba(255,90,77,.5)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(d.x - 6, d.y - 6); ctx.lineTo(d.x + 6, d.y + 6); ctx.moveTo(d.x + 6, d.y - 6); ctx.lineTo(d.x - 6, d.y + 6); ctx.stroke();
    }
    // canlılar
    for (const p of s.ps) {
      if (!p.al) continue;
      const ally = p.tm === myT;
      if (!ally && !G.vis.has(p.id)) continue;
      drawPlayer(p, ally);
    }
    // dumanlar
    for (const sm of s.sm) {
      const fade = Math.min(1, sm[3] / 1.2);
      const g = ctx.createRadialGradient(sm[0], sm[1], 4, sm[0], sm[1], sm[2]);
      g.addColorStop(0, `rgba(190,200,215,${0.97 * fade})`); g.addColorStop(0.8, `rgba(165,178,198,${0.93 * fade})`); g.addColorStop(1, 'rgba(150,165,185,0)');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(sm[0], sm[1], sm[2], 0, 7); ctx.fill();
    }
    drawFx();

    // ---- ekran katmanı ----
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (blind > 0) {
      ctx.fillStyle = `rgba(255,255,255,${clamp(blind / 1.2, 0, 1) * 0.97})`;
      ctx.fillRect(0, 0, W, H);
    }
    const hurt = G.fx.find((e) => e.k === 'hurt');
    if (hurt) { ctx.fillStyle = `rgba(255,40,30,${0.35 * (1 - hurt.t / hurt.max)})`; ctx.fillRect(0, 0, W, H); }
    drawMinimap(s, myT);
    drawHud(s, fp, myT);
    drawCrosshair(fp);
  }

  function drawFog(base, fd, alive, blind) {
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.globalCompositeOperation = 'source-over';
    fctx.clearRect(0, 0, fog.width, fog.height);
    fctx.fillStyle = 'rgba(2,4,9,0.58)';
    fctx.fillRect(0, 0, fog.width, fog.height);
    if (!blind || blind <= 0) {
      fctx.globalCompositeOperation = 'destination-out';
      fctx.setTransform(...base);
      fctx.fillStyle = '#000';
      const R = RULES.VIEW_RANGE, half = (RULES.FOV * Math.PI) / 360;
      // görüş konisi
      fctx.beginPath(); fctx.moveTo(fd.x, fd.y);
      const N = 110;
      for (let i = 0; i <= N; i++) {
        const a = fd.a - half + (2 * half * i) / N;
        const d = S.raycast(fd.x, fd.y, a, R);
        fctx.lineTo(fd.x + Math.cos(a) * d, fd.y + Math.sin(a) * d);
      }
      fctx.closePath(); fctx.fill();
      // çevre görüşü
      fctx.beginPath();
      const M = 64;
      for (let i = 0; i < M; i++) {
        const a = (i / M) * Math.PI * 2;
        const d = S.raycast(fd.x, fd.y, a, 85);
        const px = fd.x + Math.cos(a) * d, py = fd.y + Math.sin(a) * d;
        if (i === 0) fctx.moveTo(px, py); else fctx.lineTo(px, py);
      }
      fctx.closePath(); fctx.fill();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(fog, 0, 0);
  }

  function drawPlayer(p, ally) {
    const d = G.disp.get(p.id) || p;
    const col = ally ? COL.ally : COL.enemy;
    const ag = agentOf(p);
    ctx.save();
    ctx.translate(d.x, d.y);
    // yetenek halkaları
    if (p.bo) { ctx.strokeStyle = 'rgba(255,200,60,.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 17, 0, 7); ctx.stroke(); }
    if (p.rv && !ally) { ctx.strokeStyle = 'rgba(255,60,60,.8)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 20, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
    ctx.rotate(d.a);
    // silah
    const w = WEAPONS[p.w];
    const len = w && w.tur === 'Keskin' ? 26 : w && (w.tur === 'Tüfek' || w.tur === 'Pompalı') ? 22 : w && w.tur === 'Yakın' ? 15 : 17;
    ctx.fillStyle = '#c9d2e3'; ctx.fillRect(6, -2, len - 6, 4);
    ctx.rotate(-d.a);
    // gövde
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, RULES.PLAYER_R, 0, 7); ctx.fill();
    ctx.fillStyle = ag ? ag.renk : '#fff'; ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, 7); ctx.fill();
    ctx.strokeStyle = p.id === G.myId ? '#fff' : 'rgba(0,0,0,.55)'; ctx.lineWidth = p.id === G.myId ? 2.5 : 1.5;
    ctx.beginPath(); ctx.arc(0, 0, RULES.PLAYER_R, 0, 7); ctx.stroke();
    ctx.restore();
    if (ally) {
      // isim + can çubuğu
      ctx.font = '600 11px Segoe UI, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillText(nameOf(p.id), d.x + 1, d.y - 20 + 1);
      ctx.fillStyle = '#e8fffd'; ctx.fillText(nameOf(p.id), d.x, d.y - 20);
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(d.x - 15, d.y - 19, 30, 4);
      ctx.fillStyle = p.hp > 40 ? '#6df5a5' : '#ffb347'; ctx.fillRect(d.x - 15, d.y - 19, 30 * (p.hp / 100), 4);
    }
    // kurma/çözme çubuğu
    if (p.pl > 0) { ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(d.x - 16, d.y + 16, 32, 5); ctx.fillStyle = COL.gold; ctx.fillRect(d.x - 16, d.y + 16, 32 * p.pl, 5); }
  }
  function agentOf(p) {
    const r = G.roster.get(p.id);
    const list = AGENTS[p.tm];
    if (!r) return list[0];
    let slot = 0;
    for (const x of G.roster.values()) { if (x.id === r.id) break; if (x.squad === r.squad) slot++; }
    return list[slot % 5];
  }

  function drawSpike(s, myT) {
    const sp = s.sp;
    if (sp.s === 'planted' || sp.s === 'defused') {
      const t = performance.now() / 1000;
      const pulse = sp.s === 'planted' ? (Math.sin(t * (4 + (1 - s.tm / RULES.SPIKE_TIME) * 14)) + 1) / 2 : 0;
      ctx.fillStyle = sp.s === 'defused' ? '#4ade80' : '#ff3b30';
      ctx.beginPath(); ctx.arc(sp.x, sp.y, 8, 0, 7); ctx.fill();
      ctx.strokeStyle = `rgba(255,70,60,${0.2 + 0.6 * pulse})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(sp.x, sp.y, 12 + 14 * pulse, 0, 7); ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.fillRect(sp.x - 2, sp.y - 2, 4, 4);
    } else if (sp.s === 'dropped' && myT === 'atk') {
      ctx.fillStyle = COL.gold; ctx.fillRect(sp.x - 6, sp.y - 6, 12, 12);
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5; ctx.strokeRect(sp.x - 6, sp.y - 6, 12, 12);
    } else if (sp.s === 'carried' && myT === 'atk') {
      const d = G.disp.get(sp.c);
      if (d) { ctx.fillStyle = COL.gold; ctx.fillRect(d.x - 4, d.y + 12, 8, 6); ctx.strokeStyle = '#000'; ctx.lineWidth = 1; ctx.strokeRect(d.x - 4, d.y + 12, 8, 6); }
    }
  }

  function drawFx() {
    for (const e of G.fx) {
      const k = e.t / e.max;
      if (e.k === 'trace') {
        ctx.strokeStyle = e.col; ctx.globalAlpha = 1 - k; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(e.x1, e.y1); ctx.lineTo(e.x2, e.y2); ctx.stroke(); ctx.globalAlpha = 1;
      } else if (e.k === 'muzzle') {
        ctx.save(); ctx.translate(e.x, e.y); ctx.rotate(e.a); ctx.fillStyle = `rgba(255,220,120,${1 - k})`;
        ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(28, -5); ctx.lineTo(28, 5); ctx.closePath(); ctx.fill(); ctx.restore();
      } else if (e.k === 'txt') {
        ctx.globalAlpha = 1 - k; ctx.fillStyle = e.col; ctx.font = '700 15px Segoe UI, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeText(e.text, e.x, e.y - 22 * k); ctx.fillText(e.text, e.x, e.y - 22 * k); ctx.globalAlpha = 1;
      } else if (e.k === 'ping') {
        ctx.globalAlpha = 1 - k; ctx.fillStyle = e.col; ctx.beginPath(); ctx.arc(e.x, e.y, 6 + (e.r1 - 6) * k, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      } else if (e.k === 'blast') {
        ctx.globalAlpha = 1 - k; ctx.fillStyle = '#ffae42'; ctx.beginPath(); ctx.arc(e.x, e.y, 420 * Math.min(1, k * 2.5), 0, 7); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.stroke(); ctx.globalAlpha = 1;
      }
    }
  }

  function drawCrosshair(fp) {
    if (!fp || !fp.al) return;
    const x = G.mouse.x, y = G.mouse.y;
    ctx.strokeStyle = '#46ff9a'; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 10, y); ctx.lineTo(x - 4, y); ctx.moveTo(x + 4, y); ctx.lineTo(x + 10, y);
    ctx.moveTo(x, y - 10); ctx.lineTo(x, y - 4); ctx.moveTo(x, y + 4); ctx.lineTo(x, y + 10); ctx.stroke();
  }

  function drawMinimap(s, myT) {
    const sc = 0.13, w = MAPW * sc, h = MAPH * sc, x0 = 14, y0 = 14;
    ctx.globalAlpha = 0.85; ctx.drawImage(mapImg, x0, y0, w, h); ctx.globalAlpha = 1;
    ctx.strokeStyle = '#2a3345'; ctx.lineWidth = 1; ctx.strokeRect(x0, y0, w, h);
    for (const p of s.ps) {
      if (!p.al) continue;
      const ally = p.tm === myT;
      if (!ally && !G.vis.has(p.id)) continue;
      const d = G.disp.get(p.id) || p;
      ctx.fillStyle = ally ? COL.ally : COL.enemy;
      ctx.beginPath(); ctx.arc(x0 + d.x * sc, y0 + d.y * sc, p.id === G.myId ? 4 : 3, 0, 7); ctx.fill();
      if (p.id === G.myId) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1; ctx.stroke(); }
    }
    if (s.sp.s === 'planted') { ctx.fillStyle = '#ff3b30'; ctx.fillRect(x0 + s.sp.x * sc - 3, y0 + s.sp.y * sc - 3, 6, 6); }
    else if (s.sp.s === 'dropped' && myT === 'atk') { ctx.fillStyle = COL.gold; ctx.fillRect(x0 + s.sp.x * sc - 3, y0 + s.sp.y * sc - 3, 6, 6); }
  }

  function fmtTime(t) { t = Math.max(0, Math.ceil(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); }
  function txt(t, x, y, size, col, align, weight) {
    ctx.font = (weight || 700) + ' ' + size + 'px Segoe UI, Arial'; ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.strokeText(t, x, y);
    ctx.fillStyle = col || '#fff'; ctx.fillText(t, x, y);
  }

  function drawHud(s, fp, myT) {
    const cx = W / 2;
    const sq = mySquad();
    const my = s.sc[sq], en = s.sc[1 - sq];
    // üst bar
    ctx.fillStyle = 'rgba(8,12,19,.78)'; ctx.fillRect(cx - 150, 0, 300, 52);
    ctx.fillStyle = 'rgba(58,209,196,.9)'; ctx.fillRect(cx - 150, 0, 3, 52);
    ctx.fillStyle = 'rgba(255,90,77,.9)'; ctx.fillRect(cx + 147, 0, 3, 52);
    txt(String(my), cx - 108, 38, 32, COL.ally, 'center');
    txt(String(en), cx + 108, 38, 32, COL.enemy, 'center');
    let tcol = '#fff', label = '';
    if (s.ph === 'buy') { label = 'ALIM FAZI'; tcol = COL.gold; }
    else if (s.sp.s === 'planted') { label = 'SPIKE KURULDU'; tcol = '#ff5a4d'; }
    else if (s.ph === 'end') label = 'RAUND SONU';
    else label = 'RAUND ' + s.rd;
    txt(fmtTime(s.tm), cx, 32, 26, tcol, 'center');
    txt(label, cx, 47, 11, COL.dim, 'center', 600);
    const mine = G.pmap.get(G.myId);
    if (mine) txt(SIDE[mine.tm], cx - 108, 50, 10, COL.dim, 'center', 600);
    txt('İLK 13', cx + 108, 50, 10, COL.dim, 'center', 600);
    // canlı sayıları
    const alive = (t) => s.ps.filter((p) => p.tm === t && p.al).length;
    txt(alive(myT) + ' canlı', cx - 40, 66, 11, COL.ally, 'right', 600);
    txt(alive(myT === 'atk' ? 'def' : 'atk') + ' canlı', cx + 40, 66, 11, COL.enemy, 'left', 600);

    // öldürme akışı
    let y = 20;
    ctx.textBaseline = 'middle';
    for (const f of G.feed) {
      const text = `${f.k}  [${f.w}]  ${f.v}`;
      ctx.font = '600 13px Segoe UI, Arial';
      const wd = ctx.measureText(text).width + 20;
      ctx.fillStyle = f.me ? 'rgba(255,212,94,.35)' : 'rgba(8,12,19,.75)';
      ctx.fillRect(W - wd - 14, y - 12, wd, 24);
      ctx.textAlign = 'left';
      let x = W - wd - 4;
      ctx.fillStyle = f.kAlly ? COL.ally : COL.enemy; ctx.fillText(f.k, x, y); x += ctx.measureText(f.k + '  ').width;
      ctx.fillStyle = COL.dim; ctx.fillText('[' + f.w + ']', x, y); x += ctx.measureText('[' + f.w + ']  ').width;
      ctx.fillStyle = f.vAlly ? COL.ally : COL.enemy; ctx.fillText(f.v, x, y);
      y += 28;
    }

    if (!fp) return;
    const isMe = fp.id === G.myId;
    // sol alt: can / zırh
    txt(String(fp.hp), 26, H - 30, 46, fp.hp > 40 ? '#fff' : '#ff7b6e', 'left');
    txt('CAN', 28, H - 78, 11, COL.dim, 'left', 600);
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(26, H - 24, 180, 6);
    ctx.fillStyle = '#6df5a5'; ctx.fillRect(26, H - 24, 180 * (fp.hp / 100), 6);
    if (fp.ar > 0) {
      txt(String(fp.ar), 140, H - 30, 26, '#8fc8ff', 'left');
      ctx.fillStyle = '#8fc8ff'; ctx.fillRect(26, H - 14, 180 * (fp.ar / 50), 4);
    }
    // sağ alt: silah / mermi / para
    const w = WEAPONS[fp.w];
    txt(w.ad.toUpperCase(), W - 26, H - 78, 14, COL.dim, 'right', 700);
    if (w.mag > 0) {
      txt(String(fp.mg), W - 110, H - 30, 46, fp.mg === 0 ? '#ff7b6e' : '#fff', 'right');
      txt('/ ' + fp.rs, W - 26, H - 32, 20, COL.dim, 'right');
    } else txt('—', W - 26, H - 30, 40, '#fff', 'right');
    if (fp.rl > 0) {
      ctx.fillStyle = 'rgba(0,0,0,.6)'; ctx.fillRect(W - 206, H - 20, 180, 6);
      ctx.fillStyle = COL.gold; ctx.fillRect(W - 206, H - 20, 180 * fp.rl, 6);
      txt('ŞARJÖR DEĞİŞİYOR', W - 26, H - 98, 11, COL.gold, 'right', 600);
    }
    txt('$ ' + fp.mo, W - 26, H - 112, 22, COL.gold, 'right');
    // silah yuvaları
    const slots = [['1', fp.sl[0]], ['2', fp.sl[1]], ['3', 'bicak']];
    let sx = W - 26;
    for (let i = slots.length - 1; i >= 0; i--) {
      const [key, id] = slots[i];
      if (!id) continue;
      const nm = WEAPONS[id].ad;
      ctx.font = '600 12px Segoe UI, Arial';
      const wd = ctx.measureText(key + ' ' + nm).width + 16;
      ctx.fillStyle = id === fp.w ? 'rgba(255,255,255,.22)' : 'rgba(8,12,19,.6)';
      ctx.fillRect(sx - wd, H - 148, wd, 22);
      ctx.fillStyle = id === fp.w ? '#fff' : COL.dim; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.fillText(key + ' ' + nm, sx - wd + 8, H - 137);
      sx -= wd + 6;
    }
    // yetenek
    const ag = agentOf(fp);
    if (ag) {
      const ready = fp.ch > 0;
      ctx.fillStyle = 'rgba(8,12,19,.78)'; ctx.fillRect(cx - 120, H - 60, 240, 44);
      ctx.fillStyle = ag.renk; ctx.fillRect(cx - 120, H - 60, 4, 44);
      txt('E', cx - 100, H - 32, 20, ready ? '#fff' : COL.dim, 'center');
      txt(ag.ad + ' · ' + abilityName(ag.yetenek), cx - 80, H - 38, 13, ready ? '#fff' : COL.dim, 'left', 600);
      txt('Hak: ' + fp.ch, cx - 80, H - 22, 11, ready ? ag.renk : COL.dim, 'left', 600);
    }
    // ipuçları ve ilerleme
    let hint = '';
    if (!isMe) hint = 'İZLİYORSUN: ' + nameOf(fp.id) + '  (tıkla: sonraki)';
    else if (s.ph === 'live') {
      if (fp.tm === 'atk' && s.sp.s === 'carried' && s.sp.c === fp.id) {
        const inSite = Object.values(SITES).some((st) => fp.x >= st.x && fp.x <= st.x + st.w && fp.y >= st.y && fp.y <= st.y + st.h);
        hint = inSite ? 'Spike kurmak için F tuşunu BASILI TUT (dur)' : 'Spike sende: A veya B bölgesine götür';
      } else if (fp.tm === 'atk' && s.sp.s === 'dropped') hint = 'Spike yerde! Üzerinden geç';
      else if (fp.tm === 'def' && s.sp.s === 'planted' && Math.hypot(fp.x - s.sp.x, fp.y - s.sp.y) < 42) hint = 'Çözmek için F tuşunu BASILI TUT (dur)';
    } else if (s.ph === 'buy') hint = 'B: alım menüsü';
    if (hint) txt(hint, cx, H - 78, 15, '#fff', 'center', 600);
    let prog = 0, plabel = '';
    if (fp.pl > 0) { prog = fp.pl; plabel = 'SPIKE KURULUYOR'; }
    else if (s.sp.s === 'planted' && s.sp.d === fp.id) { prog = s.sp.p / RULES.DEFUSE_TIME; plabel = 'SPIKE ÇÖZÜLÜYOR'; }
    if (prog > 0) {
      ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(cx - 120, H / 2 + 70, 240, 12);
      ctx.fillStyle = COL.gold; ctx.fillRect(cx - 120, H / 2 + 70, 240 * clamp(prog, 0, 1), 12);
      txt(plabel, cx, H / 2 + 62, 13, '#fff', 'center');
    } else if (s.sp.s === 'planted' && s.sp.d && s.sp.d !== fp.id) {
      txt('SPIKE ÇÖZÜLÜYOR… %' + Math.round((s.sp.p / RULES.DEFUSE_TIME) * 100), cx, 100, 14, '#8fc8ff', 'center');
    }
    // büyük mesajlar
    if (G.big) {
      const a = 1 - Math.max(0, (G.big.t - (G.big.max - 0.6)) / 0.6);
      ctx.globalAlpha = clamp(a, 0, 1);
      txt(G.big.text, cx, H * 0.26, 38, G.big.col, 'center', 800);
      ctx.globalAlpha = 1;
    }
    const msg = G.fx.find((e) => e.k === 'msg');
    if (msg) txt(msg.text, cx, H * 0.34, 20, COL.gold, 'center');
    if (G.banner) {
      ctx.fillStyle = 'rgba(8,12,19,.78)'; ctx.fillRect(0, H * 0.3, W, 110);
      ctx.fillStyle = G.banner.col; ctx.fillRect(0, H * 0.3, W, 3); ctx.fillRect(0, H * 0.3 + 107, W, 3);
      txt(G.banner.text, cx, H * 0.3 + 55, 44, G.banner.col, 'center', 800);
      txt(G.banner.sub, cx, H * 0.3 + 88, 17, '#fff', 'center', 600);
    }
  }
  function abilityName(k) { return { hiz: 'Hız', radar: 'Radar', duman: 'Duman', flas: 'Flaş', sifa: 'Şifa' }[k] || k; }

  // ======================================================================
  //  DOM panelleri: alım menüsü, skor, maç sonu
  // ======================================================================
  const GROUPS = [
    ['Tabanca', ['firtina', 'kasirga']], ['SMG', ['ari']], ['Pompalı', ['gurz']], ['Tüfek', ['yildirim', 'kartal']], ['Keskin', ['sahin']],
  ];
  const buyEl = $('buy');
  function updateBuy() {
    const fp = G.pmap.get(G.myId);
    if (!fp) return;
    const sig = [fp.mo, fp.sl.join(), fp.ar, G.snap.tm | 0].join('|');
    buyEl.style.display = 'block';
    if (sig === G.lastBuySig) return;
    G.lastBuySig = sig;
    let h = `<h3><span>ALIM MENÜSÜ <small style="color:#8b97ad">(${fmtTime(G.snap.tm)})</small></span><span class="money">$ ${fp.mo}</span></h3>`;
    for (const [g, ids] of GROUPS) {
      h += `<div class="grp">${g}</div>`;
      for (const id of ids) {
        const w = WEAPONS[id];
        const own = fp.sl[0] === id || fp.sl[1] === id;
        const no = !own && fp.mo + (0) < w.cost;
        const pel = w.pellets > 1 ? ` ×${w.pellets}` : '';
        h += `<div class="item ${own ? 'own' : ''} ${no ? 'no' : ''}" data-buy="${id}"><span>${w.ad}<small>${w.tur} · hasar ${w.dmg}${pel} · ${w.rate}/sn · ${w.mag ? w.mag + ' mermi' : ''}</small></span><span class="c">${own ? 'SENDE' : '$' + w.cost}</span></div>`;
      }
    }
    h += '<div class="grp">Zırh</div>';
    for (const id of ['hafif', 'agir']) {
      const a = ARMORS[id];
      const own = fp.ar >= a.amount;
      const no = !own && fp.mo < a.cost;
      h += `<div class="item ${own ? 'own' : ''} ${no ? 'no' : ''}" data-buy="${id}"><span>${a.ad}<small>${a.amount} zırh</small></span><span class="c">${own ? 'SENDE' : '$' + a.cost}</span></div>`;
    }
    h += '<div class="hint">Tıkla ve satın al · B: menüyü kapat</div>';
    buyEl.innerHTML = h;
  }
  buyEl.addEventListener('mousedown', (e) => {
    const it = e.target.closest('[data-buy]');
    if (!it) return;
    G.one.cmds.push({ t: 'buy', item: it.getAttribute('data-buy') });
    G.lastBuySig = '';
  });
  buyEl.addEventListener('mouseenter', () => { G.buyHover = true; });

  function updateScore() {
    const s = G.snap;
    const sq = mySquad();
    const myT = myTeam();
    const rows = (team) => {
      const list = s.ps.filter((p) => p.tm === team);
      return list.map((p) => {
        const ag = agentOf(p);
        const showMoney = team === myT;
        return `<tr class="${p.id === G.myId ? 'me' : ''} ${p.al ? '' : 'dead'}"><td>${esc(nameOf(p.id))}</td><td>${ag ? ag.ad : ''}</td><td>${p.k} / ${p.d} / ${p.as}</td><td>${showMoney ? '$' + p.mo : '—'}</td><td>${p.al ? p.hp : 'ÖLDÜ'}</td></tr>`;
      }).join('');
    };
    const head = '<tr><th>OYUNCU</th><th>KARAKTER</th><th>ÖLDÜRME / ÖLÜM / ASİST</th><th>PARA</th><th>CAN</th></tr>';
    const enT = myT === 'atk' ? 'def' : 'atk';
    $('scoreBox').innerHTML =
      `<h4 style="color:#3ad1c4">TAKIMIN · ${SIDE[myT]} · ${s.sc[sq]}</h4><table>${head}${rows(myT)}</table>` +
      `<h4 style="color:#ff5a4d">DÜŞMAN · ${SIDE[enT]} · ${s.sc[1 - sq]}</h4><table>${head}${rows(enT)}</table>`;
    $('score').style.display = 'flex';
  }

  function showEnd() {
    const o = G.over;
    $('endTitle').textContent = o.won ? 'ZAFER' : 'YENİLGİ';
    $('endTitle').style.color = o.won ? COL.ally : COL.enemy;
    $('endSub').textContent = `Skor: ${o.sc[mySquad()]} - ${o.sc[1 - mySquad()]}`;
    $('btnEndBack').textContent = G.mode === 'offline' ? 'Menüye dön' : G.mode === 'host' ? 'Lobiye dön (herkes için)' : 'Lobiye dön';
    $('endbox').style.display = 'flex';
    G.showScore = false;
  }

  // ======================================================================
  requestAnimationFrame(frame);
  window.__G = G; // hata ayıklama için
})();
