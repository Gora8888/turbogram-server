let ws = null;
const $ = id => document.getElementById(id);
let enteredId = '', myId = '', myName = '', myEmail = '', myUname = '', myStatus = '⚡';
let chat = 'saved', folder = 'all', users = [], pc = null, stream = null, partner = null, replyTo = null;
let mediaRec = null, audioChunks = [], isRecording = false, typingTimer = null;
let allStories = [], customRooms = [], draftStoryImg = '';
const hist = { saved: [], general: [] };
const unreadCounts = {};
const typingUsers = {};

const SVG_MIC = '<svg class="svg-ico" viewBox="0 0 24 24"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/></svg>';
const SVG_SEND = '<svg class="svg-ico" viewBox="0 0 24 24"><line x1="12" y1="19" x2="12" y2="5"/><polyline points="5 12 12 5 19 12"/></svg>';

let savedAccounts = JSON.parse(localStorage.getItem('tg_accounts') || '[]');
let activeAccountId = localStorage.getItem('tg_active_id') || '';
let customFolders = JSON.parse(localStorage.getItem('tg_custom_folders') || '[]');

function sendAutoLogin() {
  if (!activeAccountId || !ws || ws.readyState !== 1) return;
  const savedProfile = savedAccounts.find(a => a.id === activeAccountId) || null;
  ws.send(JSON.stringify({ type: 'auto_login', id: activeAccountId, savedProfile }));
}

function connectWS() {
  if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
  ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
  ws.onopen = () => sendAutoLogin();
  ws.onclose = () => setTimeout(connectWS, 1500);
  ws.onmessage = handleWsMessage;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (!ws || ws.readyState !== 1) connectWS();
    else if (!myId && activeAccountId) sendAutoLogin();
  }
});

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
  else setDeviceMode((window.innerWidth <= 820 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) ? 'mobile' : 'desktop');
}
initDeviceMode();

function closeMobileChat() { document.body.classList.remove('mobile-chat-open'); }
function setMobileTab(tab) {
  setFolder('all');
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
function toggleEmojiPicker() { if (pkr) pkr.style.display = pkr.style.display === 'grid' ? 'none' : 'grid'; }

function applyTheme(t) { document.body.classList.toggle('theme-oled', t === 'oled'); document.body.classList.toggle('theme-blue', t === 'blue'); }
function applyFontSize(sz) { document.documentElement.style.setProperty('--msg-size', sz); }
function applyWallpaper(w) { if ($('messages')) $('messages').className = 'messages' + (w === 'none' ? '' : ' wall-' + w); }

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

function checkAccount() {
  const code = $('countryCodeSelect') ? $('countryCodeSelect').value : '+7';
  const rawDigits = $('authPhone').value.replace(/\D/g, '');
  if (rawDigits.length < 6) return ($('authError').textContent = 'Введите корректный номер телефона');
  if (!ws || ws.readyState !== 1) return ($('authError').textContent = 'Связь с сервером... Нажмите ещё раз через секунду.');
  enteredId = code + rawDigits;
  $('authError').textContent = '';
  ws.send(JSON.stringify({ type: 'check_phone', id: enteredId }));
}

function submitLoginPassword() {
  const pw = $('loginPasswordInput').value.trim();
  if (!pw) return ($('authError').textContent = 'Введите пароль');
  ws.send(JSON.stringify({ type: 'direct_auth', id: enteredId, password: pw }));
}

function completeRegistration() {
  const first = $('authFirstName').value.trim();
  const last = $('authLastName').value.trim();
  if (!first) return ($('authError').textContent = 'Введите ваше имя');
  const fullName = last ? `${first} ${last}` : first;
  ws.send(JSON.stringify({
    type: 'direct_auth',
    id: enteredId,
    name: fullName,
    username: $('authUsername').value.trim(),
    password: $('authPassword').value.trim()
  }));
}

function resetAuthStep() {
  $('stepPhone').style.display = 'block';
  $('stepLoginPass').style.display = 'none';
  $('stepRegister').style.display = 'none';
  $('authBack').style.display = 'none';
  $('authTitle').textContent = 'Ваш телефон';
  $('authSubtitle').textContent = 'Проверьте код страны и введите свой номер телефона.';
  $('authError').textContent = '';
}
function bindGmailAccount() {
  const email = $('bindGmailInput').value.trim();
  if (!email || !email.includes('@')) return alert('Введите корректный адрес Gmail!');
  ws.send(JSON.stringify({ type: 'bind_gmail', email }));
}

function updateSendBtnState() {
  const btn = $('mainActionBtn');
  if (!btn || isRecording) return;
  const hasText = $('msgInput').value.trim().length > 0;
  btn.classList.toggle('has-text', hasText);
  btn.innerHTML = hasText ? SVG_SEND : SVG_MIC;
}

function handleMainAction() {
  const hasText = $('msgInput').value.trim().length > 0;
  if (hasText && !isRecording) sendMessage();
  else toggleVoiceRecord();
}

function openStoryCreator() {
  draftStoryImg = '';
  $('storyPreviewImg').style.display = 'none';
  $('storyCaptionInput').value = '';
  $('storyCreateModal').style.display = 'flex';
}

function previewStoryImg(e) {
  const f = e.target.files.item(0); if (!f) return;
  const r = new FileReader();
  r.onload = ev => { draftStoryImg = ev.target.result; $('storyPreviewImg').src = draftStoryImg; $('storyPreviewImg').style.display = 'block'; };
  r.readAsDataURL(f);
}

function publishStory() {
  const caption = $('storyCaptionInput').value.trim();
  if (!draftStoryImg && !caption) return alert('Добавьте фото или текст истории!');
  ws.send(JSON.stringify({ type: 'post_story', image: draftStoryImg, caption }));
  $('storyCreateModal').style.display = 'none';
}

function renderStoriesBar() {
  const bar = $('storiesBar'); if (!bar) return;
  if (!allStories.length) { bar.style.display = 'none'; return; }
  bar.style.display = 'flex'; bar.innerHTML = '';
  allStories.forEach(s => {
    const ava = s.authorAvatar ? `<img src="${s.authorAvatar}" style="width:100%;height:100%;object-fit:cover">` : s.authorName.slice(0, 1).toUpperCase();
    bar.innerHTML += `<div onclick="viewStory('${s.id}')" style="display:flex;flex-direction:column;align-items:center;gap:3px;cursor:pointer;flex-shrink:0"><div style="width:50px;height:50px;border-radius:50%;padding:2px;background:linear-gradient(45deg,#3390ec,#34c759)"><div style="width:100%;height:100%;border-radius:50%;background:#11161d;display:flex;align-items:center;justify-content:center;font-weight:700;overflow:hidden">${ava}</div></div><span style="font-size:11px;color:#fff;max-width:56px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.authorName}</span></div>`;
  });
}

function viewStory(id) {
  const s = allStories.find(x => x.id === id); if (!s) return;
  $('storyViewAuthor').textContent = s.authorName;
  $('storyViewImg').style.display = s.image ? 'block' : 'none';
  if (s.image) $('storyViewImg').src = s.image;
  $('storyViewCaption').style.display = s.caption ? 'block' : 'none';
  $('storyViewCaption').textContent = s.caption;
  $('storyViewModal').style.display = 'flex';
}

function openComposeMenu() { $('composeModal').style.display = 'flex'; }

function createRoomPrompt(kind) {
  $('composeModal').style.display = 'none';
  const title = prompt(kind === 'channel' ? 'Название нового канала:' : 'Название новой группы:');
  if (title && title.trim()) ws.send(JSON.stringify({ type: 'create_room', kind, title: title.trim() }));
}

function openPeerProfile() {
  if (chat === 'saved' || chat === 'general' || chat.startsWith('gr_') || chat.startsWith('ch_')) return;
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
  if ($('editPassInput')) $('editPassInput').value = '';
  $('editStatusInput').value = myStatus;
  $('modalPhone').textContent = `${myId} ${myUname ? '(@' + myUname + ')' : ''}`;
  $('modalAvatar').innerHTML = $('myAvatarBox').innerHTML;
  if ($('gmailCurrentStatus')) {
    $('gmailCurrentStatus').innerHTML = myEmail ? `Привязана почта: <b style="color:#fff">${myEmail}</b>` : 'Почта Gmail не привязана';
    if ($('bindGmailInput')) $('bindGmailInput').value = myEmail;
  }
  renderAccountsList();
  $('settingsModal').style.display = 'flex';
}

function saveAllSettings() {
  const n = $('editNameInput').value.trim();
  const u = $('editUsernameInput') ? $('editUsernameInput').value.trim().replace(/^@/, '').toLowerCase() : myUname;
  const pw = $('editPassInput') ? $('editPassInput').value.trim() : '';
  const st = $('editStatusInput').value;
  const theme = $('themeSelect').value;
  const wall = $('wallSelect') ? $('wallSelect').value : 'none';
  const fontSz = $('fontSizeSelect').value;

  if (n) { myName = n; $('myProfileName').textContent = myName.slice(0, 8); }
  myUname = u; myStatus = st;

  applyTheme(theme); applyWallpaper(wall); applyFontSize(fontSz);
  localStorage.setItem('tg_ui_settings', JSON.stringify({ theme, wall, fontSz }));

  ws.send(JSON.stringify({ type: 'update_profile', name: myName, username: myUname, password: pw, status: myStatus }));
  $('settingsModal').style.display = 'none';
  alert('Настройки успешно сохранены!');
}

function renderAccountsList() {
  const box = $('accountsList'); if (!box) return;
  box.innerHTML = '';
  savedAccounts.forEach(acc => {
    const isCur = acc.id === myId;
    box.innerHTML += `<div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,0.06);padding:9px 12px;border-radius:12px;cursor:pointer;border:1px solid ${isCur ? '#3390ec' : 'transparent'}" onclick="switchAccount('${acc.id}')"><span style="font-size:14px">${acc.name} <span style="color:#8e8e93">(${acc.id})</span></span><span style="color:${isCur ? '#34c759' : '#3390ec'};font-size:13px">${isCur ? 'Активен' : 'Войти'}</span></div>`;
  });
  if (savedAccounts.length < 3) {
    box.innerHTML += `<button class="btn-primary" style="background:transparent;border:1px dashed #3390ec;color:#3390ec;padding:9px;font-size:14px" onclick="addNewAccount()">+ Добавить аккаунт (${savedAccounts.length}/3)</button>`;
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
      const acc = savedAccounts.find(a => a.id === myId);
      if (acc) { acc.avatar = url; localStorage.setItem('tg_accounts', JSON.stringify(savedAccounts)); }
      ws.send(JSON.stringify({ type: 'update_profile', avatar: url }));
    };
    img.src = ev.target.result;
  };
  r.readAsDataURL(f);
  e.target.value = '';
}
async function handleWsMessage(ev) {
  const d = JSON.parse(ev.data);
  if (d.type === 'auth_error') $('authError').textContent = d.message;
  if (d.type === 'profile_error') alert(d.message);
  if (d.type === 'auto_login_failed') { activeAccountId = ''; localStorage.removeItem('tg_active_id'); }

  if (d.type === 'phone_checked') {
    $('authError').textContent = '';
    $('stepPhone').style.display = 'none';
    $('authBack').style.display = 'block';
    if (d.exists) {
      if (d.hasPassword) {
        $('stepLoginPass').style.display = 'block';
        $('authTitle').textContent = 'Облачный пароль';
        $('authSubtitle').textContent = `Аккаунт ${d.id} защищён паролем.`;
      } else {
        ws.send(JSON.stringify({ type: 'direct_auth', id: d.id }));
      }
    } else {
      $('stepRegister').style.display = 'block';
      $('authTitle').textContent = 'Ваше имя';
      $('authSubtitle').textContent = 'Укажите имя и фамилию для профиля TurboGram.';
    }
  }

  if (d.type === 'gmail_bound') {
    myEmail = d.email;
    const acc = savedAccounts.find(a => a.id === myId);
    if (acc) { acc.email = myEmail; localStorage.setItem('tg_accounts', JSON.stringify(savedAccounts)); }
    if ($('gmailCurrentStatus')) $('gmailCurrentStatus').innerHTML = `Привязана почта: <b style="color:#fff">${myEmail}</b>`;
    alert('Почта Gmail успешно привязана к аккаунту!');
  }

  if (d.type === 'auth_success') {
    myId = d.id; myName = d.name; myEmail = d.email || ''; myUname = d.username || ''; myStatus = d.status || '⚡';
    activeAccountId = d.id; localStorage.setItem('tg_active_id', d.id);
    const idx = savedAccounts.findIndex(a => a.id === d.id);
    const acc = { id: d.id, name: d.name, username: myUname, email: myEmail, status: myStatus, avatar: d.avatar || '' };
    if (idx >= 0) savedAccounts.splice(idx, 1, acc); else if (savedAccounts.length < 3) savedAccounts.push(acc);
    localStorage.setItem('tg_accounts', JSON.stringify(savedAccounts));

    $('authOverlay').style.setProperty('display', 'none', 'important');
    $('myProfileName').textContent = myName.slice(0, 8);
    $('myAvatarBox').innerHTML = d.avatar ? `<img src="${d.avatar}">` : myName.slice(0, 1).toUpperCase();
    selectChat('saved', 'Избранное');
    closeMobileChat();
  }

  if (d.type === 'stories_list') { allStories = d.stories; renderStoriesBar(); }
  if (d.type === 'new_story') { allStories.push(d.story); renderStoriesBar(); }
  if (d.type === 'rooms_list') { customRooms = d.rooms; renderChatList(); }
  if (d.type === 'users_list') { users = d.users; renderChatList(); }

  if (d.type === 'typing') {
    const isRoom = d.to === 'general' || String(d.to).startsWith('gr_') || String(d.to).startsWith('ch_');
    const k = isRoom ? d.to : d.fromId;
    typingUsers[k] = d.fromName;
    if (chat === k) updateChatHeader();
    renderChatList();
    setTimeout(() => { delete typingUsers[k]; if (chat === k) updateChatHeader(); renderChatList(); }, 3000);
  }
  if (d.type === 'history') {
    d.messages.forEach(m => {
      const isRoom = m.to === 'general' || String(m.to).startsWith('gr_') || String(m.to).startsWith('ch_');
      const k = isRoom ? m.to : (m.to === myId && m.fromId === myId ? 'saved' : (m.fromId === myId ? m.to : m.fromId));
      if (!hist[k]) hist[k] = [];
      if (!hist[k].some(x => x.msgId === m.msgId)) hist[k].push({ ...m, reactions: m.reactions || {} });
    });
    renderChatList(); renderMessages();
  }
  if (d.type === 'message') {
    const isRoom = d.to === 'general' || String(d.to).startsWith('gr_') || String(d.to).startsWith('ch_');
    const k = isRoom ? d.to : (d.to === myId && d.fromId === myId ? 'saved' : d.fromId);
    if (!hist[k]) hist[k] = [];
    hist[k].push({ ...d, reactions: {} });
    delete typingUsers[k];
    if (chat !== k || !document.body.classList.contains('mobile-chat-open')) unreadCounts[k] = (unreadCounts[k] || 0) + 1;
    renderChatList(); if (chat === k) { updateChatHeader(); renderMessages(); }
  }
  if (d.type === 'edit_msg') {
    const isRoom = d.to === 'general' || String(d.to).startsWith('gr_') || String(d.to).startsWith('ch_');
    const k = isRoom ? d.to : (d.fromId === myId ? d.to : d.fromId);
    const m = (hist[k] || []).find(x => x.msgId === d.msgId);
    if (m) { m.text = d.text; m.edited = true; if (chat === k) renderMessages(); }
  }
  if (d.type === 'delete_msg') {
    const isRoom = d.to === 'general' || String(d.to).startsWith('gr_') || String(d.to).startsWith('ch_');
    const k = isRoom ? d.to : (d.fromId === myId ? d.to : d.fromId);
    if (hist[k]) { hist[k] = hist[k].filter(x => x.msgId !== d.msgId); if (chat === k) renderMessages(); renderChatList(); }
  }
  if (d.type === 'pin_msg') { $('pinText').textContent = '📌 ' + d.text; $('pinBar').style.display = 'flex'; }
  if (d.type === 'reaction') {
    const isRoom = d.to === 'general' || String(d.to).startsWith('gr_') || String(d.to).startsWith('ch_');
    const k = isRoom ? d.to : (d.fromId === myId ? d.to : d.fromId);
    const m = (hist[k] || []).find(x => x.msgId === d.msgId);
    if (m) { m.reactions[d.emoji] = (m.reactions[d.emoji] || 0) + 1; if (chat === k) renderMessages(); }
  }
  if (d.type === 'call_offer') handleOffer(d);
  if (d.type === 'call_answer' && pc) await pc.setRemoteDescription(new RTCSessionDescription(d.answer));
  if (d.type === 'ice_candidate' && pc) await pc.addIceCandidate(new RTCIceCandidate(d.candidate));
  if (d.type === 'call_end') endCall(false);
}

function openCreateFolderModal() {
  $('newFolderName').value = '';
  const box = $('folderChatsCheckboxes');
  box.innerHTML = '';
  const allTargets = [
    { id: 'saved', name: 'Избранное' },
    { id: 'general', name: 'Общий чат друзей' },
    ...customRooms.map(r => ({ id: r.id, name: r.title })),
    ...users.filter(u => u.id !== myId).map(u => ({ id: u.id, name: u.name }))
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
  renderFoldersUI(); renderChatList();
}

function deleteCustomFolder(fId) {
  if (!confirm('Удалить эту папку?')) return;
  customFolders = customFolders.filter(f => f.id !== fId);
  localStorage.setItem('tg_custom_folders', JSON.stringify(customFolders));
  setFolder('all');
}

function renderFoldersUI() {
  const dBox = $('desktopFoldersList'), mBox = $('mobileFoldersPills');
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
      mBox.innerHTML += `<div class="ios-pill-tab ${folder === f.id ? 'active' : ''}" onclick="setFolder('${f.id}')">${f.name} ${badge}</div>`;
    });
    mBox.innerHTML += `<div class="ios-pill-tab" onclick="openCreateFolderModal()" style="color:#3390ec">+ Папка</div>`;
    if (folder !== 'all') mBox.innerHTML += `<div class="ios-pill-tab" onclick="deleteCustomFolder('${folder}')" style="color:#ff453a">✕</div>`;
  }
}

function setFolder(f) { folder = f; renderFoldersUI(); renderChatList(); }

function renderChatList() {
  renderFoldersUI();
  const list = $('chatList'), cleanQ = $('searchInput').value.trim().toLowerCase().replace(/^@/, '');
  list.innerHTML = '';
  const activeF = customFolders.find(f => f.id === folder);
  const allowed = cid => !activeF || activeF.chatIds.includes(cid);
  const makeBadge = k => unreadCounts[k] ? `<span class="unread-badge">${unreadCounts[k]}</span>` : '';

  // Точные залитые SVG-иконки 1-в-1 как на референсах
  const verifiedBadgeSvg = `<svg style="width:16px;height:16px;fill:#4ea4f6;vertical-align:-3px;margin-left:5px;flex-shrink:0" viewBox="0 0 24 24"><path d="M12 2l2.4 2.2 3.2-.4.8 3.1 2.9 1.4-1.2 3 1.2 3-2.9 1.4-.8 3.1-3.2-.4L12 22l-2.4-2.2-3.2.4-.8-3.1-2.9-1.4 1.2-3-1.2-3 2.9-1.4.8-3.1 3.2.4L12 2zm-1.2 13.4l5.4-5.4-1.4-1.4-4 4-2-2-1.4 1.4 3.4 3.4z"/></svg>`;
  const archiveBoxSvg = `<svg style="width:26px;height:26px;fill:#fff" viewBox="0 0 24 24"><path d="M20 4H4c-1.1 0-2 .9-2 2v2c0 .7.4 1.4 1 1.7V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V9.7c.6-.3 1-1 1-1.7V6c0-1.1-.9-2-2-2zm-5 10H9v-2h6v2zm5-6H4V6h16v2z"/></svg>`;
  const bookmarkFillSvg = `<svg style="width:24px;height:24px;fill:#fff" viewBox="0 0 24 24"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>`;
  const planeFillSvg = `<svg style="width:26px;height:26px;fill:#fff;margin-right:2px" viewBox="0 0 24 24"><path d="M20.665 3.717l-17.73 6.837c-1.21.486-1.203 1.161-.222 1.462l4.552 1.42 10.532-6.645c.498-.303.953-.14.579.192l-8.533 7.701h-.002l.002.001-.314 4.692c.46 0 .663-.211.921-.46l2.211-2.15 4.599 3.397c.848.467 1.457.227 1.668-.785l3.019-14.228c.309-1.239-.473-1.8-1.282-1.434z"/></svg>`;

  // 1. Архив чатов (с голубым кругом и двойным контуром вокруг как на скриншоте)
  if (folder !== 'archive' && !cleanQ) {
    const archUnread = archivedChats.reduce((s, id) => s + (unreadCounts[id] || 0), 0);
    const archBadge = archUnread > 0 ? `<span class="unread-badge" style="background:#8e8e93">${archUnread}</span>` : '';
    const archNames = archivedChats.map(id => {
      if (id === 'service') return 'TurboGram';
      const u = users.find(x => x.id === id);
      const r = customRooms.find(x => x.id === id);
      return u ? u.name : (r ? r.title : id);
    }).join(', ');
    list.innerHTML += `<div class="chat-item" onclick="setFolder('archive')"><div class="avatar" style="background:linear-gradient(180deg,#64b5f6,#2196f3);box-shadow:0 0 0 2px #000,0 0 0 3.5px rgba(100,181,246,0.55)">${archiveBoxSvg}</div><div class="chat-info"><div class="chat-top"><span class="chat-name">Архив чатов</span><span class="chat-time">${archivedChats.length || ''}</span></div><div class="chat-bottom"><span class="chat-preview">${archNames || 'Скрытые чаты'}</span>${archBadge}</div></div></div>`;
  }

  if (folder === 'archive') {
    list.innerHTML += `<div class="chat-item" onclick="setFolder('all')" style="color:#4ea4f6;font-weight:600"><span>← Назад ко всем чатам</span></div>`;
  }

  const isVisible = cid => folder === 'archive' ? archivedChats.includes(cid) : (!archivedChats.includes(cid) && allowed(cid));

  // 2. Избранное (голубой круг + белая залитая закладка)
  if (isVisible('saved') && (!cleanQ || 'избранное'.includes(cleanQ))) {
    const last = (hist.saved || []).at(-1);
    const prev = last ? (last.voice ? 'Голосовое сообщение' : (last.file ? 'Медиафайл' : last.text)) : 'Сохраняйте заметки и файлы';
    list.innerHTML += `<div class="chat-item ${chat === 'saved' ? 'active' : ''}" onclick="selectChat('saved','Избранное')"><div class="avatar" style="background:linear-gradient(180deg,#5eb5f7,#2b8ce6)">${bookmarkFillSvg}</div><div class="chat-info"><div class="chat-top"><span class="chat-name">Избранное</span><span class="chat-time">${last?.time || ''}</span></div><div class="chat-bottom"><span class="chat-preview">${prev}</span>${makeBadge('saved')}</div></div></div>`;
  }

  // 3. TurboGram (голубой круг + белый самолётик + синяя галочка)
  if (isVisible('service') && (!cleanQ || 'turbogram'.includes(cleanQ))) {
    const last = (hist.service || []).at(-1);
    const prev = last ? last.text.replace(/\n/g, ' ') : 'Вход с нового устройства...';
    list.innerHTML += `<div class="chat-item ${chat === 'service' ? 'active' : ''}" onclick="selectChat('service','TurboGram')" oncontextmenu="event.preventDefault();toggleArchiveChat('service')"><div class="avatar" style="background:linear-gradient(180deg,#5eb5f7,#2b8ce6)">${planeFillSvg}</div><div class="chat-info"><div class="chat-top"><span class="chat-name" style="display:flex;align-items:center">TurboGram${verifiedBadgeSvg}</span><span class="chat-time">${last?.time || ''}</span></div><div class="chat-bottom"><span class="chat-preview">${prev}</span>${makeBadge('service')}</div></div></div>`;
  }

  // 4. Созданные группы и каналы
  customRooms.forEach(r => {
    if (!isVisible(r.id) || (cleanQ && !r.title.toLowerCase().includes(cleanQ))) return;
    const last = (hist[r.id] || []).at(-1);
    const prev = last ? `${last.fromName}: ${last.text || 'Медиа'}` : (r.kind === 'channel' ? 'Канал создан' : 'Группа создана');
    list.innerHTML += `<div class="chat-item ${chat === r.id ? 'active' : ''}" onclick="selectChat('${r.id}','${r.title}')" oncontextmenu="event.preventDefault();toggleArchiveChat('${r.id}')"><div class="avatar" style="background:linear-gradient(135deg,#34c759,#007aff)">${r.title.slice(0,1).toUpperCase()}</div><div class="chat-info"><div class="chat-top"><span class="chat-name">${r.title}</span><span class="chat-time">${last?.time || ''}</span></div><div class="chat-bottom"><span class="chat-preview">${prev}</span>${makeBadge(r.id)}</div></div></div>`;
  });

  // 5. Личные переписки и поиск по @username
  users.forEach(u => {
    if (u.id === myId || !isVisible(u.id)) return;
    const hasHistory = (hist[u.id] && hist[u.id].length > 0) || chat === u.id;
    const matchesSearch = cleanQ.length >= 2 && ((u.username && u.username.toLowerCase().includes(cleanQ)) || u.name.toLowerCase().includes(cleanQ));
    if (!hasHistory && !matchesSearch) return;
    const last = (hist[u.id] || []).at(-1);
    const tag = u.username ? `@${u.username}` : '';
    const prev = typingUsers[u.id] ? `<span style="color:#3390ec">печатает...</span>` : (last ? (last.voice ? 'Голосовое сообщение' : (last.file ? 'Медиафайл' : last.text)) : (tag ? `${tag} • ${u.online ? 'в сети' : 'не в сети'}` : 'Нажмите, чтобы написать'));
    const ava = u.avatar ? `<img src="${u.avatar}">` : u.name.slice(0, 1).toUpperCase();
    list.innerHTML += `<div class="chat-item ${chat === u.id ? 'active' : ''}" onclick="selectChat('${u.id}','${u.name}')" oncontextmenu="event.preventDefault();toggleArchiveChat('${u.id}')"><div class="avatar">${ava}${u.online ? '<div class="online-dot"></div>' : ''}</div><div class="chat-info"><div class="chat-top"><span class="chat-name">${u.name} ${u.status || ''}</span><span class="chat-time">${last?.time || ''}</span></div><div class="chat-bottom"><span class="chat-preview">${prev}</span>${makeBadge(u.id)}</div></div></div>`;
  });
}

function updateChatHeader() {
  const sub = $('chatSubtitle'), hAva = $('headerAvatar'), rAva = $('iosRightAvatar'), badge = $('iosTotalUnread');
  sub.className = 'chat-header-sub';

  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);
  if (badge) {
    badge.style.display = totalUnread > 0 ? 'inline-block' : 'none';
    badge.textContent = totalUnread;
  }

  let avaHtml = '🔖';
  if (chat === 'saved') {
    sub.textContent = 'облачное хранилище';
    avaHtml = '🔖';
  } else if (chat === 'general') {
    sub.textContent = typingUsers.general ? `${typingUsers.general} печатает...` : `${users.length} участников`;
    if (typingUsers.general) sub.classList.add('is-typing');
    avaHtml = 'TG';
  } else if (chat.startsWith('gr_') || chat.startsWith('ch_')) {
    const r = customRooms.find(x => x.id === chat);
    sub.textContent = r?.kind === 'channel' ? 'канал' : 'группа';
    avaHtml = (r?.title || 'G').slice(0, 1).toUpperCase();
  } else {
    const u = users.find(x => x.id === chat);
    avaHtml = u?.avatar ? `<img src="${u.avatar}">` : (u?.name || '?').slice(0, 1).toUpperCase();
    if (typingUsers[chat]) { sub.textContent = 'печатает...'; sub.classList.add('is-typing'); }
    else if (u?.online) { sub.textContent = 'в сети'; sub.classList.add('is-online'); }
    else sub.textContent = u?.username ? `@${u.username}` : 'был(а) недавно';
  }
  if (hAva) hAva.innerHTML = avaHtml;
  if (rAva) rAva.innerHTML = avaHtml;
}

function selectChat(id, title) {
  chat = id; delete unreadCounts[id]; $('chatTitle').textContent = title; updateChatHeader();
  const isPrivate = id !== 'general' && id !== 'saved' && !id.startsWith('gr_') && !id.startsWith('ch_');
  $('callBtn').style.display = isPrivate ? 'block' : 'none';
  $('videoBtn').style.display = isPrivate ? 'block' : 'none';
  renderChatList(); renderMessages(); document.body.classList.add('mobile-chat-open');
}

function formatSpoilers(str) { return str.replace(/\|\|(.+?)\|\|/g, '<span class="spoiler" onclick="event.stopPropagation();this.classList.toggle(\'revealed\')">$1</span>'); }
function setReply(name, text) { replyTo = { name, text }; $('replyPreviewText').textContent = `Ответ для ${name}: ${text}`; $('replyBar').style.display = 'flex'; $('msgInput').focus(); }
function cancelReply() { replyTo = null; $('replyBar').style.display = 'none'; }
function editMessage(msgId, oldText) { const nw = prompt('Изменить сообщение:', oldText); if (nw && nw.trim() && nw !== oldText) ws.send(JSON.stringify({ type: 'edit_msg', to: chat === 'saved' ? myId : chat, msgId, text: nw.trim() })); }
function deleteMessage(msgId) { if (confirm('Удалить сообщение?')) ws.send(JSON.stringify({ type: 'delete_msg', to: chat === 'saved' ? myId : chat, msgId })); }
function pinMessage(text) { ws.send(JSON.stringify({ type: 'pin_msg', to: chat === 'saved' ? myId : chat, text })); }

function openMsgContextMenu(e, m, me) {
  e.preventDefault(); e.stopPropagation();
  const menu = $('msgContextMenu'), targetTo = chat === 'saved' ? myId : chat, safeText = (m.text || 'Медиа').replace(/'/g, '');
  let html = `<div class="ctx-item" onclick="setReply('${m.fromName}','${safeText}');closeContextMenu()"><span>Ответить</span><span>↩️</span></div>`;
  html += `<div class="ctx-item" onclick="ws.send(JSON.stringify({type:'reaction',to:'${targetTo}',msgId:'${m.msgId}',emoji:'❤️'}));closeContextMenu()"><span>Реакция</span><span>❤️</span></div>`;
  html += `<div class="ctx-item" onclick="pinMessage('${safeText}');closeContextMenu()"><span>Закрепить</span><span>📌</span></div>`;
  if (me && m.text) html += `<div class="ctx-item" onclick="editMessage('${m.msgId}','${safeText}');closeContextMenu()"><span>Изменить</span><span>✏️</span></div>`;
  if (me) html += `<div class="ctx-item danger" onclick="deleteMessage('${m.msgId}');closeContextMenu()"><span>Удалить</span><span>🗑️</span></div>`;
  menu.innerHTML = html; menu.style.display = 'flex';
  menu.style.left = Math.min(e.clientX || 100, window.innerWidth - 200) + 'px';
  menu.style.top = Math.min(e.clientY || 200, window.innerHeight - 230) + 'px';
}
function closeContextMenu() { if ($('msgContextMenu')) $('msgContextMenu').style.display = 'none'; }
document.addEventListener('click', closeContextMenu);
function renderMessages() {
  const box = $('messages'); box.innerHTML = '';
  const isRoom = chat === 'general' || chat.startsWith('gr_') || chat.startsWith('ch_');
  (hist[chat] || []).forEach(m => {
    const me = m.fromId === myId, el = document.createElement('div');
    el.className = 'msg ' + (me ? 'outgoing' : 'incoming');
    el.onclick = e => openMsgContextMenu(e, m, me);
    let body = (!me && isRoom) ? `<div class="msg-author">${m.fromName}</div>` : '';
    if (m.reply) body += `<div class="reply-quote"><b>${m.reply.name}:</b> ${m.reply.text}</div>`;
    if (m.text) body += `<span>${formatSpoilers(m.text)}</span>`;
    if (m.voice) body += `<audio controls src="${m.voice}" style="height:34px;max-width:220px;margin-top:4px;display:block" onclick="event.stopPropagation()"></audio>`;
    if (m.file) body += m.file.isImage ? `<img src="${m.file.data}" class="msg-img">` : `<a href="${m.file.data}" download="${m.file.name}" class="msg-file-box" onclick="event.stopPropagation()">📄 ${m.file.name}</a>`;
    const meta = `<span class="msg-meta">${m.edited ? 'ред. ' : ''}${m.time}${me ? ' ✓✓' : ''}</span>`;
    const rk = Object.keys(m.reactions || {});
    const reacts = rk.length ? `<div class="reactions-row">${rk.map(k => `<span class="reaction-badge">${k} ${m.reactions[k]}</span>`).join('')}</div>` : '';
    el.innerHTML = body + meta + reacts; box.appendChild(el);
  });
  box.scrollTop = box.scrollHeight;
}

function sendMessage() {
  const inp = $('msgInput'), text = inp.value.trim();
  if (!text) return; if (pkr) pkr.style.display = 'none';
  const msgId = Date.now().toString(), time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const target = chat === 'saved' ? myId : chat;
  const isRoom = chat === 'general' || chat.startsWith('gr_') || chat.startsWith('ch_');
  const payload = { type: 'message', msgId, to: target, text, reply: replyTo };
  if (!isRoom && chat !== 'saved') {
    (hist[chat] = hist[chat] || []).push({ ...payload, fromId: myId, fromName: myName, time, reactions: {} });
    renderMessages(); renderChatList();
  }
  ws.send(JSON.stringify(payload)); inp.value = ''; updateSendBtnState(); cancelReply();
}

function sendFile(e) {
  const f = e.target.files.item(0); if (!f) return;
  const r = new FileReader();
  r.onload = ev => {
    const msgId = Date.now().toString(), time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const file = { name: f.name, isImage: f.type.startsWith('image/'), data: ev.target.result };
    const target = chat === 'saved' ? myId : chat;
    const isRoom = chat === 'general' || chat.startsWith('gr_') || chat.startsWith('ch_');
    ws.send(JSON.stringify({ type: 'message', msgId, to: target, text: '', file, reply: replyTo }));
    if (!isRoom && chat !== 'saved') {
      (hist[chat] = hist[chat] || []).push({ msgId, fromId: myId, fromName: myName, text: '', file, time, reply: replyTo, reactions: {} });
      renderMessages(); renderChatList();
    }
    cancelReply();
  };
  r.readAsDataURL(f); e.target.value = '';
}

$('msgInput').addEventListener('input', () => {
  updateSendBtnState();
  if (chat !== 'saved' && ws && ws.readyState === 1 && !typingTimer) {
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
          const isRoom = chat === 'general' || chat.startsWith('gr_') || chat.startsWith('ch_');
          ws.send(JSON.stringify({ type: 'message', msgId, to: target, text: '', voice: ev.target.result, reply: replyTo }));
          if (!isRoom && chat !== 'saved') {
            (hist[chat] = hist[chat] || []).push({ msgId, fromId: myId, fromName: myName, text: '', voice: ev.target.result, time, reply: replyTo, reactions: {} });
            renderMessages(); renderChatList();
          }
          cancelReply();
        };
        reader.readAsDataURL(new Blob(audioChunks, { type: blobType }));
      };
      mediaRec.start(); isRecording = true; btn.classList.add('recording'); btn.innerHTML = '■';
    } catch (err) { alert('Ошибка микрофона: ' + err.message); }
  } else { mediaRec.stop(); isRecording = false; btn.classList.remove('recording'); updateSendBtnState(); }
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
  if (chat === 'general' || chat === 'saved' || chat.startsWith('gr_') || chat.startsWith('ch_')) return;
  try {
    $('callBar').style.display = 'flex'; $('callStatus').textContent = withVideo ? 'Видеозвонок...' : 'Звонок...';
    await setupPC(chat, withVideo); const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: 'call_offer', to: chat, offer, withVideo }));
  } catch (err) { alert('Ошибка звонка: ' + err.message); endCall(false); }
}

async function handleOffer(d) {
  if (!confirm(`Входящий звонок от ${d.fromName}. Ответить?`)) return ws.send(JSON.stringify({ type: 'call_end', to: d.fromId }));
  try {
    $('callBar').style.display = 'flex'; $('callStatus').textContent = `Связь с ${d.fromName}`;
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

connectWS();




