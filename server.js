const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;
const DATA_DIR = fs.existsSync('/data') ? '/data' : __dirname;
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
const STORIES_FILE = path.join(DATA_DIR, 'stories.json');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');

let users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')) : {};
let history = fs.existsSync(HISTORY_FILE) ? JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')) : [];
let stories = fs.existsSync(STORIES_FILE) ? JSON.parse(fs.readFileSync(STORIES_FILE, 'utf8')) : [];
let rooms = fs.existsSync(ROOMS_FILE) ? JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8')) : {};
const clients = new Map();

const saveUsers = () => fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
const saveHistory = () => fs.writeFileSync(HISTORY_FILE, JSON.stringify(history.slice(-1000), null, 2));
const saveStories = () => fs.writeFileSync(STORIES_FILE, JSON.stringify(stories, null, 2));
const saveRooms = () => fs.writeFileSync(ROOMS_FILE, JSON.stringify(rooms, null, 2));

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

function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 11 && digits.startsWith('8')) return '+7' + digits.slice(1);
  return '+' + digits;
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?');
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

const wss = new WebSocket.Server({ server });

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
      let u = users[data.id];
      if (!u && data.savedProfile && data.savedProfile.name) {
        u = users[data.id] = {
          id: data.id,
          name: data.savedProfile.name,
          username: data.savedProfile.username || '',
          email: data.savedProfile.email || '',
          password: data.savedProfile.password || '',
          status: data.savedProfile.status || '⚡',
          avatar: data.savedProfile.avatar || ''
        };
        saveUsers();
      }
      if (!u) return ws.send(JSON.stringify({ type: 'auto_login_failed', id: data.id }));
      myId = data.id;
      clients.set(myId, ws);
      ws.send(JSON.stringify({ type: 'auth_success', ...u }));
      broadcastUsers();
      sendHistory(ws, myId);
      return;
    }

    if (data.type === 'check_phone') {
      const u = users[data.id];
      ws.send(JSON.stringify({ type: 'phone_checked', id: data.id, exists: !!u, hasPassword: !!(u && u.password) }));
      return;
    }

    if (data.type === 'direct_auth') {
      let u = users[data.id];
      if (u) {
        if (u.password && u.password !== String(data.password || '').trim()) {
          return ws.send(JSON.stringify({ type: 'auth_error', message: 'Неверный облачный пароль!' }));
        }
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
          password: String(data.password || '').trim(),
          status: '⚡',
          avatar: ''
        };
        saveUsers();
      }
      myId = data.id;
      clients.set(myId, ws);
      ws.send(JSON.stringify({ type: 'auth_success', ...u }));
      broadcastUsers();
      sendHistory(ws, myId);
      return;
    }

    if (!myId || !users[myId]) return;

    if (data.type === 'bind_gmail') {
      const email = String(data.email || '').trim().toLowerCase();
      if (!email || !email.includes('@')) return ws.send(JSON.stringify({ type: 'profile_error', message: 'Введите корректный Gmail!' }));
      if (Object.values(users).some(x => x.id !== myId && x.email === email)) {
        return ws.send(JSON.stringify({ type: 'profile_error', message: 'Этот Gmail уже привязан к другому аккаунту!' }));
      }
      users[myId].email = email;
      saveUsers();
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
      rooms[roomId] = {
        id: roomId,
        kind: data.kind || 'group',
        title: String(data.title || 'Новая группа').trim(),
        ownerId: myId
      };
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
      if (data.password) u.password = String(data.password).trim();
      if (data.status !== undefined) u.status = data.status;
      if (data.avatar !== undefined) u.avatar = data.avatar;
      saveUsers();
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
        file: data.file || null,
        reply: data.reply || null,
        destruct: !!data.destruct,
        time
      };
      if (!msgObj.destruct) {
        history.push({ ...msgObj, text: msgObj.text ? vernamEncrypt(msgObj.text) : '' });
        saveHistory();
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
      if (m) { m.text = vernamEncrypt(data.text); m.edited = true; saveHistory(); }
      routeToTarget(data.to, JSON.stringify({ type: 'edit_msg', fromId: myId, to: data.to, msgId: data.msgId, text: data.text }), ws);
      return;
    }

    if (data.type === 'delete_msg') {
      history = history.filter(x => !(x.msgId === data.msgId && x.fromId === myId));
      saveHistory();
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
      clients.delete(myId);
      broadcastUsers();
    }
  });
});

server.listen(PORT, () => {
  console.log(`Сервер TurboGram запущен на порту ${PORT}`);
});

