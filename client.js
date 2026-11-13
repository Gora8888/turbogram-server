const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
const $ = id => document.getElementById(id);
let isNew = false, enteredId = '', myId = '', myName = '', myEmail = '', myUname = '', myStatus = '⚡', chat = 'saved', folder = 'all';
let users = [], pc = null, stream = null, partner = null, replyTo = null, selfDestruct = false;
let mediaRec = null, audioChunks = [], isRecording = false;
const hist = { saved: [], general: [] };

let savedAccounts = JSON.parse(localStorage.getItem('tg_accounts') || '[]');
let activeAccountId = localStorage.getItem('tg_active_id') || '';

ws.onopen = () => {
  if (activeAccountId) ws.send(JSON.stringify({ type: 'auto_login', id: activeAccountId }));
};

const pkr = $('emojiPicker');
['😀','😂','🥰','😎','🤔','😭','👍','❤️','🔥','🎉','👏','🙏','💯','✨','⚡','✈️'].forEach(em => {
  const s = document.createElement('span');
  s.className = 'emoji-item'; s.textContent = em;
  s.onclick = () => { $('msgInput').value += em; $('msgInput').focus(); };
  if (pkr) pkr.appendChild(s);
});
const toggleEmojiPicker = () => { if (pkr) pkr.style.display = pkr.style.display === 'grid' ? 'none' : 'grid'; };

function applyTheme(t) { document.body.className = t === 'default' ? '' : 'theme-' + t; }
function applyFontSize(sz) { document.documentElement.style.setProperty('--msg-size', sz); }
function applyWallpaper(w) { $('messages').className = 'messages' + (w === 'none' ? '' : ' wall-' + w); }

function loadSavedUiSettings() {
  const saved = JSON.parse(localStorage.getItem('tg_ui_settings') || 'null');
  if (!saved) return;
  if (saved.theme) { applyTheme(saved.theme); if ($('themeSelect')) $('themeSelect').value = saved.theme; }
  if (saved.wall) { applyWallpaper(saved.wall); if ($('wallSelect')) $('wallSelect').value = saved.wall; }
  if (saved.fontSz) { applyFontSize(saved.fontSz); if ($('fontSizeSelect')) $('fontSizeSelect').value = saved.fontSz; }
}
loadSavedUiSettings();

function openSettings() {
  $('editNameInput').value = myName;
  if ($('editUsernameInput')) $('editUsernameInput').value = myUname ? '@' + myUname : '';
  if ($('editEmailInput')) $('editEmailInput').value = myEmail;
  if ($('editPassInput')) $('editPassInput').value = '';
  $('editStatusInput').value = myStatus;
  $('modalPhone').textContent = `${myId} ${myUname ? '(@' + myUname + ')' : ''}`;
  $('modalAvatar').innerHTML = $('myAvatarBox').innerHTML;
  renderAccountsList();
  $('settingsModal').style.display = 'flex';
}

function saveAllSettings() {
  const n = $('editNameInput').value.trim();
  const u = $('editUsernameInput') ? $('editUsernameInput').value.trim().replace(/^@/, '').toLowerCase() : myUname;
  const em = $('editEmailInput') ? $('editEmailInput').value.trim() : myEmail;
  const pw = $('editPassInput') ? $('editPassInput').value.trim() : '';
  const st = $('editStatusInput').value;
  const theme = $('themeSelect').value;
  const wall = $('wallSelect') ? $('wallSelect').value : 'none';
  const fontSz = $('fontSizeSelect').value;

  if (n) { myName = n; $('myProfileName').textContent = myName.slice(0, 8); }
  myUname = u; myEmail = em; myStatus = st;

  applyTheme(theme);
  applyWallpaper(wall);
  applyFontSize(fontSz);
  localStorage.setItem('tg_ui_settings', JSON.stringify({ theme, wall, fontSz }));

  ws.send(JSON.stringify({ type: 'update_profile', name: myName, username: myUname, email: myEmail, password: pw, status: myStatus }));
  $('settingsModal').style.display = 'none';
  alert('✅ Настройки успешно сохранены!');
}

function renderAccountsList() {
  const box = $('accountsList'); if (!box) return;
  box.innerHTML = '';
  savedAccounts.forEach(acc => {
    const isCur = acc.id === myId;
    box.innerHTML += `<div style="display:flex;justify-content:space-between;align-items:center;background:var(--bg-input);padding:8px 12px;border-radius:8px;cursor:pointer;border:1px solid ${isCur ? '#5288c1' : 'transparent'}" onclick="switchAccount('${acc.id}')"><span style="font-size:13px">${acc.name} <span style="color:#8b9bb4">(${acc.id})</span></span><span style="color:${isCur ? '#4dcd5e' : '#6ab3f3'};font-size:12px">${isCur ? '✓ Активен' : 'Войти'}</span></div>`;
  });
  if (savedAccounts.length < 3) {
    box.innerHTML += `<button class="btn-primary" style="background:transparent;border:1px dashed #5288c1;color:#6ab3f3;padding:8px;font-size:13px" onclick="addNewAccount()">➕ Добавить аккаунт (${savedAccounts.length}/3)</button>`;
  }
}
function switchAccount(id) { if (id !== myId) { localStorage.setItem('tg_active_id', id); location.reload(); } }
function addNewAccount() { $('settingsModal').style.display = 'none'; resetAuthStep(); $('authOverlay').style.display = 'flex'; }
function removeSavedAccount(id) {
  savedAccounts = savedAccounts.filter(a => a.id !== id);
  localStorage.setItem('tg_accounts', JSON.stringify(savedAccounts));
  if (activeAccountId === id) { activeAccountId = savedAccounts.at(0)?.id || ''; localStorage.setItem('tg_active_id', activeAccountId); }
  location.reload();
}

function checkAccount() {
  const id = $('authPhone').value.trim();
  if (!id) return ($('authError').textContent = 'Введите номер телефона');
  if (ws.readyState !== 1) return ($('authError').textContent = 'Нет связи с сервером!');
  enteredId = id;
  ws.send(JSON.stringify({ type: 'request_code', id }));
}
function resetAuthStep() {
  $('stepPhone').style.display = 'block'; $('stepDetails').style.display = 'none'; $('authBack').style.display = 'none';
  $('authTitle').textContent = 'TurboGram'; $('authError').textContent = '';
}
function completeAuth() {
  ws.send(JSON.stringify({
    type: 'verify_auth', id: enteredId,
    code: $('authCode').value.trim(),
    name: $('authName').value.trim(),
    username: $('authUsername').value.trim(),
    email: $('authEmail') ? $('authEmail').value.trim() : '',
    password: $('authPassword') ? $('authPassword').value.trim() : ''
  }));
}

function uploadAvatar(e) {
  const f = e.target.files.item(0);
  if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = 128; c.height = 128;
      c.getContext('2d').drawImage(img, 0, 0, 128, 128);
      const url = c.toDataURL('image/jpeg', 0.85);
      $('myAvatarBox').innerHTML = `<img src="${url}">`;
      if ($('modalAvatar')) $('modalAvatar').innerHTML = `<img src="${url}">`;
      ws.send(JSON.stringify({ type: 'update_profile', avatar: url }));
    };
    img.src = ev.target.result;
  };
  r.readAsDataURL(f);
  e.target.value = '';
}

ws.onmessage = async ev => {
  const d = JSON.parse(ev.data);
  if (d.type === 'auth_error') $('authError').textContent = d.message;
  if (d.type === 'profile_error') alert(d.message);
  if (d.type === 'auto_login_failed') removeSavedAccount(d.id);
  if (d.type === 'code_sent') {
    isNew = !d.exists; $('authError').textContent = '';
    $('stepPhone').style.display = 'none'; $('stepDetails').style.display = 'block'; $('authBack').style.display = 'block';
    $('authTitle').textContent = d.id;
    $('authSubtitle').textContent = `СМС-код отправлен (тестовый код: ${d.demoCode})`;
    $('authName').style.display = d.exists ? 'none' : 'block';
    $('authUsername').style.display = d.exists ? 'none' : 'block';
    if ($('authEmail')) $('authEmail').style.display = d.exists ? 'none' : 'block';
    $('finalAuthBtn').textContent = d.exists ? 'ВОЙТИ' : 'ЗАВЕРШИТЬ РЕГИСТРАЦИЮ';
  }
  if (d.type === 'auth_success') {
    myId = d.id; myName = d.name; myEmail = d.email || ''; myUname = d.username || ''; myStatus = d.status || '⚡';
    activeAccountId = d.id; localStorage.setItem('tg_active_id', d.id);
    const idx = savedAccounts.findIndex(a => a.id === d.id);
    const acc = { id: d.id, name: d.name, username: myUname };
    if (idx >= 0) savedAccounts.splice(idx, 1, acc); else if (savedAccounts.length < 3) savedAccounts.push(acc);
    localStorage.setItem('tg_accounts', JSON.stringify(savedAccounts));

    $('authOverlay').style.display = 'none';
    $('myProfileName').textContent = myName.slice(0, 8);
    $('myAvatarBox').innerHTML = d.avatar ? `<img src="${d.avatar}">` : myName.slice(0, 1).toUpperCase();
    selectChat('saved', 'Избранное');
  }
  if (d.type === 'users_list') { users = d.users; renderChatList(); }
  if (d.type === 'history') {
    d.messages.forEach(m => {
      const k = m.to === 'general' ? 'general' : (m.to === myId && m.fromId === myId ? 'saved' : (m.fromId === myId ? m.to : m.fromId));
      if (!hist[k]) hist[k] = [];
      if (!hist[k].some(x => x.msgId === m.msgId)) hist[k].push({ ...m, reactions: m.reactions || {} });
    });
    renderChatList(); renderMessages();
  }
  if (d.type === 'message') {
    const k = d.to === 'general' ? 'general' : (d.to === myId && d.fromId === myId ? 'saved' : d.fromId);
    if (!hist[k]) hist[k] = [];
    hist[k].push({ ...d, reactions: {} });
    if (d.destruct) setTimeout(() => { hist[k] = hist[k].filter(x => x.msgId !== d.msgId); if (chat === k) renderMessages(); }, 10000);
    renderChatList(); if (chat === k) renderMessages();
  }
  if (d.type === 'edit_msg') {
    const k = d.to === 'general' ? 'general' : (d.fromId === myId ? d.to : d.fromId);
    const m = (hist[k] || []).find(x => x.msgId === d.msgId);
    if (m) { m.text = d.text; m.edited = true; if (chat === k) renderMessages(); }
  }
  if (d.type === 'delete_msg') {
    const k = d.to === 'general' ? 'general' : (d.fromId === myId ? d.to : d.fromId);
    if (hist[k]) { hist[k] = hist[k].filter(x => x.msgId !== d.msgId); if (chat === k) renderMessages(); renderChatList(); }
  }
  if (d.type === 'pin_msg') { $('pinText').textContent = '📌 ' + d.text; $('pinBar').style.display = 'flex'; }
  if (d.type === 'reaction') {
    const k = d.to === 'general' ? 'general' : (d.fromId === myId ? d.to : d.fromId);
    const m = (hist[k] || []).find(x => x.msgId === d.msgId);
        if (m) {
      m.reactions[d.emoji] = (m.reactions[d.emoji] || 0) + 1;
      if (chat === k) renderMessages();
    }
  }
  if (d.type === 'call_offer') handleOffer(d);
  if (d.type === 'call_answer' && pc) await pc.setRemoteDescription(new RTCSessionDescription(d.answer));
  if (d.type === 'ice_candidate' && pc) await pc.addIceCandidate(new RTCIceCandidate(d.candidate));
  if (d.type === 'call_end') endCall(false);
};

