const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const USERS_FILE = path.join(__dirname, 'users.json');
let users = fs.existsSync(USERS_FILE) ? JSON.parse(fs.readFileSync(USERS_FILE, 'utf-8')) : {};
function saveUsers() { fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2)); }

const MSGS_FILE = path.join(__dirname, 'messages.json');
let savedMessages = fs.existsSync(MSGS_FILE) ? JSON.parse(fs.readFileSync(MSGS_FILE, 'utf-8')) : [];
function saveMessages() { fs.writeFileSync(MSGS_FILE, JSON.stringify(savedMessages.slice(-500), null, 2)); }

// Шифр Вернама (XOR со случайным ключом равной длины)
function encryptVernam(plainText) {
  const textBuf = Buffer.from(plainText, 'utf-8');
  const keyBuf = crypto.randomBytes(textBuf.length);
  const cipherBuf = Buffer.alloc(textBuf.length);
  for (let i = 0; i < textBuf.length; i++) {
    cipherBuf[i] = textBuf[i] ^ keyBuf[i];
  }
  return { cipher: cipherBuf.toString('hex'), key: keyBuf.toString('hex') };
}

function decryptVernam(cipherHex, keyHex) {
  const cipherBuf = Buffer.from(cipherHex, 'hex');
  const keyBuf = Buffer.from(keyHex, 'hex');
  const plainBuf = Buffer.alloc(cipherBuf.length);
  for (let i = 0; i < cipherBuf.length; i++) {
    plainBuf[i] = cipherBuf[i] ^ keyBuf[i];
  }
  return plainBuf.toString('utf-8');
}

const server = http.createServer((req, res) => {
  const cleanUrl = decodeURI(req.url).split('?').at(0);
  const fileName = cleanUrl === '/' ? 'index.html' : cleanUrl.slice(1);
  const filePath = path.join(__dirname, fileName);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(fileName);
    const types = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png', '.jpg': 'image/jpeg' };
    res.writeHead(200, { 'Content-Type': (types[ext] || 'text/plain') + '; charset=utf-8' });
    fs.createReadStream(filePath).pipe(res);
  } else { res.writeHead(404); res.end('Not found'); }
});

const wss = new WebSocket.Server({ server, maxPayload: 30 * 1024 * 1024 });
const onlineClients = new Map();
const pendingCodes = {};

function broadcastUsersList() {
  const allUsers = Object.keys(users).map((id) => {
    const c = onlineClients.get(id);
    return { id, name: users[id].name || id, username: users[id].username || '', avatar: users[id].avatar || null, status: users[id].status || '', online: !!c };
  });
  const payload = JSON.stringify({ type: 'users_list', users: allUsers });
  onlineClients.forEach((c) => { if (c.ws.readyState === WebSocket.OPEN) c.ws.send(payload); });
}

function routeToTarget(to, fromId, payload) {
  if (to === 'general') {
    onlineClients.forEach((c) => { if (c.ws.readyState === WebSocket.OPEN) c.ws.send(payload); });
  } else if (to === fromId) {
    const self = onlineClients.get(fromId);
    if (self && self.ws.readyState === WebSocket.OPEN) self.ws.send(payload);
  } else {
    const target = onlineClients.get(to);
    if (target && target.ws.readyState === WebSocket.OPEN) target.ws.send(payload);
  }
}

wss.on('connection', (ws) => {
  let currentUserId = null;

  ws.on('message', (raw) => {
    const data = JSON.parse(raw.toString());
        if (d.id) {
      const digits = String(d.id).replace(/\D/g, '');
      d.id = (digits.length === 11 && digits.startsWith('8')) ? '+7' + digits.slice(1) : '+' + digits;
    }

    if (data.type === 'request_code') {
      const id = data.id.trim();
      if (!id) return ws.send(JSON.stringify({ type: 'auth_error', message: 'Введите номер телефона' }));
      const code = Math.floor(10000 + Math.random() * 90000).toString();
      pendingCodes[id] = code;
      console.log(`[СМС-код для ${id}]: ${code}`);
      const exists = !!users[id];
      ws.send(JSON.stringify({ type: 'code_sent', id, exists, name: exists ? users[id].name : '', demoCode: code }));
    }

    if (data.type === 'verify_auth') {
      const id = data.id.trim();
      if (!pendingCodes[id] || pendingCodes[id] !== data.code.trim()) {
        return ws.send(JSON.stringify({ type: 'auth_error', message: 'Неверный код из СМС!' }));
      }

      if (!users[id]) {
        const name = (data.name || '').trim();
        const email = (data.email || '').trim();
        const password = (data.password || '').trim();
        const uname = (data.username || '').trim().replace(/^@/, '').toLowerCase();
        if (!name || !email || !password) return ws.send(JSON.stringify({ type: 'auth_error', message: 'Заполните имя, Email и пароль!' }));
        if (uname && Object.values(users).some(u => u.username === uname)) {
          return ws.send(JSON.stringify({ type: 'auth_error', message: 'Этот @username уже занят!' }));
        }
        const vernam = encryptVernam(password);
        users[id] = {
          name, email,
          username: uname || ('user' + Math.floor(1000 + Math.random() * 9000)),
          vernamCipher: vernam.cipher,
          vernamKey: vernam.key,
          avatar: null, status: '⚡'
        };
        saveUsers();
      } else {
        const pass = (data.password || '').trim();
        if (users[id].vernamCipher && users[id].vernamKey) {
          const originalPass = decryptVernam(users[id].vernamCipher, users[id].vernamKey);
          if (pass !== originalPass) {
            return ws.send(JSON.stringify({ type: 'auth_error', message: 'Неверный пароль аккаунта!' }));
          }
        }
      }

      delete pendingCodes[id];
      currentUserId = id;
      onlineClients.set(id, { ws });
      ws.send(JSON.stringify({
        type: 'auth_success', id, name: users[id].name, email: users[id].email || '',
        username: users[id].username, avatar: users[id].avatar, status: users[id].status || ''
      }));
      broadcastUsersList();
      const userHistory = savedMessages.filter(m => m.to === 'general' || m.to === id || m.fromId === id);
      ws.send(JSON.stringify({ type: 'history', messages: userHistory }));
    }

    if (data.type === 'auto_login') {
      const id = (data.id || '').trim();
      if (!id || !users[id]) return ws.send(JSON.stringify({ type: 'auto_login_failed', id }));
      currentUserId = id;
      onlineClients.set(id, { ws });
      ws.send(JSON.stringify({
        type: 'auth_success', id, name: users[id].name, email: users[id].email || '',
        username: users[id].username, avatar: users[id].avatar, status: users[id].status || ''
      }));
      broadcastUsersList();
      const userHistory = savedMessages.filter(m => m.to === 'general' || m.to === id || m.fromId === id);
      ws.send(JSON.stringify({ type: 'history', messages: userHistory }));
    }

    if (data.type === 'update_profile' && currentUserId && users[currentUserId]) {
      if (data.avatar !== undefined) users[currentUserId].avatar = data.avatar;
      if (data.name && data.name.trim()) users[currentUserId].name = data.name.trim();
      if (data.email !== undefined) users[currentUserId].email = data.email.trim();
      if (data.status !== undefined) users[currentUserId].status = data.status;
      if (data.password && data.password.trim()) {
        const vernam = encryptVernam(data.password.trim());
        users[currentUserId].vernamCipher = vernam.cipher;
        users[currentUserId].vernamKey = vernam.key;
      }
      if (data.username !== undefined) {
        const cleanUname = data.username.trim().replace(/^@/, '').toLowerCase();
        if (Object.entries(users).some(([uid, u]) => uid !== currentUserId && u.username === cleanUname)) {
          return ws.send(JSON.stringify({ type: 'profile_error', message: 'Этот @username уже занят!' }));
        }
        users[currentUserId].username = cleanUname;
      }
      saveUsers(); broadcastUsersList();
    }

    if (data.type === 'message' && currentUserId) {
      const msgObj = { ...data, fromId: currentUserId, fromName: users[currentUserId]?.name || currentUserId, time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) };
      if (!msgObj.destruct) { savedMessages.push(msgObj); saveMessages(); }
      routeToTarget(data.to, currentUserId, JSON.stringify(msgObj));
    }

    if (['edit_msg', 'delete_msg', 'pin_msg', 'reaction'].includes(data.type) && currentUserId) {
      if (data.type === 'edit_msg') {
        const m = savedMessages.find(x => x.msgId === data.msgId);
        if (m) { m.text = data.text; m.edited = true; saveMessages(); }
      }
      if (data.type === 'delete_msg') {
        savedMessages = savedMessages.filter(x => x.msgId !== data.msgId); saveMessages();
      }
      const payload = JSON.stringify({ ...data, fromId: currentUserId });
      routeToTarget(data.to, currentUserId, payload);
      if (data.to !== 'general' && data.to !== currentUserId && ws.readyState === WebSocket.OPEN) ws.send(payload);
    }

    if (['call_offer', 'call_answer', 'ice_candidate', 'call_end'].includes(data.type) && currentUserId) {
      const target = onlineClients.get(data.to);
      if (target && target.ws.readyState === WebSocket.OPEN) {
        target.ws.send(JSON.stringify({ ...data, fromId: currentUserId, fromName: users[currentUserId]?.name || currentUserId }));
      }
    }
  });

  ws.on('close', () => { if (currentUserId) { onlineClients.delete(currentUserId); broadcastUsersList(); } });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('TurboGram v7.0 (Вернам + Голосовые) запущен на порту ' + PORT));
