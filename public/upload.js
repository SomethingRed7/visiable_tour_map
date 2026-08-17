/* 咕咕嘎嘎 - 写日记(前端压缩 + 地图选点 + 上传 + 删除管理) */
'use strict';

const $ = (s) => document.querySelector(s);

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
  } else showLoginPanel();
}

/* ---------- 进入界面自动定位(后台,不打扰;失败静默,不覆盖已有值) ---------- */
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
    renderRecent(); // 登录后重拉列表(否则保留匿名可见的旧数据,私有条目不出现)
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
    renderRecent(); // 首次设置成功后同样刷新列表
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
  const el = document.querySelector('#export-status') || document.querySelector('#who-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'form-status' + (isErr ? ' error' : '');
}
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
    // 自动排列:横图移到「第一个竖图之前」(竖图两两成对在后,避免一行只有一张竖图)
    const mark = () => {
      if (img.naturalWidth > img.naturalHeight) {
        img.classList.add('landscape');
        const grid = img.closest('.photo-grid');
        if (grid) {
          const firstPortrait = grid.querySelector('img:not(.landscape)');
          if (firstPortrait) firstPortrait.before(img);
          else grid.appendChild(img);
        }
      }
    };
    if (img.complete) mark();
    else img.addEventListener('load', mark);
  });
}
async function renderRecent() {
  const box = $('#recent-list');
  const ckinBox = $('#ckin-list');
  try {
    const data = await (await fetch('/api/entries')).json();
    // 填充导出专辑下拉(保留已选值;专辑列表来自全部条目去重)
    const exSel = $('#ex-album');
    if (exSel) {
      const prev = exSel.value;
      const albums = [...new Set((data.entries || []).map((e) => e.album).filter(Boolean))].sort();
      exSel.innerHTML = '<option value="">全部专辑</option>' + albums.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('');
      if (prev) exSel.value = prev;
    }
    const all = (data.entries || [])
      .sort((a, b) => (a.date === b.date ? (a.created_at || '') > (b.created_at || '') ? -1 : 1 : a.date > b.date ? -1 : 1))
      .slice(0, 40);
    // 打卡记录 = 标题以「打卡:」开头;其余为日记
    const ckin = all.filter((e) => (e.title || '').startsWith('打卡:'));
    const diary = all.filter((e) => !(e.title || '').startsWith('打卡:')).slice(0, 20);
    const itemHtml = (e) => `<div class="recent-item">
        <span class="recent-info">${esc(e.date)} <span class="time-tag">${fmtTime(entryTs(e))}</span> ${e.visibility === 'private' ? '<span class="vis-tag">私有</span>' : ''} <b>${esc(e.title || '')}</b>${(e.title || '').startsWith('打卡:') ? '' : ` · ${esc(e.author || '')}`}</span>
        <span class="recent-actions">
          <button type="button" class="btn-small btn-vis" data-date="${esc(e.date)}" data-ts="${esc(entryTs(e))}" data-vis="${e.visibility === 'private' ? 'private' : 'public'}">${e.visibility === 'private' ? '改公开' : '改私有'}</button>
          <button type="button" class="btn-small btn-prev" data-date="${esc(e.date)}" data-ts="${esc(entryTs(e))}">预览</button>
          <button type="button" class="btn-small btn-edit" data-date="${esc(e.date)}" data-ts="${esc(entryTs(e))}">编辑</button>
          <button type="button" class="btn-small btn-del" data-date="${esc(e.date)}" data-ts="${esc(entryTs(e))}">删除</button>
        </span>
      </div>`;
    box.innerHTML = diary.length ? diary.map(itemHtml).join('') : '<p class="empty">还没有日记条目</p>';
    ckinBox.innerHTML = ckin.length ? ckin.map(itemHtml).join('') : '<p class="empty">还没有打卡记录</p>';
    [box, ckinBox].forEach((b) => {
      bindPhotoGridFallback(b);
      [...b.querySelectorAll('.btn-prev')].forEach((btn) => btn.addEventListener('click', () => openPreview(btn.dataset.date, btn.dataset.ts)));
      [...b.querySelectorAll('.btn-edit')].forEach((btn) => btn.addEventListener('click', () => { location.href = `/edit?date=${btn.dataset.date}&ts=${btn.dataset.ts}`; }));
      [...b.querySelectorAll('.btn-del')].forEach((btn) => btn.addEventListener('click', () => askDelete(btn)));
      [...b.querySelectorAll('.btn-vis')].forEach((btn) => btn.addEventListener('click', () => toggleVisibility(btn)));
    });
  } catch { /* 忽略 */ }
}

/* 管理列表:公开/私有切换(轻量 update,仅改可见性) */
async function toggleVisibility(b) {
  const fd = new FormData();
  fd.append('date', b.dataset.date);
  fd.append('ts', b.dataset.ts);
  fd.append('visibility', b.dataset.vis === 'private' ? 'public' : 'private');
  try {
    const res = await (await fetch('/api/update', { method: 'POST', body: fd })).json();
    if (res.ok) renderRecent();
    else alert(res.error || '切换失败');
  } catch { alert('网络异常,请重试'); }
}

/* ---- 预览(只读弹层,portal 同款卡片) ---- */
async function openPreview(date, ts) {
  const data = await (await fetch(`/api/entries?date=${date}`)).json();
  const e = (data.entries || []).find((x) => String(x.ts) === String(ts));
  if (!e) return alert('条目不存在');
  $('#preview-body').innerHTML = `<div class="preview-date">${esc(e.date)}</div>` + entryCardHtml(e);
  $('#preview-modal').hidden = false;
  bindPhotoGridFallback($('#preview-body'));
  $('#preview-body').querySelectorAll('.photo-grid img').forEach((img) => {
    img.addEventListener('click', () => window.open(img.dataset.full || img.src, '_blank'));
  });
}

$('#btn-preview-close').addEventListener('click', () => { $('#preview-modal').hidden = true; });
$('#preview-modal').addEventListener('click', (e) => { if (e.target.id === 'preview-modal') $('#preview-modal').hidden = true; });
function askDelete(btn) {
  const { date, ts } = btn.dataset;
  if (!confirm(`确定删除 ${date} 的这条日记吗?\n照片会一起删除,无法恢复!`)) return;
  doDelete(date, ts);
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
  renderRecent();
}
/* ---- 导出行程(按专辑 / 按起止日期 / 叠加)---- */
$('#btn-export').addEventListener('click', () => {
  const album = $('#ex-album').value.trim();
  const from = $('#ex-from').value;
  const to = $('#ex-to').value;
  const st = $('#export-status');
  st.className = 'form-status';
  if (!album && (!from || !to)) { st.textContent = '请选择专辑,或选择起止日期(可都选叠加)'; st.className = 'form-status error'; return; }
  if (from && to && from > to) { st.textContent = '起始日期不能晚于结束日期'; st.className = 'form-status error'; return; }
  if (from && to) {
    const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
    if (days > 60) { st.textContent = '区间最多 60 天'; st.className = 'form-status error'; return; }
  }
  const q = new URLSearchParams();
  if (album) q.set('album', album);
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  location.href = `/export?${q.toString()}`;
});
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/* 管理页初始化 */
initAuth();
renderRecent();
