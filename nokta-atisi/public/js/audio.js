// Nokta Atışı - ses efektleri (WebAudio ile üretilir, dosya gerekmez)
(function (root) {
  let ctx = null;
  let master = null;
  let noiseBuf = null;
  const listener = { x: 0, y: 0 };
  let volume = 0.6;

  function init() {
    if (ctx) return;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = volume;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp);
    comp.connect(ctx.destination);
    const len = ctx.sampleRate * 1;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  function resume() {
    init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  // Konuma göre ses seviyesi ve sağ/sol dengesi
  function spatial(pos) {
    if (!pos) return { vol: 1, pan: 0 };
    const dx = pos.x - listener.x;
    const dy = pos.y - listener.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const vol = Math.max(0, 1 - dist / 1400);
    return { vol: vol * vol, pan: Math.max(-1, Math.min(1, dx / 700)) };
  }
  function outNode(pos, gainMul) {
    const s = spatial(pos);
    const g = ctx.createGain();
    g.gain.value = s.vol * (gainMul == null ? 1 : gainMul);
    let last = g;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = s.pan;
      g.connect(p);
      last = p;
    }
    last.connect(master);
    return { input: g, vol: s.vol };
  }

  function noise(out, t, dur, freq, q, type, peak) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type || 'lowpass';
    f.frequency.value = freq;
    f.Q.value = q || 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }
  function tone(out, t, dur, f0, f1, type, peak) {
    const o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  const SOUNDS = {
    // silah sesleri
    ates_tabanca(o, t) { noise(o, t, 0.12, 2600, 0.8, 'lowpass', 0.9); tone(o, t, 0.1, 220, 80, 'square', 0.35); },
    ates_smg(o, t)     { noise(o, t, 0.09, 3200, 0.8, 'lowpass', 0.7); tone(o, t, 0.07, 260, 110, 'square', 0.25); },
    ates_tufek(o, t)   { noise(o, t, 0.18, 2200, 0.8, 'lowpass', 1.0); tone(o, t, 0.15, 160, 55, 'sawtooth', 0.45); },
    ates_pompali(o, t) { noise(o, t, 0.35, 1400, 0.6, 'lowpass', 1.3); tone(o, t, 0.28, 110, 40, 'sawtooth', 0.6); },
    ates_keskin(o, t)  { noise(o, t, 0.6, 1100, 0.6, 'lowpass', 1.5); tone(o, t, 0.5, 90, 30, 'sawtooth', 0.8); noise(o, t + 0.04, 0.3, 5000, 1, 'highpass', 0.3); },
    bicak(o, t)        { noise(o, t, 0.12, 4000, 1.2, 'bandpass', 0.5); },
    sarjor(o, t)       { tone(o, t, 0.05, 900, 600, 'square', 0.12); tone(o, t + 0.55, 0.06, 500, 900, 'square', 0.15); noise(o, t + 0.55, 0.05, 3000, 1, 'highpass', 0.2); },
    bos(o, t)          { tone(o, t, 0.04, 1200, 800, 'square', 0.12); },
    adim(o, t)         { noise(o, t, 0.06, 500, 0.8, 'lowpass', 0.18); },
    // hasar / öldürme
    vurus(o, t)        { tone(o, t, 0.08, 1800, 1500, 'sine', 0.5); },
    hasar_aldim(o, t)  { noise(o, t, 0.2, 500, 0.7, 'lowpass', 0.9); tone(o, t, 0.15, 140, 70, 'sine', 0.6); },
    oldurme(o, t)      { tone(o, t, 0.12, 880, 880, 'triangle', 0.5); tone(o, t + 0.1, 0.25, 1320, 1320, 'triangle', 0.5); },
    olum(o, t)         { tone(o, t, 0.5, 300, 60, 'sawtooth', 0.4); noise(o, t, 0.4, 700, 0.7, 'lowpass', 0.5); },
    // spike
    spike_bip(o, t)    { tone(o, t, 0.12, 1750, 1750, 'square', 0.35); },
    spike_kuruluyor(o, t) { tone(o, t, 0.08, 1000, 1000, 'square', 0.2); },
    spike_kuruldu(o, t){ tone(o, t, 0.5, 520, 520, 'sawtooth', 0.35); tone(o, t + 0.25, 0.7, 390, 390, 'sawtooth', 0.35); },
    spike_cozuldu(o, t){ tone(o, t, 0.25, 600, 1200, 'triangle', 0.5); tone(o, t + 0.2, 0.4, 900, 1800, 'triangle', 0.5); },
    patlama(o, t)      { noise(o, t, 1.4, 700, 0.5, 'lowpass', 2.0); tone(o, t, 1.2, 70, 25, 'sawtooth', 1.0); noise(o, t, 0.5, 200, 0.5, 'lowpass', 1.5); },
    // arayüz
    satin_al(o, t)     { tone(o, t, 0.08, 1500, 1500, 'triangle', 0.4); tone(o, t + 0.07, 0.15, 2000, 2000, 'triangle', 0.4); },
    hata(o, t)         { tone(o, t, 0.15, 200, 150, 'square', 0.3); },
    raund_basla(o, t)  { tone(o, t, 0.25, 440, 440, 'sawtooth', 0.4); tone(o, t + 0.25, 0.5, 660, 660, 'sawtooth', 0.4); },
    alim_basla(o, t)   { tone(o, t, 0.12, 700, 700, 'triangle', 0.35); tone(o, t + 0.14, 0.12, 700, 700, 'triangle', 0.35); },
    raund_kazan(o, t)  { tone(o, t, 0.18, 523, 523, 'triangle', 0.5); tone(o, t + 0.18, 0.18, 659, 659, 'triangle', 0.5); tone(o, t + 0.36, 0.5, 784, 784, 'triangle', 0.5); },
    raund_kaybet(o, t) { tone(o, t, 0.25, 392, 392, 'triangle', 0.5); tone(o, t + 0.25, 0.25, 330, 330, 'triangle', 0.5); tone(o, t + 0.5, 0.6, 262, 262, 'triangle', 0.5); },
    zafer(o, t)        { [523, 659, 784, 1047].forEach((f, i) => tone(o, t + i * 0.16, 0.4, f, f, 'triangle', 0.5)); },
    yenilgi(o, t)      { [392, 349, 311, 262].forEach((f, i) => tone(o, t + i * 0.22, 0.5, f, f, 'triangle', 0.5)); },
    // yetenekler
    yet_duman(o, t)    { noise(o, t, 0.8, 900, 0.5, 'lowpass', 0.7); },
    yet_flas(o, t)     { tone(o, t, 0.5, 3000, 800, 'sine', 0.5); noise(o, t, 0.15, 6000, 1, 'highpass', 0.6); },
    yet_sifa(o, t)     { tone(o, t, 0.6, 400, 900, 'sine', 0.4); tone(o, t + 0.1, 0.6, 600, 1200, 'sine', 0.3); },
    yet_hiz(o, t)      { tone(o, t, 0.4, 200, 900, 'sawtooth', 0.3); },
    yet_radar(o, t)    { tone(o, t, 0.3, 1200, 1200, 'sine', 0.4); tone(o, t + 0.3, 0.3, 1200, 1200, 'sine', 0.3); },
    kor(o, t)          { tone(o, t, 1.5, 4000, 4000, 'sine', 0.25); },
  };

  function play(name, pos, gain) {
    if (!ctx || ctx.state !== 'running') return;
    const fn = SOUNDS[name];
    if (!fn) return;
    const out = outNode(pos, gain);
    if (out.vol <= 0.002) return;
    fn(out.input, ctx.currentTime + 0.005);
  }
  function playWeapon(w, pos, gain) {
    const map = { Tabanca: 'ates_tabanca', SMG: 'ates_smg', 'Tüfek': 'ates_tufek', 'Pompalı': 'ates_pompali', Keskin: 'ates_keskin', 'Yakın': 'bicak' };
    play(map[w.tur] || 'ates_tabanca', pos, gain);
  }

  root.GAMEAUDIO = {
    init, resume, play, playWeapon,
    setListener(x, y) { listener.x = x; listener.y = y; },
    setVolume(v) { volume = v; if (master) master.gain.value = v; },
    get volume() { return volume; },
  };
})(typeof window !== 'undefined' ? window : globalThis);
