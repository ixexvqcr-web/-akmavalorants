// Nokta Atışı - LAN sunucusu (bağımlılık yok, sadece Node.js)
// Görevi: oyun dosyalarını sunmak ve odadaki oyuncular arasında mesaj aktarmak.
// Oyun mantığını "ev sahibi" oyuncunun tarayıcısı yürütür, sunucu sadece aktarır.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const server = http.createServer((req, res) => {
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch (e) {
    res.writeHead(400);
    return res.end('Hatalı istek');
  }
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(PUBLIC, urlPath));
  if (!file.startsWith(PUBLIC)) {
    res.writeHead(403);
    return res.end('Yasak');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404);
      return res.end('Bulunamadı');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(data);
  });
});

// ---------- Minimal WebSocket (RFC 6455) ----------
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function wsSend(sock, text) {
  if (sock.destroyed || !sock.writable) return;
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.from([0x81, len]);
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  sock.write(Buffer.concat([header, payload]));
}

// Gelen veriyi çerçevelere ayırır. onText(string), onClose() çağırır.
function attachFrameParser(sock, onText, onClose) {
  let buf = Buffer.alloc(0);
  let fragments = [];
  sock.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    if (buf.length > 4 * 1024 * 1024) return sock.destroy(); // aşırı büyük veri
    for (;;) {
      if (buf.length < 2) return;
      const fin = (buf[0] & 0x80) !== 0;
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let off = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        off = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        off = 10;
      }
      const maskLen = masked ? 4 : 0;
      if (buf.length < off + maskLen + len) return;
      let payload = buf.slice(off + maskLen, off + maskLen + len);
      if (masked) {
        const mask = buf.slice(off, off + 4);
        const out = Buffer.alloc(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i & 3];
        payload = out;
      }
      buf = buf.slice(off + maskLen + len);

      if (opcode === 0x8) { // kapat
        try { sock.end(Buffer.from([0x88, 0x00])); } catch (e) {}
        return onClose();
      } else if (opcode === 0x9) { // ping -> pong
        const pong = Buffer.concat([Buffer.from([0x8a, payload.length]), payload]);
        if (payload.length < 126) sock.write(pong);
      } else if (opcode === 0x1 || opcode === 0x0 || opcode === 0x2) {
        fragments.push(payload);
        if (fin) {
          const full = Buffer.concat(fragments);
          fragments = [];
          if (opcode !== 0x2) onText(full.toString('utf8'));
        }
      }
    }
  });
  sock.on('close', onClose);
  sock.on('error', onClose);
}

// ---------- Oda yönetimi (tek oda) ----------
let nextId = 1;
const clients = new Map(); // id -> { sock, name }
let hostId = null;

function sendTo(c, obj) {
  wsSend(c.sock, JSON.stringify(obj));
}
function broadcast(obj, exceptId) {
  const s = JSON.stringify(obj);
  for (const [id, c] of clients) if (id !== exceptId) wsSend(c.sock, s);
}
function lobbyList() {
  return [...clients.entries()].map(([id, c]) => ({ id, name: c.name, host: id === hostId }));
}
function pushLobby() {
  broadcast({ t: 'lobby', players: lobbyList(), hostId });
}

server.on('upgrade', (req, sock) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') {
    sock.destroy();
    return;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  sock.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\nConnection: Upgrade\r\n' +
      'Sec-WebSocket-Accept: ' + accept + '\r\n\r\n'
  );
  sock.setNoDelay(true);

  const id = nextId++;
  const me = { sock, name: 'Oyuncu' + id };
  clients.set(id, me);
  if (hostId === null) hostId = id;
  sendTo(me, { t: 'welcome', id, hostId });
  pushLobby();

  let closed = false;
  const onClose = () => {
    if (closed) return;
    closed = true;
    clients.delete(id);
    if (id === hostId) {
      const next = clients.keys().next();
      hostId = next.done ? null : next.value;
      broadcast({ t: 'hostLeft' });
    } else if (hostId !== null) {
      const h = clients.get(hostId);
      if (h) sendTo(h, { t: 'left', id });
    }
    pushLobby();
    try { sock.destroy(); } catch (e) {}
  };

  attachFrameParser(sock, (text) => {
    let m;
    try { m = JSON.parse(text); } catch (e) { return; }
    switch (m.t) {
      case 'name':
        me.name = String(m.name || '').slice(0, 16) || me.name;
        pushLobby();
        break;
      case 'input': // istemci -> ev sahibi
        if (hostId !== null && hostId !== id) {
          const h = clients.get(hostId);
          if (h) sendTo(h, { t: 'input', from: id, d: m.d });
        }
        break;
      case 'state': // ev sahibi -> herkes
      case 'event':
      case 'start':
      case 'end':
        if (id === hostId) broadcast(m, id);
        break;
      case 'chat':
        broadcast({ t: 'chat', from: me.name, text: String(m.text || '').slice(0, 120) });
        break;
    }
  }, onClose);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n=== NOKTA ATIŞI sunucusu çalışıyor ===');
  console.log('Bu bilgisayardan:  http://localhost:' + PORT);
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const n of nets[name]) {
      if (n.family === 'IPv4' && !n.internal) {
        console.log('Arkadaşlar için:   http://' + n.address + ':' + PORT + '   (' + name + ')');
      }
    }
  }
  console.log('Kapatmak için Ctrl+C\n');
});
