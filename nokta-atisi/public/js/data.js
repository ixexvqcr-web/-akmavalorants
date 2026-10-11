// Nokta Atışı - ortak veriler (harita, silahlar, ajanlar, ekonomi)
// Hem tarayıcıda hem Node'da çalışır (test için).
(function (root) {
  const TILE = 32;
  const COLS = 48;
  const ROWS = 30;

  // ---------- HARİTA ----------
  // Önce her yer duvar, sonra odalar/koridorlar oyulur. Bağlantı garantilidir.
  const grid = [];
  for (let y = 0; y < ROWS; y++) grid.push(new Array(COLS).fill(1));
  function carve(x, y, w, h) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grid[j][i] = 0;
  }
  function block(x, y, w, h) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grid[j][i] = 1;
  }
  carve(2, 11, 7, 8);    // saldıran başlangıç odası
  carve(9, 13, 6, 4);    // saldıran çıkış koridoru
  carve(15, 11, 18, 8);  // orta alan
  carve(4, 5, 3, 6);     // üst kola çıkış
  carve(4, 4, 26, 4);    // üst salon (A yolu)
  carve(30, 2, 14, 8);   // A bölgesi
  carve(4, 19, 3, 6);    // alt kola çıkış
  carve(4, 22, 26, 4);   // alt salon (B yolu)
  carve(30, 20, 14, 8);  // B bölgesi
  carve(20, 8, 4, 3);    // orta -> A bağlantısı
  carve(20, 19, 4, 3);   // orta -> B bağlantısı
  carve(33, 13, 4, 4);   // orta -> savunan koridoru
  carve(37, 11, 9, 8);   // savunan başlangıç odası
  carve(39, 10, 4, 1);   // savunan -> A
  carve(39, 19, 4, 1);   // savunan -> B
  // Siper blokları
  block(34, 4, 2, 2);
  block(39, 6, 2, 2);
  block(34, 24, 2, 2);
  block(39, 21, 2, 2);
  block(22, 13, 2, 2);
  block(27, 15, 2, 2);
  block(18, 16, 1, 1);
  block(12, 5, 2, 2);
  block(12, 22, 2, 2);

  const SITES = {
    A: { x: 33 * TILE, y: 3 * TILE, w: 9 * TILE, h: 6 * TILE, name: 'A' },
    B: { x: 33 * TILE, y: 21 * TILE, w: 9 * TILE, h: 6 * TILE, name: 'B' },
  };
  const SPAWNS = {
    atk: [], // saldıranlar
    def: [], // savunanlar
  };
  for (let i = 0; i < 5; i++) {
    SPAWNS.atk.push({ x: (3 + (i % 2) * 2 + 0.5) * TILE, y: (12 + i + 0.5) * TILE });
    SPAWNS.def.push({ x: (39 + (i % 2) * 2 + 0.5) * TILE, y: (12 + i + 0.5) * TILE });
  }

  // ---------- SİLAHLAR ----------
  // dmg: bir mermi hasarı, rate: saniyede atış, spread: sapma (derece),
  // range: menzil (px), pellets: saçma sayısı, auto: basılı tutarak ateş
  const WEAPONS = {
    bicak:   { id: 'bicak',   ad: 'Bıçak',    tur: 'Yakın',   cost: 0,    dmg: 55, rate: 1.8, mag: 0,  res: 0,  reload: 0,   spread: 0,   range: 46,   pellets: 1, auto: false, slot: 3 },
    caylak:  { id: 'caylak',  ad: 'Çaylak',   tur: 'Tabanca', cost: 0,    dmg: 26, rate: 6,   mag: 12, res: 36, reload: 1.5, spread: 2.5, range: 700,  pellets: 1, auto: false, slot: 2 },
    firtina: { id: 'firtina', ad: 'Fırtına',  tur: 'Tabanca', cost: 450,  dmg: 22, rate: 9,   mag: 20, res: 40, reload: 1.6, spread: 4,   range: 650,  pellets: 1, auto: true,  slot: 2 },
    kasirga: { id: 'kasirga', ad: 'Kasırga',  tur: 'Tabanca', cost: 800,  dmg: 55, rate: 2.2, mag: 7,  res: 21, reload: 2.0, spread: 1.5, range: 800,  pellets: 1, auto: false, slot: 2 },
    ari:     { id: 'ari',     ad: 'Arı',      tur: 'SMG',     cost: 1100, dmg: 20, rate: 13,  mag: 30, res: 90, reload: 2.0, spread: 4.5, range: 600,  pellets: 1, auto: true,  slot: 1 },
    gurz:    { id: 'gurz',    ad: 'Gürz',     tur: 'Pompalı', cost: 900,  dmg: 15, rate: 1.2, mag: 6,  res: 24, reload: 2.6, spread: 9,   range: 380,  pellets: 9, auto: false, slot: 1 },
    yildirim:{ id: 'yildirim',ad: 'Yıldırım', tur: 'Tüfek',   cost: 2250, dmg: 35, rate: 10,  mag: 30, res: 90, reload: 2.5, spread: 3,   range: 1100, pellets: 1, auto: true,  slot: 1 },
    kartal:  { id: 'kartal',  ad: 'Kartal',   tur: 'Tüfek',   cost: 2900, dmg: 40, rate: 9.5, mag: 25, res: 75, reload: 2.5, spread: 2.2, range: 1300, pellets: 1, auto: true,  slot: 1 },
    sahin:   { id: 'sahin',   ad: 'Şahin',    tur: 'Keskin',  cost: 4700, dmg: 150,rate: 0.9, mag: 5,  res: 15, reload: 3.5, spread: 0.3, range: 2500, pellets: 1, auto: false, slot: 1 },
  };
  const BUY_LIST = ['firtina', 'kasirga', 'ari', 'gurz', 'yildirim', 'kartal', 'sahin'];
  const ARMORS = {
    hafif: { id: 'hafif', ad: 'Hafif Zırh', cost: 400,  amount: 25 },
    agir:  { id: 'agir',  ad: 'Ağır Zırh',  cost: 1000, amount: 50 },
  };

  // ---------- AJANLAR (özgün) ----------
  // yetenek: hiz | radar | duman | flas | sifa   (raundda 1 kez, E tuşu)
  const AGENTS = {
    atk: [
      { id: 'simsek',  ad: 'Şimşek',  yetenek: 'hiz',   renk: '#ffb020', not: 'Kısa süre çok hızlı koşar' },
      { id: 'kuzgun',  ad: 'Kuzgun',  yetenek: 'radar', renk: '#b06cff', not: 'Yakındaki düşmanları kısa süre gösterir' },
      { id: 'sis',     ad: 'Sis',     yetenek: 'duman', renk: '#7fd1ff', not: 'Görüşü kapatan duman atar' },
      { id: 'parlak',  ad: 'Parlak',  yetenek: 'flas',  renk: '#fff36b', not: 'Bakan düşmanı kör eden flaş atar' },
      { id: 'merhem',  ad: 'Merhem',  yetenek: 'sifa',  renk: '#6bffa0', not: 'Kendini iyileştirir' },
    ],
    def: [
      { id: 'bekci',   ad: 'Bekçi',   yetenek: 'radar', renk: '#4fd0ff', not: 'Yakındaki düşmanları kısa süre gösterir' },
      { id: 'pus',     ad: 'Pus',     yetenek: 'duman', renk: '#9aa7ff', not: 'Görüşü kapatan duman atar' },
      { id: 'kivilcim',ad: 'Kıvılcım',yetenek: 'flas',  renk: '#ff7a4f', not: 'Bakan düşmanı kör eden flaş atar' },
      { id: 'sifa',    ad: 'Şifa',    yetenek: 'sifa',  renk: '#5dff8f', not: 'Kendini iyileştirir' },
      { id: 'ruzgar',  ad: 'Rüzgâr',  yetenek: 'hiz',   renk: '#e8f1ff', not: 'Kısa süre çok hızlı koşar' },
    ],
  };

  // ---------- OYUN SABİTLERİ ----------
  const RULES = {
    WIN_ROUNDS: 13,
    HALF_AT: 12,          // 12 raund sonra taraflar değişir
    BUY_TIME: 20,         // alım fazı (sn)
    ROUND_TIME: 60,       // raund süresi (sn)  -> 1 dakika
    SPIKE_TIME: 30,       // spike patlama süresi (sn)
    PLANT_TIME: 3.5,      // kurma süresi (sn)
    DEFUSE_TIME: 5,       // çözme süresi (sn)
    END_TIME: 5,          // raund sonu bekleme (sn)
    PLAYER_R: 11,
    HP: 100,
    WALK: 120,
    RUN: 215,
    BOOST: 300,           // Şimşek / Rüzgâr hızı
    VIEW_RANGE: 900,
    FOV: 108,
    TEAM_SIZE: 5,
  };
  const ECO = {
    START: 800,
    MAX: 9000,
    WIN: 3000,
    LOSS: [1900, 2400, 2900], // üst üste kayıp 1, 2, 3+
    KILL: 200,
    ASSIST: 100,
    PLANT: 300,            // kuran oyuncuya
    PLANT_TEAM: 0,
    DEFUSE: 300,           // çözen oyuncuya
  };

  const api = { TILE, COLS, ROWS, grid, SITES, SPAWNS, WEAPONS, BUY_LIST, ARMORS, AGENTS, RULES, ECO };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DATA = api;
})(typeof window !== 'undefined' ? window : globalThis);
