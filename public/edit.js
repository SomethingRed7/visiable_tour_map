/* 咕咕嘎嘎 - 写日记(前端压缩 + 地图选点 + 上传 + 删除管理) */
'use strict';

var $ = (s) => document.querySelector(s);
const form = $('#diary-form');

/* ---------- 登录 / 会话 ---------- */
let pendingUser = ''; // 第二步(密码)所属的已确认用户名
let whitelist = [];   // 公开白名单(来自 /api/config,供「你是?」本地校验)

function showLoginPanel() {
  $('#who-form').hidden = false;
  $('#login-form').hidden = true;
  $('#setup-form').hidden = true;
}

function setAuthed(user) {
  const loggedIn = !!user;
  $('#login-panel').hidden = loggedIn;
  $('#editor-area').hidden = !loggedIn;
  $('#user-area').hidden = !loggedIn;
  if (user) {
    $('#current-user').textContent = user;
    // ⚠️ 不做自动定位:页面加载/登录时发起 geolocation 属非手势请求,
    // Chrome 会拒绝并污染权限状态,导致用户手动点击定位也失败(2026-08-15 用户反馈换浏览器都定不上)
  } else showLoginPanel();
}

async function initAuth() {
  try {
    const [auth, cfg] = await Promise.all([
      fetch('/api/auth').then((r) => r.json()),
      fetch('/api/config').then((r) => r.json()),
    ]);
    whitelist = cfg.users || [];
    setAuthed(auth.user || null);
  } catch {
    whitelist = [];
    setAuthed(null);
  }
}

// 第一步「你是?」:白名单内 → 密码步骤;否则「不认识」
$('#who-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const st = $('#who-status');
  st.className = 'form-status';
  const name = $('#who-user').value.trim();
  if (!name) {
    st.className = 'form-status error';
    st.textContent = '请输入你的名字';
    return;
  }
  if (!whitelist.includes(name)) {
    st.className = 'form-status error';
    st.textContent = `不认识 "${name}"`;
    return;
  }
  pendingUser = name;
  $('#lg-echo').textContent = name;
  $('#lg-pass').value = '';
  $('#login-status').className = 'form-status';
  $('#login-status').textContent = '';
  $('#who-form').hidden = true;
  $('#login-form').hidden = false;
  $('#lg-pass').focus();
});

$('#lg-change').addEventListener('click', (e) => {
  e.preventDefault();
  pendingUser = '';
  $('#login-form').hidden = true;
  $('#who-form').hidden = false;
  $('#who-status').className = 'form-status';
  $('#who-status').textContent = '';
  $('#who-user').focus();
});

// 写接口 401(会话过期)→ 弹回登录框
function bounceOn401(res) {
  if (res.status === 401) setAuthed(null);
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!pendingUser) { showLoginPanel(); return; } // 防御:未经过第一步
  const st = $('#login-status');
  st.className = 'form-status';
  st.textContent = '登录中...';
  try {
    const fd = new FormData();
    fd.append('username', pendingUser);
    fd.append('password', $('#lg-pass').value);
    const res = await fetch('/api/login', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      st.className = 'form-status error';
      st.textContent = data.error || `登录失败(HTTP ${res.status})`;
      return;
    }
    setAuthed(data.user);
    st.textContent = '';
  } catch {
    st.className = 'form-status error';
    st.textContent = '网络错误,请重试';
  }
});

$('#setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const st = $('#setup-status');
  st.className = 'form-status';
  const pass = $('#st-pass').value;
  if (pass.length < 8) {
    st.className = 'form-status error';
    st.textContent = '密码至少 8 位';
    return;
  }
  if (pass !== $('#st-pass2').value) {
    st.className = 'form-status error';
    st.textContent = '两次输入的密码不一致';
    return;
  }
  st.textContent = '设置中...';
  try {
    const fd = new FormData();
    fd.append('username', $('#st-user').value.trim());
    fd.append('code', $('#st-code').value.trim());
    fd.append('new_password', pass);
    const res = await fetch('/api/login', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      st.className = 'form-status error';
      st.textContent = data.error || `设置失败(HTTP ${res.status})`;
      return;
    }
    setAuthed(data.user);
    st.textContent = '';
  } catch {
    st.className = 'form-status error';
    st.textContent = '网络错误,请重试';
  }
});

$('#lg-back').addEventListener('click', (e) => {
  e.preventDefault();
  $('#setup-form').hidden = true;
  $('#login-form').hidden = false;
  $('#setup-status').className = 'form-status';
  $('#setup-status').textContent = '';
});

// 「初次使用?」显式入口:切到首次设置,用户名带过来(唯一入口,登录不自动跳转)
$('#lg-to-setup').addEventListener('click', (e) => {
  e.preventDefault();
  $('#st-user').value = pendingUser || $('#who-user').value;
  $('#login-form').hidden = true;
  $('#setup-form').hidden = false;
  $('#setup-status').className = 'form-status';
  $('#setup-status').textContent = '输入管理员发给你的一次性设置码,设置你的密码';
  $('#st-code').focus();
});

$('#btn-logout').addEventListener('click', async () => {
  try { await fetch('/api/logout', { method: 'POST' }); } catch { /* 忽略 */ }
  setAuthed(null);
  $('#lg-pass').value = '';
});

function setStatus(msg, isErr) {
  const el = $('#form-status');
  el.textContent = msg;
  el.className = 'form-status' + (isErr ? ' error' : '');
}

/* 浏览器端压缩:Image + objectURL(兼容微信内置浏览器;现代浏览器自动处理 EXIF 方向) */
function compressImage(file, maxLen, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxLen / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`图片无法解码:${file.name}(HEIC 请用 iPhone Safari 打开)`));
    };
    img.src = url;
  });
}

/* 相册 select(原生下拉,移动端兼容;datalist 在微信/安卓 WebView 表现差已弃用) */
async function loadAlbums() {
  try {
    const data = await (await fetch('/api/entries')).json();
    const albums = [...new Set((data.entries || []).map((e) => e.album).filter(Boolean))];
    const sel = $('#f-album');
    // 记住上次选择(applyDefaults 在 select 填充前赋值会失败,这里兜底读 localStorage)
    const current = sel.value || localStorage.getItem(LS_ALBUM) || '';
    sel.innerHTML = '<option value="">不设专辑</option>' +
      albums.map((a) => `<option value="${a.replace(/"/g, '&quot;')}">${a.replace(/"/g, '&quot;')}</option>`).join('') +
      '<option value="__new__">➕ 新建专辑…</option>';
    // 恢复之前的值(编辑回填/记住上次选择)
    if (current) {
      const exists = [...sel.options].some((o) => o.value === current);
      if (exists) sel.value = current;
      else if (current !== '__new__') {
        // 当前值不在列表(如老条目专辑):补一个选项并选中
        const o = document.createElement('option');
        o.value = current;
        o.textContent = current;
        sel.insertBefore(o, sel.lastChild);
        sel.value = current;
      }
    }
  } catch { /* 忽略,保留默认选项 */ }
  window.__albumsLoaded = true; // 供 URL 参数编辑态等待 select 就绪
}

$('#f-album').addEventListener('change', () => {
  const sel = $('#f-album');
  if (sel.value !== '__new__') return;
  const name = prompt('新专辑名字:');
  if (name && name.trim()) {
    const v = name.trim();
    const exists = [...sel.options].some((o) => o.value === v);
    if (!exists) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      sel.insertBefore(o, sel.lastChild);
    }
    sel.value = v;
  } else {
    sel.value = ''; // 取消 → 回到「不设专辑」
  }
});

/* 照片预览(与打卡弹窗一致:方形缩略图,无文件名) */
function renderPreview() {
  const files = [...$('#f-photos').files];
  $('#photo-preview').innerHTML = files
    .map((f, i) => `<div class="preview-item"><img src="${URL.createObjectURL(f)}" alt="预览 ${i + 1}"></div>`)
    .join('');
}

/* ---------- 地点:📍 自动定位 + 🗺️ 地图选点(共享 loc-picker.js,与打卡弹窗同一组件) ---------- */
function openPicker() {
  LocPicker.open({
    onPick: (name, lat, lng) => {
      $('#f-location').value = name;
      $('#f-lat').value = lat;
      $('#f-lng').value = lng;
    },
  });
}

// 「📍 定位」:直接自动定位填地点(不开选点器,与打卡弹窗一致;手势内唯一请求)
function locateToField() {
  const st = $('#form-status');
  const input = $('#f-location');
  st.textContent = '定位中...';
  if (/MicroMessenger/i.test(navigator.userAgent)) {
    st.textContent = '微信内无法定位:点右上角 ⋯ 选「在浏览器打开」后重试,或用「🗺️ 地图」选点';
    return;
  }
  let settled = false;
  const done = (lat, lng) => {
    if (settled) return;
    settled = true;
    input.value = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    $('#f-lat').value = lat;
    $('#f-lng').value = lng;
    // 反查地名填输入框(超时则保留坐标)
    (async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        const r = await (await fetch(`/api/geocode?lat=${lat}&lng=${lng}`, { signal: ctrl.signal })).json();
        clearTimeout(timer);
        const res = r.results && r.results[0];
        if (res && res.name) input.value = res.name.slice(0, 80);
      } catch { /* 保留坐标 */ }
      st.textContent = '';
    })();
  };
  const fail = (err) => {
    if (settled) return;
    settled = true;
    let detail = '';
    if (err) {
      const map = { 1: '(权限被拒)', 2: '(定位服务不可用)', 3: '(定位超时)' };
      detail = ' ' + (map[err.code] || '(错误' + err.code + ')');
    }
    st.textContent = '定位失败:' + (detail || '检查位置权限/系统定位后重试') + ',或点「🗺️ 地图」选';
  };
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const g = wgs2gcj(pos.coords.latitude, pos.coords.longitude);
        done(g.lat, g.lng);
      },
      (err) => fail(err),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  } else {
    fail();
  }
}

$('#btn-loc').addEventListener('click', locateToField);
$('#btn-loc-map').addEventListener('click', openPicker);
$('#f-location').addEventListener('click', openPicker);

/* ---------- 上传 ---------- */
async function doUpload() {
  const date = $('#f-date').value;
  const title = $('#f-title').value.trim();
  const text = $('#f-text').value.trim();
  const album = $('#f-album').value.trim() || null;
  const location = $('#f-location').value.trim() || null;
  const lat = $('#f-lat').value;
  const lng = $('#f-lng').value;
  const files = [...$('#f-photos').files];

  if (!date) return setStatus('请选择日期', true);
  if (!title && !text && files.length === 0) return setStatus('至少填标题/文字/照片之一', true);

  const fd = new FormData();
  fd.append('date', date);
  fd.append('visibility', $('#f-visibility').value === 'private' ? 'private' : 'public');
  if (location) {
    fd.append('location', location);
    if (lat && lng) { fd.append('lat', lat); fd.append('lng', lng); }
  }
  if (title) fd.append('title', title);
  if (text) fd.append('text', text);
  if (album) fd.append('album', album);

  const btn = $('#btn-submit');
  btn.disabled = true;
  btn.textContent = '发布中...';
  try {
    for (let i = 0; i < files.length; i++) {
      setStatus(`压缩照片 ${i + 1}/${files.length}...`);
      const full = await compressImage(files[i], 1600, 0.85);
      const thumb = await compressImage(files[i], 480, 0.75);
      fd.append('photo_full', full, files[i].name);
      fd.append('photo_thumb', thumb, files[i].name);
    }
    setStatus('上传中...');
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      bounceOn401(res);
      return setStatus(data.error || `上传失败(HTTP ${res.status})`, true);
    }

    // 成功:记住本次选择 + 横幅 + 清空表单
    rememberDefaults();
    $('#success-banner').hidden = false;
    $('#btn-view-day').href = `/?date=${date}`;
    setStatus('', false);
    form.reset();
    $('#f-date').value = new Date().toISOString().slice(0, 10);
    $('#f-location').value = $('#f-lat').value = $('#f-lng').value = '';
    $('#photo-preview').innerHTML = '';
    if (typeof renderRecent === 'function') renderRecent();
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '发布';
  }
}

$('#btn-again').addEventListener('click', () => {
  $('#success-banner').hidden = true;
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (editing) doUpdate();
  else doUpload();
});
$('#f-photos').addEventListener('change', renderPreview);
function entryTs(e) {
  if (e.ts) return String(e.ts);
  if (e.photos && e.photos[0]) {
    const m = e.photos[0].match(/(\d{13})-\d+\.jpg$/);
    if (m) return m[1];
  }
  return '';
}

function thumbUrl(p) { return p.replace(/\.(jpg|jpeg|png)$/i, '-thumb.$1'); }

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* 地点名截短:只显示第一段短名(如「杭州东站」,忽略完整地址逗号串) */
function shortLoc(name) {
  const s = String(name || '').split(/[,，]/)[0].trim();
  return (s || String(name || '')).slice(0, 30);
}
function entryCardHtml(e) {
  const authorTag = e.author ? `<span class="author-tag${e.author === '小红' ? ' rose' : ''}">${esc(e.author)}</span>` : '';
  const locTag = e.location && e.location.name ? `<span class="loc-tag">📍 ${esc(shortLoc(e.location.name))}</span>` : '';
  const timeTag = entryTs(e) ? `<span class="time-tag">${fmtTime(entryTs(e))}</span>` : '';
  const visTag = e.visibility === 'private' ? '<span class="vis-tag">私有</span>' : '';
  const photos = (e.photos || []).map((p) => `<img src="${thumbUrl(p)}" data-full="${p}" alt="照片" loading="lazy">`).join('');
  return `<article class="entry preview-entry">
    <div class="entry-meta">${timeTag}${authorTag}${visTag}${e.album ? `<span class="album-tag">${esc(e.album)}</span>` : ''}${locTag}</div>
    ${e.title ? `<h3 class="entry-title">${esc(e.title)}</h3>` : ''}
    ${e.text ? `<div class="entry-text">${esc(e.text).replace(/\n/g, '<br>')}</div>` : ''}
    ${photos ? `<div class="photo-grid">${photos}</div>` : ''}
  </article>`;
}
// 照片兜底:缩略图 404 → 回退全图;全图也挂 → 隐藏(CSP 禁内联 onerror,必须 addEventListener)
function bindPhotoGridFallback(container) {
  container.querySelectorAll('.photo-grid img').forEach((img) => {
    const fb = () => {
      if (img.src !== img.dataset.full) img.src = img.dataset.full;
      else img.style.display = 'none';
    };
    img.addEventListener('error', fb);
    if (img.complete && img.naturalWidth === 0) fb();
    // 横图(宽>高)加 landscape 类 → 单列占满整行(竖图保持双列)
    const mark = () => { if (img.naturalWidth > img.naturalHeight) img.classList.add('landscape'); };
    if (img.complete) mark();
    else img.addEventListener('load', mark);
  });
}
/* ---- 编辑 ---- */
let editing = null;    // { date, ts, photos }
let removedPaths = []; // 编辑中要删除的照片路径

async function enterEdit(date, ts) {
  const data = await (await fetch(`/api/entries?date=${date}`)).json();
  const e = (data.entries || []).find((x) => String(x.ts) === String(ts));
  if (!e) return alert('条目不存在');

  editing = { date, ts, photos: e.photos || [] };
  removedPaths = [];
  $('#f-date').value = date;
  $('#f-date').disabled = true; // 日期是主键,编辑不改
  $('#f-title').value = e.title || '';
  $('#f-text').value = e.text || '';
  // select 回填:专辑不在选项列表(老条目)时先补一个选项再选中
  const albumSel = $('#f-album');
  if (e.album) {
    const exists = [...albumSel.options].some((o) => o.value === e.album);
    if (!exists) {
      const o = document.createElement('option');
      o.value = e.album;
      o.textContent = e.album;
      albumSel.insertBefore(o, albumSel.lastChild);
    }
  }
  albumSel.value = e.album || '';
  $('#f-visibility').value = e.visibility === 'private' ? 'private' : 'public'; // 仅展示,保存走 doUpdate(不提交可见性)
  $('#f-location').value = (e.location && e.location.name) || '';
  $('#f-lat').value = $('#f-lng').value = '';
  $('#f-photos').value = '';
  $('#photo-preview').innerHTML = '';
  $('#success-banner').hidden = true;
  setStatus('编辑模式:可改文字/地点,点照片 ✕ 移除,选新照片追加', false);
  renderEditPhotos();
  $('#btn-submit').textContent = '保存修改';
  $('#btn-cancel-edit').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function renderEditPhotos() {
  const box = $('#edit-photos');
  if (!editing) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<div class="edit-photos-title">现有照片(点 ✕ 移除)</div><div class="edit-photos-grid">' +
    editing.photos.map((p) => `<div class="edit-photo${removedPaths.includes(p) ? ' removed' : ''}">
      <img src="${thumbUrl(p)}" alt="现有照片">
      <button type="button" class="edit-photo-x" data-p="${esc(p)}">✕</button>
      ${removedPaths.includes(p) ? '<span class="edit-photo-mark">待移除</span>' : ''}
    </div>`).join('') + '</div>';
  [...box.querySelectorAll('.edit-photo-x')].forEach((b) => {
    b.addEventListener('click', () => {
      const p = b.dataset.p;
      if (removedPaths.includes(p)) removedPaths = removedPaths.filter((x) => x !== p);
      else removedPaths.push(p);
      renderEditPhotos();
    });
  });
}
function cancelEdit() {
  editing = null;
  removedPaths = [];
  $('#f-date').disabled = false;
  $('#edit-photos').hidden = true;
  $('#btn-submit').textContent = '发布';
  $('#btn-cancel-edit').hidden = true;
  setStatus('', false);
  form.reset();
  $('#photo-preview').innerHTML = ''; // form.reset 不清 div,预览残留会误显示为"待上传"
  $('#f-date').value = new Date().toISOString().slice(0, 10);
  $('#f-location').value = $('#f-lat').value = $('#f-lng').value = '';
  applyDefaults();
}

$('#btn-cancel-edit').addEventListener('click', cancelEdit);
/* ---- 保存修改 ---- */
async function doUpdate() {
  const date = editing.date;
  const title = $('#f-title').value.trim();
  const text = $('#f-text').value.trim();
  const album = $('#f-album').value.trim() || null;
  const location = $('#f-location').value.trim() || null;
  const lat = $('#f-lat').value;
  const lng = $('#f-lng').value;
  const files = [...$('#f-photos').files];

  const fd = new FormData();
  fd.append('date', date);
  fd.append('ts', editing.ts);
  fd.append('title', title);
  fd.append('text', text);
  fd.append('album', album || '');
  fd.append('location', location || '');
  if (lat && lng) { fd.append('lat', lat); fd.append('lng', lng); }
  fd.append('photos_to_remove', JSON.stringify(removedPaths));

  const btn = $('#btn-submit');
  btn.disabled = true;
  btn.textContent = '保存中...';
  try {
    for (let i = 0; i < files.length; i++) {
      setStatus(`压缩照片 ${i + 1}/${files.length}...`);
      const full = await compressImage(files[i], 1600, 0.85);
      const thumb = await compressImage(files[i], 480, 0.75);
      fd.append('photo_full', full, files[i].name);
      fd.append('photo_thumb', thumb, files[i].name);
    }
    setStatus('保存中...');
    const res = await fetch('/api/update', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      bounceOn401(res);
      return setStatus(data.error || `保存失败(HTTP ${res.status})`, true);
    }
    cancelEdit();
    setStatus('已保存 ✅', false);
    if (typeof renderRecent === 'function') renderRecent();
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = editing ? '保存修改' : '发布';
  }
}
async function doDelete(date, ts) {
  const fd = new FormData();
  fd.append('date', date);
  fd.append('ts', ts);
  const res = await fetch('/api/delete', { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    bounceOn401(res);
    return alert(data.error || `删除失败(HTTP ${res.status})`);
  }
  alert('已删除 ✅');
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/* ---------- 记住上次选择(仅专辑;地点不再自动恢复,避免自动定位失败时残留旧地点误导) ---------- */
const LS_ALBUM = 'gg_album';
// 地点不再记住/恢复:进入界面一律走自动定位,失败留空由用户手动选(2026-08-14 用户反馈)

function applyDefaults() {
  $('#f-album').value = localStorage.getItem(LS_ALBUM) || '';
}

function rememberDefaults() {
  localStorage.setItem(LS_ALBUM, $('#f-album').value.trim() || '');
  // 旧版残留的地点键清掉,防历史数据回灌
  localStorage.removeItem('gg_loc_name');
  localStorage.removeItem('gg_loc_lat');
  localStorage.removeItem('gg_loc_lng');
}
/* ---------- 日期选择弹层(替代原生 date input,跨端观感统一) ---------- */
const dp = {
  viewY: 0, viewM: 0, // 当前翻页所在的年月
};
function renderDatePicker() {
  const grid = $('#dp-grid');
  const first = new Date(dp.viewY, dp.viewM, 1);
  const startWeekday = first.getDay(); // 0=周日
  const daysInMonth = new Date(dp.viewY, dp.viewM + 1, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);
  const cur = $('#f-date').value;
  $('#dp-title').textContent = `${dp.viewY}年${dp.viewM + 1}月`;
  let html = '';
  for (let i = 0; i < startWeekday; i++) html += '<span></span>';
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${dp.viewY}-${String(dp.viewM + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const cls = ['dp-day', ds === todayStr ? 'today' : '', ds === cur ? 'selected' : ''].filter(Boolean).join(' ');
    html += `<button type="button" class="${cls}" data-ds="${ds}">${d}</button>`;
  }
  grid.innerHTML = html;
}
function openDatePicker() {
  if ($('#f-date').disabled) return; // 编辑态日期锁定,不弹
  const cur = $('#f-date').value;
  if (cur) {
    const [y, m] = cur.split('-').map(Number);
    dp.viewY = y; dp.viewM = m - 1;
  } else {
    const t = new Date();
    dp.viewY = t.getFullYear(); dp.viewM = t.getMonth();
  }
  renderDatePicker();
  $('#date-picker').hidden = false;
}
$('#f-date').addEventListener('click', openDatePicker);
$('#dp-prev').addEventListener('click', (e) => { e.stopPropagation(); dp.viewM--; if (dp.viewM < 0) { dp.viewM = 11; dp.viewY--; } renderDatePicker(); });
$('#dp-next').addEventListener('click', (e) => { e.stopPropagation(); dp.viewM++; if (dp.viewM > 11) { dp.viewM = 0; dp.viewY++; } renderDatePicker(); });
$('#dp-grid').addEventListener('click', (e) => {
  const b = e.target.closest('.dp-day');
  if (!b) return;
  $('#f-date').value = b.dataset.ds;
  $('#date-picker').hidden = true;
});
document.addEventListener('click', (e) => {
  const picker = $('#date-picker');
  if (picker.hidden) return;
  if (!picker.contains(e.target) && e.target.id !== 'f-date') picker.hidden = true;
});
/* 默认日期 = 今天;先探测登录态,再初始化编辑器数据 */
$('#f-date').value = new Date().toISOString().slice(0, 10);
applyDefaults();
initAuth();
loadAlbums();

/* 从管理页跳转进入编辑态:?date=X&ts=Y */
(function () {
  const p = new URLSearchParams(location.search);
  const d = p.get('date');
  const t = p.get('ts');
  if (d && t) {
    // 等登录态 + 专辑 select 填充完成后回填(enterEdit 需要 f-album 选项就绪)
    const tryEdit = () => {
      if (!document.querySelector('#login-panel').hidden) return setTimeout(tryEdit, 300); // 未登录,等登录
      if (!window.__albumsLoaded) return setTimeout(tryEdit, 200);
      setTimeout(() => enterEdit(d, t), 50);
    };
    tryEdit();
  }
})();
