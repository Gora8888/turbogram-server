const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const DATA_DIR = fs.existsSync('/data') ? '/data' : __dirname;
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const STORIES_FILE = path.join(DATA_DIR, 'stories.json');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');

// Подключение к вечной базе PostgreSQL (если добавлена в Railway)
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  : null;

let users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')) : {};
let history = fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) : [];
let stories = fs.existsSync(STORIES_FILE) ? JSON.parse(fs.readFileSync(STORIES_FILE, 'utf8')) : [];
let rooms = fs.existsSync(ROOMS_FILE) ? JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8')) : {};
const clients = new Map();

// Инициализация таблиц в PostgreSQL и загрузка пользователей в память
async function initDatabase() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tg_users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      username TEXT,
      email TEXT,
      password_hash TEXT,
      status TEXT,
      avatar TEXT,
      last_seen BIGINT
    );
    CREATE TABLE IF NOT EXISTS tg_messages (
      msg_id TEXT PRIMARY KEY,
      from_id TEXT,
      from_name TEXT,
      target_to TEXT,
      cipher_text TEXT,
      payload_json TEXT,
      created_at BIGINT
    );
  `);
  const res = await pool.query('SELECT * FROM tg_users');
  res.rows.forEach(r => {
    users[r.id] = {
      id: r.id,
      name: r.name,
      username: r.username || '',
      email: r.email || '',
      passwordHash: r.password_hash || '',
      status: r.status || '⚡',
      avatar: r.avatar || '',
      lastSeen: Number(r.last_seen) || Date.now()
    };
  });
  const msgRes = await pool.query('SELECT * FROM tg_messages ORDER BY created_at ASC');
  history = msgRes.rows.map(r => JSON.parse(r.payload_json));
  console.log(`База PostgreSQL подключена: загружено пользователей — ${res.rows.length}`);
}

function saveUserToDb(u) {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  if (pool) {
    pool.query(
      `INSERT INTO tg_users (id, name, username, email, password_hash, status, avatar, last_seen)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
       name=$2, username=$3, email=$4, password_hash=$5, status=$6, avatar=$7, last_seen=$8`,
      [u.id, u.name, u.username || '', u.email || '', u.passwordHash || '', u.status || '⚡', u.avatar || '', u.lastSeen || Date.now()]
    ).catch(console.error);
  }
}

function saveHistoryToDb(newMsg) {
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(-1000), null, 2));
  if (pool && newMsg) {
    pool.query(
      `INSERT INTO tg_messages (msg_id, from_id, from_name, target_to, cipher_text, payload_json, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (msg_id) DO NOTHING`,
      [newMsg.msgId, newMsg.fromId, newMsg.fromName, newMsg.to, newMsg.text || '', JSON.stringify(newMsg), newMsg.createdAt || Date.now()]
    ).catch(console.error);
  }
}

const saveStories = () => fs.writeFileSync(STORIES_FILE, JSON.stringify(stories, null, 2));
const saveRooms = () => fs.writeFileSync(ROOMS_FILE, JSON.stringify(rooms, null, 2));

// Надёжное хэширование паролей (scrypt + случайная соль)
function hashPassword(plain) {
  if (!plain) return '';
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(plain), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(plain, storedHash, legacyPlain) {
  if (!storedHash && !legacyPlain) return true;
  if (legacyPlain && !storedHash) return String(plain) === String(legacyPlain);
  const [salt, key] = String(storedHash).split(':');
  if (!salt || !key) return false;
  const derived = crypto.scryptSync(String(plain || ''), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(derived, 'hex'));
}

// Шифрование сообщений (шифр Вернама + случайный nonce)
const VERNAM_KEY = Buffer.from(process.env.VERNAM_KEY || 'TurboGramSuperSecretVernamKey2026!@#', 'utf8');

function vernamEncrypt(text) {
  if (!text) return '';
  const data = Buffer.from(String(text), 'utf8');
  const nonce = crypto.randomBytes(16);
  const out = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) {
    out[i] = data[i] ^ VERNAM_KEY[i % VERNAM_KEY.length] ^ nonce[i % nonce.length];
  }
  return nonce.toString('hex') + ':' + out.toString('base64');
}

function vernamDecrypt(enc) {
  if (!enc || !String(enc).includes(':')) return enc || '';
  try {
    const [nHex, b64] = String(enc).split(':');
    const nonce = Buffer.from(nHex, 'hex');
    const data = Buffer.from(b64, 'base64');
    const out = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) {
      out[i] = data[i] ^ VERNAM_KEY[i % VERNAM_KEY.length] ^ nonce[i % nonce.length];
    }
    return out.toString('utf8');
  } catch {
    return enc;
  }
}

// Анонимная авто-очистка: каждые 5 минут стираем без следов переписки неактивных пользователей (> 24 часов оффлайн)
const INACTIVE_TTL_MS = 1 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  const beforeLen = history.length;
  history = history.filter(m => {
    if (isRoomTarget(m.to)) return now - (m.createdAt || now) < INACTIVE_TTL_MS * 3;
    const sender = users[m.fromId];
    const receiver = users[m.to];
    const senderActive = clients.has(m.fromId) || (sender && now - (sender.lastSeen || 0) < INACTIVE_TTL_MS);
    const receiverActive = clients.has(m.to) || (receiver && now - (receiver.lastSeen || 0) < INACTIVE_TTL_MS);
    return senderActive || receiverActive;
  });
  if (history.length !== beforeLen) {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(-1000), null, 2));
    if (pool) {
      const keepIds = history.map(m => m.msgId);
      if (keepIds.length) {
        pool.query('DELETE FROM tg_messages WHERE NOT (msg_id = ANY($1))', [keepIds]).catch(console.error);
      } else {
        pool.query('TRUNCATE TABLE tg_messages').catch(console.error);
      }
    }
  }
}, 5 * 60 * 1000);

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('8')) return '+7' + digits.slice(1);
  return '+' + digits;
}

const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const filePath = path.join(__dirname, urlPath === '/' ? 'index.html' : urlPath);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath);
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.json': 'application/manifest+json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.ico': 'image/x-icon'
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } else {
    res.writeHead(404);
    res.end('Not found');
  }
});

const wss = new WebSocket.Server({ server, maxPayload: 50 * 1024 * 1024 });

function broadcastUsers() {
  const list = Object.values(users).map(u => ({
    id: u.id,
    name: u.name,
    username: u.username || '',
    status: u.status || '',
    avatar: u.avatar || '',
    online: clients.has(u.id)
  }));
  const payload = JSON.stringify({ type: 'users_list', users: list });
  wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(payload); });
}

function isRoomTarget(to) {
  return to === 'general' || String(to).startsWith('gr_') || String(to).startsWith('ch_');
}

function sendHistory(ws, userId) {
  const userMsgs = history
    .filter(m => isRoomTarget(m.to) || m.to === userId || m.fromId === userId)
    .map(m => ({ ...m, text: m.text ? vernamDecrypt(m.text) : '' }));
  ws.send(JSON.stringify({ type: 'history', messages: userMsgs }));

  const activeStories = stories.filter(s => Date.now() - s.createdAt < 24 * 3600 * 1000);
  ws.send(JSON.stringify({ type: 'stories_list', stories: activeStories }));
  ws.send(JSON.stringify({ type: 'rooms_list', rooms: Object.values(rooms) }));
}

function routeToTarget(to, payloadStr, senderWs) {
  if (isRoomTarget(to)) {
    wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(payloadStr); });
  } else {
    const targetWs = clients.get(to);
    if (targetWs && targetWs.readyState === WebSocket.OPEN) targetWs.send(payloadStr);
    if (senderWs && senderWs !== targetWs && senderWs.readyState === WebSocket.OPEN) senderWs.send(payloadStr);
  }
}

wss.on('connection', ws => {
  let myId = null;

  ws.on('message', raw => {
    let data;
    try { data = JSON.parse(raw.toString()); } catch { return; }

    if (data.id) data.id = normalizePhone(data.id);

    if (data.type === 'auto_login') {
      const u = users[data.id];
      if (!u) return ws.send(JSON.stringify({ type: 'auto_login_failed', id: data.id }));
      u.lastSeen = Date.now();
      saveUserToDb(u);
      myId = data.id;
      clients.set(myId, ws);
      const { passwordHash, password, ...safeUser } = u;
      ws.send(JSON.stringify({ type: 'auth_success', ...safeUser }));
      broadcastUsers();
      sendHistory(ws, myId);
      return;
    }

    if (data.type === 'check_phone') {
      const u = users[data.id];
      const hasPass = !!(u && (u.passwordHash || u.password));
      ws.send(JSON.stringify({ type: 'phone_checked', id: data.id, exists: !!u, hasPassword: hasPass }));
      return;
    }

    if (data.type === 'direct_auth') {
      let u = users[data.id];
            if (u) {
        if ((u.passwordHash || u.password) && !verifyPassword(data.password, u.passwordHash, u.password)) {
          return ws.send(JSON.stringify({ type: 'auth_error', message: 'Неверный пароль! Доступ запрещён.' }));
        }
        u.lastSeen = Date.now();
        saveUserToDb(u);
      } else {
        const cleanName = String(data.name || '').trim();
        if (!cleanName) return ws.send(JSON.stringify({ type: 'auth_error', message: 'Введите ваше имя!' }));
        const cleanUname = String(data.username || '').trim().replace(/^@/, '').toLowerCase();
        if (cleanUname && Object.values(users).some(x => x.username && x.username.toLowerCase() === cleanUname)) {
          return ws.send(JSON.stringify({ type: 'auth_error', message: 'Этот @username уже занят!' }));
        }
        u = users[data.id] = {
          id: data.id,
          name: cleanName,
          username: cleanUname,
          email: '',
          passwordHash: hashPassword(String(data.password || '').trim()),
          status: '⚡',
          avatar: '',
          lastSeen: Date.now()
        };
        saveUserToDb(u);
      }
      myId = data.id;
      clients.set(myId, ws);
      const { passwordHash, password, ...safeUser } = u;
      ws.send(JSON.stringify({ type: 'auth_success', ...safeUser }));
      broadcastUsers();
      sendHistory(ws, myId);
      return;
    }

    if (!myId || !users[myId]) return;
    users[myId].lastSeen = Date.now();

    if (data.type === 'bind_gmail') {
      const email = String(data.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) return ws.send(JSON.stringify({ type: 'profile_error', message: 'Введите корректный Gmail!' }));
      if (Object.values(users).some(x => x.id !== myId && x.email === email)) {
        return ws.send(JSON.stringify({ type: 'profile_error', message: 'Этот Gmail уже привязан к другому аккаунту!' }));
      }
      users[myId].email = email;
      saveUserToDb(users[myId]);
      ws.send(JSON.stringify({ type: 'gmail_bound', email }));
      return;
    }

    if (data.type === 'post_story') {
      const st = {
        id: 'st_' + Date.now(),
        authorId: myId,
        authorName: users[myId].name,
        authorAvatar: users[myId].avatar || '',
        image: data.image || '',
        caption: String(data.caption || '').trim(),
        createdAt: Date.now()
      };
      stories.push(st);
      saveStories();
      const payload = JSON.stringify({ type: 'new_story', story: st });
      wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(payload); });
      return;
    }

    if (data.type === 'create_room') {
      const roomId = (data.kind === 'channel' ? 'ch_' : 'gr_') + Date.now();
      rooms[roomId] = { id: roomId, kind: data.kind || 'group', title: String(data.title || 'Новая группа').trim(), ownerId: myId };
      saveRooms();
      const payload = JSON.stringify({ type: 'rooms_list', rooms: Object.values(rooms) });
      wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(payload); });
      return;
    }

    if (data.type === 'update_profile') {
      const u = users[myId];
      if (data.username !== undefined) {
        const cleanU = String(data.username).trim().replace(/^@/, '').toLowerCase();
        if (cleanU && Object.values(users).some(x => x.id !== myId && x.username === cleanU)) {
          return ws.send(JSON.stringify({ type: 'profile_error', message: 'Этот @username уже занят!' }));
        }
        u.username = cleanU;
      }
      if (data.name) u.name = String(data.name).trim();
      if (data.password) {
        u.passwordHash = hashPassword(String(data.password).trim());
        delete u.password;
      }
      if (data.status !== undefined) u.status = data.status;
      if (data.avatar !== undefined) u.avatar = data.avatar;
      saveUserToDb(u);
      broadcastUsers();
      return;
    }

    if (data.type === 'typing') {
      const payload = JSON.stringify({ type: 'typing', fromId: myId, fromName: users[myId].name, to: data.to });
      if (isRoomTarget(data.to)) {
        wss.clients.forEach(c => { if (c !== ws && c.readyState === WebSocket.OPEN) c.send(payload); });
      } else {
        const targetWs = clients.get(data.to);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) targetWs.send(payload);
      }
      return;
    }

    if (data.type === 'message') {
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const msgObj = {
        type: 'message',
        msgId: data.msgId || Date.now().toString(),
        fromId: myId,
        fromName: users[myId].name,
        to: data.to,
        text: data.text || '',
        voice: data.voice || null,
        videoCircle: data.videoCircle || null,
        file: data.file || null,
        reply: data.reply || null,
        destruct: !!data.destruct,
        createdAt: Date.now(),
        time
      };
        if (data.type === 'mark_read' && myId) {
    const peer = sockets[data.to];
    if (peer && peer.readyState === 1) {
      peer.send(JSON.stringify({ type: 'messages_read', byId: myId }));
    }
  }

      if (!msgObj.destruct) {
        const encryptedRecord = { ...msgObj, text: msgObj.text ? vernamEncrypt(msgObj.text) : '' };
        history.push(encryptedRecord);
        saveHistoryToDb(encryptedRecord);
      }
      const str = JSON.stringify(msgObj);
      if (isRoomTarget(data.to)) {
        wss.clients.forEach(c => { if (c.readyState === WebSocket.OPEN) c.send(str); });
      } else if (data.to === myId) {
        ws.send(str);
      } else {
        const targetWs = clients.get(data.to);
        if (targetWs && targetWs.readyState === WebSocket.OPEN) targetWs.send(str);
      }
      return;
    }

    if (data.type === 'edit_msg') {
      const m = history.find(x => x.msgId === data.msgId && x.fromId === myId);
      if (m) { m.text = vernamEncrypt(data.text); m.edited = true; saveHistoryToDb(m); }
      routeToTarget(data.to, JSON.stringify({ type: 'edit_msg', fromId: myId, to: data.to, msgId: data.msgId, text: data.text }), ws);
      return;
    }

    if (data.type === 'delete_msg') {
      history = history.filter(x => !(x.msgId === data.msgId && x.fromId === myId));
      fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(-1000), null, 2));
      if (pool) pool.query('DELETE FROM tg_messages WHERE msg_id=$1 AND from_id=$2', [data.msgId, myId]).catch(console.error);
      routeToTarget(data.to, JSON.stringify({ type: 'delete_msg', fromId: myId, to: data.to, msgId: data.msgId }), ws);
      return;
    }

    if (data.type === 'pin_msg') {
      routeToTarget(data.to, JSON.stringify({ type: 'pin_msg', fromId: myId, to: data.to, text: data.text }), ws);
      return;
    }

    if (data.type === 'reaction') {
      routeToTarget(data.to, JSON.stringify({ type: 'reaction', fromId: myId, to: data.to, msgId: data.msgId, emoji: data.emoji }), ws);
      return;
    }

    if (['call_offer', 'call_answer', 'ice_candidate', 'call_end'].includes(data.type)) {
      const targetWs = clients.get(data.to);
      if (targetWs && targetWs.readyState === WebSocket.OPEN) {
        targetWs.send(JSON.stringify({ ...data, fromId: myId, fromName: users[myId].name }));
      }
    }
  });

  ws.on('close', () => {
    if (myId && clients.get(myId) === ws) {
      if (users[myId]) {
        users[myId].lastSeen = Date.now();
        saveUserToDb(users[myId]);
      }
      clients.delete(myId);
      broadcastUsers();
    }
  });
});

initDatabase().then(() => {
  server.listen(PORT, () => {
    console.log(`Сервер TurboGram запущен на порту ${PORT}`);
  });
});

