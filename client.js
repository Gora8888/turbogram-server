const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
const $ = id => document.getElementById(id);
let isNew = false, enteredId = '', myId = '', myName = '', myEmail = '', myUname = '', myStatus = '⚡', chat = 'saved', folder = 'all';
let users = [], pc = null, stream = null, partner = null, replyTo = null, selfDestruct = false;
let mediaRec = null, audioChunks = [], isRecording = false, typingTimer = null;
const hist = { saved: [], general: [] };
const unreadCounts = {};
const typingUsers = {};
let customFolders = JSON.parse(localStorage.getItem('tg_custom_folders') || '[]');

let savedAccounts = JSON.parse(localStorage.getItem('tg_accounts') || '[]');
let activeAccountId = localStorage.getItem('tg_active_id') || '';

ws.onopen = () => {
  if (activeAccountId) ws.send(JSON.stringify({ type: 'auto_login', id: activeAccountId }));
};

function setDeviceMode(mode) {
  localStorage.setItem('tg_device_mode', mode);
  const isMob = mode === 'mobile';
  document.body.classList.toggle('is-mobile', isMob);
  document.body.classList.toggle('force-desktop', !isMob);
  ['btnModeMobile', 'btnSetMobile'].forEach(id => { if ($(id)) $(id).classList.toggle('active', isMob); });
  ['btnModeDesktop', 'btnSetDesktop'].forEach(id => { if ($(id)) $(id).classList.toggle('active', !isMob); });
}

function initDeviceMode() {
  const savedMode = localStorage.getItem('tg_device_mode');
  if (savedMode) setDeviceMode(savedMode);
  else {
    const autoMob = window.innerWidth <= 820 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    setDeviceMode(autoMob ? 'mobile' : 'desktop');
  }
}
initDeviceMode();

function closeMobileChat() { document.body.classList.remove('mobile-chat-open'); }
function setMobileTab(tab) {
  setFolder(tab);
  document.querySelectorAll('.m-nav-item').forEach(el => el.classList.remove('active'));
  if ($('m-nav-' + tab)) $('m-nav-' + tab).classList.add('active');
  closeMobileChat();
}

const pkr = $('emojiPicker');
['😀','😂','🥰','😎','🤔','😭','👍','❤️','🔥','🎉','👏','🙏','💯','✨','⚡','✈️'].forEach(em => {
  const s = document.createElement('span');
  s.className = 'emoji-item'; s.textContent = em;
  s.onclick = () => { $('msgInput').value += em; updateSendBtnState(); $('msgInput').focus(); };
  if (pkr) pkr.appendChild(s);
});
const toggleEmojiPicker = () => { if (pkr) pkr.style.display = pkr.style.display === 'grid' ? 'none' : 'grid'; };

function applyTheme(t) { document.body.classList.toggle('theme-oled', t === 'oled'); document.body.classList.toggle('theme-blue', t === 'blue'); }
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

if ($('countryCodeSelect')) {
  $('countryCodeSelect').addEventListener('change', e => {
    $('countryPrefixDisplay').value = e.target.value;
    $('authPhone').focus();
  });
}

if ($('authPhone')) {
  $('authPhone').addEventListener('input', e => {
    let digits = e.target.value.replace(/\D/g, '');
    const code = $('countryCodeSelect') ? $('countryCodeSelect').value : '+7';
    if (code === '+7' && digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) digits = digits.slice(1);
    digits = digits.slice(0, 10);
    let formatted = '';
    if (digits.length > 0) formatted += digits.slice(0, 3);
    if (digits.length > 3) formatted += ' ' + digits.slice(3, 6);
    if (digits.length > 6) formatted += ' ' + digits.slice(6, 8);
    if (digits.length > 8) formatted += ' ' + digits.slice(8, 10);
    e.target.value = formatted;
  });
}

function updateSendBtnState() {
  const btn = $('mainActionBtn');
  if (!btn || isRecording) return;
  const hasText = $('msgInput').value.trim().length > 0;
  btn.textContent = hasText ? '➤' : '🎤';
}

function handleMainAction() {
  const hasText = $('msgInput').value.trim().length > 0;
  if (hasText && !isRecording) sendMessage();
  else toggleVoiceRecord();
}

function openPeerProfile() {
  if (chat === 'saved' || chat === 'general') return;
  const u = users.find(x => x.id === chat);
  if (!u) return;
  $('peerModalName').textContent = `${u.name} ${u.status || ''}`;
  $('peerModalUser').textContent = u.username ? `@${u.username}` : u.id;
  $('peerModalStatus').textContent = u.online ? 'в сети' : 'был(а) недавно';
  $('peerModalAvatar').innerHTML = u.avatar ? `<img src="${u.avatar}">` : u.name.slice(0, 1).toUpperCase();
  $('peerProfileModal').style.display = 'flex';
}
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

  applyTheme(theme); applyWallpaper(wall); applyFontSize(fontSz);
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
    box.innerHTML += `<div style="display:flex;justify-content:space-between;align-items:center;background:var(--bg-input);padding:8px 12px;border-radius:10px;cursor:pointer;border:1px solid ${isCur ? '#3390ec' : 'transparent'}" onclick="switchAccount('${acc.id}')"><span style="font-size:13px">${acc.name} <span style="color:#8b9bb4">(${acc.id})</span></span><span style="color:${isCur ? '#4dcd5e' : '#3390ec'};font-size:12px">${isCur ? '✓ Активен' : 'Войти'}</span></div>`;
  });
  if (savedAccounts.length < 3) {
    box.innerHTML += `<button class="btn-primary" style="background:transparent;border:1px dashed #3390ec;color:#3390ec;padding:8px;font-size:13px" onclick="addNewAccount()">➕ Добавить аккаунт (${savedAccounts.length}/3)</button>`;
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
  const code = $('countryCodeSelect') ? $('countryCodeSelect').value : '+7';
  const rawDigits = $('authPhone').value.replace(/\D/g, '');
  if (rawDigits.length < 6) return ($('authError').textContent = 'Введите корректный номер телефона');
  if (ws.readyState !== 1) return ($('authError').textContent = 'Нет связи с сервером!');
  enteredId = code + rawDigits;
  ws.send(JSON.stringify({ type: 'request_code', id: enteredId }));
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
  if (d.type === 'auto_login_failed') { activeAccountId = ''; localStorage.removeItem('tg_active_id'); }
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
    closeMobileChat();
  }
  if (d.type === 'users_list') { users = d.users; renderChatList(); }
  if (d.type === 'typing') {
    const k = d.to === 'general' ? 'general' : d.fromId;
    typingUsers[k] = d.fromName;
    if (chat === k) updateChatHeader();
    renderChatList();
    setTimeout(() => { delete typingUsers[k]; if (chat === k) updateChatHeader(); renderChatList(); }, 3000);
  }
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
    delete typingUsers[k];
    if (chat !== k || !document.body.classList.contains('mobile-chat-open')) {
      unreadCounts[k] = (unreadCounts[k] || 0) + 1;
    }
    if (d.destruct) setTimeout(() => { hist[k] = hist[k].filter(x => x.msgId !== d.msgId); if (chat === k) renderMessages(); }, 10000);
    renderChatList(); if (chat === k) { updateChatHeader(); renderMessages(); }
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
    if (m) { m.reactions[d.emoji] = (m.reactions[d.emoji] || 0) + 1; if (chat === k) renderMessages(); }
  }
  if (d.type === 'call_offer') handleOffer(d);
  if (d.type === 'call_answer' && pc) await pc.setRemoteDescription(new RTCSessionDescription(d.answer));
  if (d.type === 'ice_candidate' && pc) await pc.addIceCandidate(new RTCIceCandidate(d.candidate));
  if (d.type === 'call_end') endCall(false);
};
function openCreateFolderModal() {
  $('newFolderName').value = '';
  const box = $('folderChatsCheckboxes');
  box.innerHTML = '';
  const allTargets = [
    { id: 'saved', name: '🔖 Избранное' },
    { id: 'general', name: '👥 Общий чат друзей' },
    ...users.filter(u => u.id !== myId).map(u => ({ id: u.id, name: `👤 ${u.name}` }))
  ];
  allTargets.forEach(t => {
    box.innerHTML += `<label class="folder-chat-pick"><span>${t.name}</span><input type="checkbox" value="${t.id}" style="width:18px;height:18px"></label>`;
  });
  $('createFolderModal').style.display = 'flex';
}

function saveCustomFolder() {
  const name = $('newFolderName').value.trim();
  if (!name) return alert('Введите название папки');
  const icon = $('newFolderIcon').value;
  const chatIds = Array.from(document.querySelectorAll('#folderChatsCheckboxes input:checked')).map(cb => cb.value);
  if (!chatIds.length) return alert('Выберите хотя бы один чат');
  customFolders.push({ id: 'f_' + Date.now(), name, icon, chatIds });
  localStorage.setItem('tg_custom_folders', JSON.stringify(customFolders));
  $('createFolderModal').style.display = 'none';
  renderFoldersUI();
  renderChatList();
}

function deleteCustomFolder(fId) {
  if (!confirm('Удалить эту папку?')) return;
  customFolders = customFolders.filter(f => f.id !== fId);
  localStorage.setItem('tg_custom_folders', JSON.stringify(customFolders));
  setFolder('all');
}

function renderFoldersUI() {
  const dBox = $('desktopFoldersList');
  const mBox = $('mobileFoldersPills');
  if (dBox) {
    dBox.innerHTML = `<div class="folder-item ${folder === 'all' ? 'active' : ''}" onclick="setFolder('all')"><span>💬</span><span>Все</span></div>`;
    customFolders.forEach(f => {
      dBox.innerHTML += `<div class="folder-item ${folder === f.id ? 'active' : ''}" onclick="setFolder('${f.id}')" oncontextmenu="event.preventDefault();deleteCustomFolder('${f.id}')"><span>${f.icon}</span><span>${f.name.slice(0, 8)}</span></div>`;
    });
  }
  if (mBox) {
    mBox.innerHTML = `<div class="ios-pill-tab ${folder === 'all' ? 'active' : ''}" onclick="setFolder('all')">Все</div>`;
    customFolders.forEach(f => {
      const cnt = f.chatIds.reduce((sum, cid) => sum + (unreadCounts[cid] || 0), 0);
      const badge = cnt > 0 ? `<span class="ios-pill-badge">${cnt}</span>` : '';
      mBox.innerHTML += `<div class="ios-pill-tab ${folder === f.id ? 'active' : ''}" onclick="setFolder('${f.id}')">${f.name} ${f.icon} ${badge}</div>`;
    });
    mBox.innerHTML += `<div class="ios-pill-tab" onclick="openCreateFolderModal()" style="color:#3390ec">+ Папка</div>`;
    if (folder !== 'all') {
      mBox.innerHTML += `<div class="ios-pill-tab" onclick="deleteCustomFolder('${folder}')" style="color:#ff595a">✕</div>`;
    }
  }
}

function setFolder(f) {
  folder = f;
  renderFoldersUI();
  renderChatList();
}

function renderChatList() {
  const list = $('chatList');
  const cleanQ = $('searchInput').value.trim().toLowerCase().replace(/^@/, '');
  list.innerHTML = '';
    renderFoldersUI();
  const activeF = customFolders.find(f => f.id === folder);
  const allowed = cid => !activeF || activeF.chatIds.includes(cid);

  const makeBadge = k => unreadCounts[k] ? `<span class="unread-badge">${unreadCounts[k]}</span>` : '';

  if (allowed('saved') && !cleanQ) {
    const last = (hist.saved || []).at(-1);
    const prev = last ? (last.voice ? '🎤 Голосовое сообщение' : (last.file ? '📎 Медиафайл' : last.text)) : 'Сохраняйте заметки и файлы';
    list.innerHTML += `<div class="chat-item ${chat === 'saved' ? 'active' : ''}" onclick="selectChat('saved','Избранное')"><div class="avatar" style="background:#3390ec">🔖</div><div class="chat-info"><div class="chat-top"><span class="chat-name">Избранное</span><span class="chat-time">${last?.time || ''}</span></div><div class="chat-bottom"><span class="chat-preview">${prev}</span>${makeBadge('saved')}</div></div></div>`;
  }

  if (allowed('general') && (!cleanQ || 'общий чат друзей'.includes(cleanQ))) {
    const last = (hist.general || []).at(-1);
    const prev = typingUsers.general ? `<span style="color:#3390ec">печатает...</span>` : (last ? `${last.fromName}: ${last.voice ? '🎤 Голосовое' : (last.file ? '📎 Файл' : last.text)}` : 'Нет сообщений');
    list.innerHTML += `<div class="chat-item ${chat === 'general' ? 'active' : ''}" onclick="selectChat('general','Общий чат друзей')"><div class="avatar">TG</div><div class="chat-info"><div class="chat-top"><span class="chat-name">Общий чат друзей</span><span class="chat-time">${last?.time || ''}</span></div><div class="chat-bottom"><span class="chat-preview">${prev}</span>${makeBadge('general')}</div></div></div>`;
  }

    users.forEach(u => {
      if (u.id === myId) return;
      if (!allowed(u.id)) return;
      const hasHistory = (hist[u.id] && hist[u.id].length > 0) || chat === u.id;
      const matchesSearch = cleanQ.length >= 2 && ((u.username && u.username.toLowerCase().includes(cleanQ)) || u.name.toLowerCase().includes(cleanQ));
      if (!hasHistory && !matchesSearch) return;

      const last = (hist[u.id] || []).at(-1);
      const tag = u.username ? `@${u.username}` : '';
      const prev = typingUsers[u.id] ? `<span style="color:#3390ec">печатает...</span>` : (last ? (last.voice ? '🎤 Голосовое' : (last.file ? '📎 Файл' : last.text)) : (tag ? `${tag} • ${u.online ? 'в сети' : 'не в сети'}` : 'Нажмите, чтобы написать'));
      const ava = u.avatar ? `<img src="${u.avatar}">` : u.name.slice(0, 1).toUpperCase();
      list.innerHTML += `<div class="chat-item ${chat === u.id ? 'active' : ''}" onclick="selectChat('${u.id}','${u.name}')"><div class="avatar">${ava}${u.online ? '<div class="online-dot"></div>' : ''}</div><div class="chat-info"><div class="chat-top"><span class="chat-name">${u.name} ${u.status || ''}</span><span class="chat-time">${last?.time || ''}</span></div><div class="chat-bottom"><span class="chat-preview">${prev}</span>${makeBadge(u.id)}</div></div></div>`;
    });
  }
}

function updateChatHeader() {
  const sub = $('chatSubtitle');
  const hAva = $('headerAvatar');
  sub.className = 'chat-header-sub';
  if (chat === 'saved') {
    sub.textContent = 'облачное хранилище';
    if (hAva) hAva.innerHTML = '🔖';
  } else if (chat === 'general') {
    sub.textContent = typingUsers.general ? `${typingUsers.general} печатает...` : `${users.length} участников`;
    if (typingUsers.general) sub.classList.add('is-typing');
    if (hAva) hAva.innerHTML = 'TG';
  } else {
    const u = users.find(x => x.id === chat);
    if (hAva) hAva.innerHTML = u?.avatar ? `<img src="${u.avatar}">` : (u?.name || '?').slice(0, 1).toUpperCase();
    if (typingUsers[chat]) { sub.textContent = 'печатает...'; sub.classList.add('is-typing'); }
    else if (u?.online) { sub.textContent = 'в сети'; sub.classList.add('is-online'); }
    else { sub.textContent = u?.username ? `@${u.username}` : 'был(а) недавно'; }
  }
}

function selectChat(id, title) {
  chat = id;
  delete unreadCounts[id];
  $('chatTitle').textContent = title;
  updateChatHeader();
  const showCalls = (id !== 'general' && id !== 'saved');
  $('callBtn').style.display = showCalls ? 'block' : 'none';
  $('videoBtn').style.display = showCalls ? 'block' : 'none';
  renderChatList();
  renderMessages();
  document.body.classList.add('mobile-chat-open');
}

function formatSpoilers(str) { return str.replace(/\|\|(.+?)\|\|/g, '<span class="spoiler" onclick="event.stopPropagation();this.classList.toggle(\'revealed\')">$1</span>'); }
function setReply(name, text) { replyTo = { name, text }; $('replyPreviewText').textContent = `Ответ для ${name}: ${text}`; $('replyBar').style.display = 'flex'; $('msgInput').focus(); }
function cancelReply() { replyTo = null; $('replyBar').style.display = 'none'; }
function editMessage(msgId, oldText) { const nw = prompt('Изменить сообщение:', oldText); if (nw && nw.trim() && nw !== oldText) ws.send(JSON.stringify({ type: 'edit_msg', to: chat === 'saved' ? myId : chat, msgId, text: nw.trim() })); }
function deleteMessage(msgId) { if (confirm('Удалить сообщение?')) ws.send(JSON.stringify({ type: 'delete_msg', to: chat === 'saved' ? myId : chat, msgId })); }
function pinMessage(text) { ws.send(JSON.stringify({ type: 'pin_msg', to: chat === 'saved' ? myId : chat, text })); }

function openMsgContextMenu(e, m, me) {
  e.preventDefault(); e.stopPropagation();
  const menu = $('msgContextMenu');
  const targetTo = chat === 'saved' ? myId : chat;
  const safeText = (m.text || 'Медиа').replace(/'/g, '');
  let html = `<div class="ctx-item" onclick="setReply('${m.fromName}','${safeText}');closeContextMenu()"><span>↩️ Ответить</span></div>`;
  html += `<div class="ctx-item" onclick="ws.send(JSON.stringify({type:'reaction',to:'${targetTo}',msgId:'${m.msgId}',emoji:'❤️'}));closeContextMenu()"><span>❤️ Реакция</span></div>`;
  html += `<div class="ctx-item" onclick="pinMessage('${safeText}');closeContextMenu()"><span>📌 Закрепить</span></div>`;
  if (me && m.text) html += `<div class="ctx-item" onclick="editMessage('${m.msgId}','${safeText}');closeContextMenu()"><span>✏️ Изменить</span></div>`;
  if (me) html += `<div class="ctx-item danger" onclick="deleteMessage('${m.msgId}');closeContextMenu()"><span>🗑️ Удалить</span></div>`;
  menu.innerHTML = html;
  menu.style.display = 'flex';
  const x = Math.min(e.clientX || 100, window.innerWidth - 200);
  const y = Math.min(e.clientY || 200, window.innerHeight - 230);
  menu.style.left = x + 'px'; menu.style.top = y + 'px';
}
function closeContextMenu() { if ($('msgContextMenu')) $('msgContextMenu').style.display = 'none'; }
document.addEventListener('click', closeContextMenu);

function renderMessages() {
  const box = $('messages'); box.innerHTML = '';
  (hist[chat] || []).forEach(m => {
    const me = m.fromId === myId, el = document.createElement('div');
    el.className = 'msg ' + (me ? 'outgoing' : 'incoming');
    el.onclick = e => openMsgContextMenu(e, m, me);
    let body = (!me && chat === 'general') ? `<div class="msg-author">${m.fromName}</div>` : '';
    if (m.reply) body += `<div class="reply-quote"><b>${m.reply.name}:</b> ${m.reply.text}</div>`;
    if (m.text) body += `<span>${formatSpoilers(m.text)}</span>`;
    if (m.voice) body += `<audio controls src="${m.voice}" style="height:34px;max-width:220px;margin-top:4px;display:block" onclick="event.stopPropagation()"></audio>`;
    if (m.file) body += m.file.isImage ? `<img src="${m.file.data}" class="msg-img">` : `<a href="${m.file.data}" download="${m.file.name}" class="msg-file-box" onclick="event.stopPropagation()">📄 ${m.file.name}</a>`;
    const meta = `<span class="msg-meta">${m.edited ? 'ред. ' : ''}${m.time}${me ? ' ✓✓' : ''}</span>`;
    const rk = Object.keys(m.reactions || {});
    const reacts = rk.length ? `<div class="reactions-row">${rk.map(k => `<span class="reaction-badge">${k} ${m.reactions[k]}</span>`).join('')}</div>` : '';
    el.innerHTML = body + meta + reacts;
    box.appendChild(el);
  });
  box.scrollTop = box.scrollHeight;
}

function sendMessage() {
  const inp = $('msgInput'), text = inp.value.trim();
  if (!text) return; if (pkr) pkr.style.display = 'none';
  const msgId = Date.now().toString(), time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const target = chat === 'saved' ? myId : chat;
  const payload = { type: 'message', msgId, to: target, text, reply: replyTo };
  if (chat !== 'general' && chat !== 'saved') {
    (hist[chat] = hist[chat] || []).push({ ...payload, fromId: myId, fromName: myName, time, reactions: {} });
    renderMessages(); renderChatList();
  }
  ws.send(JSON.stringify(payload));
  inp.value = ''; updateSendBtnState(); cancelReply();
}

function sendFile(e) {
  const f = e.target.files.item(0); if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    const msgId = Date.now().toString(), time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const file = { name: f.name, isImage: f.type.startsWith('image/'), data: ev.target.result };
    const target = chat === 'saved' ? myId : chat;
    ws.send(JSON.stringify({ type: 'message', msgId, to: target, text: '', file, reply: replyTo }));
    if (chat !== 'general' && chat !== 'saved') {
      (hist[chat] = hist[chat] || []).push({ msgId, fromId: myId, fromName: myName, text: '', file, time, reply: replyTo, reactions: {} });
      renderMessages(); renderChatList();
    }
    cancelReply();
  };
  r.readAsDataURL(f); e.target.value = '';
}

$('msgInput').addEventListener('input', () => {
  updateSendBtnState();
  if (chat !== 'saved' && ws.readyState === 1 && !typingTimer) {
    ws.send(JSON.stringify({ type: 'typing', to: chat }));
        typingTimer = setTimeout(() => { typingTimer = null; }, 2000);
  }
});
$('msgInput').addEventListener('keypress', e => { if (e.key === 'Enter') sendMessage(); });

async function toggleVoiceRecord() {
  const btn = $('mainActionBtn');
  if (!isRecording) {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : (MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '');
      mediaRec = mimeType ? new MediaRecorder(s, { mimeType }) : new MediaRecorder(s);
      audioChunks = [];
      mediaRec.ondataavailable = e => { if (e.data.size > 0) audioChunks.push(e.data); };
      mediaRec.onstop = () => {
        s.getTracks().forEach(t => t.stop());
        const blobType = mediaRec.mimeType || mimeType || 'audio/mp4';
        const reader = new FileReader();
        reader.onload = ev => {
          const msgId = Date.now().toString(), time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
          const target = chat === 'saved' ? myId : chat;
          ws.send(JSON.stringify({ type: 'message', msgId, to: target, text: '', voice: ev.target.result, reply: replyTo }));
          if (chat !== 'general' && chat !== 'saved') {
            (hist[chat] = hist[chat] || []).push({ msgId, fromId: myId, fromName: myName, text: '', voice: ev.target.result, time, reply: replyTo, reactions: {} });
            renderMessages(); renderChatList();
          }
          cancelReply();
        };
        reader.readAsDataURL(new Blob(audioChunks, { type: blobType }));
      };
      mediaRec.start(); isRecording = true; btn.classList.add('recording'); btn.textContent = '⏹️';
    } catch (err) { alert('Ошибка микрофона: ' + err.message); }
  } else {
    mediaRec.stop(); isRecording = false; btn.classList.remove('recording'); updateSendBtnState();
  }
}

async function setupPC(id, withVideo) {
  partner = id;
  pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:://google.com' }] });
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo }); }
  catch (e) { stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false }); }
  stream.getTracks().forEach(t => pc.addTrack(t, stream));
  if (withVideo && stream.getVideoTracks().length) { $('localVideo').srcObject = stream; $('localVideo').style.display = 'block'; }
  pc.ontrack = e => {
    const remStream = e.streams.at(0) || new MediaStream([e.track]);
    $('remoteAudio').srcObject = remStream; $('remoteAudio').play().catch(() => {});
    if (remStream.getVideoTracks().length) { $('remoteVideo').srcObject = remStream; $('remoteVideo').style.display = 'block'; }
  };
  pc.onicecandidate = e => { if (e.candidate) ws.send(JSON.stringify({ type: 'ice_candidate', to: id, candidate: e.candidate })); };
}

async function startCall(withVideo) {
  if (chat === 'general' || chat === 'saved') return;
  try {
    $('callBar').style.display = 'flex'; $('callStatus').textContent = withVideo ? '📹 Видеозвонок...' : '📞 Звонок...';
    await setupPC(chat, withVideo); const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: 'call_offer', to: chat, offer, withVideo }));
  } catch (err) { alert('Ошибка звонка: ' + err.message); endCall(false); }
}

async function handleOffer(d) {
  if (!confirm(`Входящий звонок от ${d.fromName}. Ответить?`)) return ws.send(JSON.stringify({ type: 'call_end', to: d.fromId }));
  try {
    $('callBar').style.display = 'flex'; $('callStatus').textContent = `🔒 Связь с ${d.fromName}`;
    await setupPC(d.fromId, d.withVideo); await pc.setRemoteDescription(new RTCSessionDescription(d.offer));
    const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
    ws.send(JSON.stringify({ type: 'call_answer', to: d.fromId, answer }));
  } catch (err) { alert('Ошибка ответа: ' + err.message); endCall(true); }
}

async function shareScreen() {
  if (!pc) return;
  const scr = await navigator.mediaDevices.getDisplayMedia({ video: true });
  const track = scr.getVideoTracks().at(0);
  const sender = pc.getSenders().find(s => s.track?.kind === 'video');
  if (sender) sender.replaceTrack(track); else pc.addTrack(track, scr);
  $('localVideo').srcObject = scr; $('localVideo').style.display = 'block';
}

function endCall(notify) {
  if (notify && partner) ws.send(JSON.stringify({ type: 'call_end', to: partner }));
  if (pc) { pc.close(); pc = null; }
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  $('callBar').style.display = 'none'; $('localVideo').style.display = 'none'; $('remoteVideo').style.display = 'none';
  partner = null;
}



