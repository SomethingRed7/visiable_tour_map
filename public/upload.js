/* 咕咕嘎嘎 - 写日记(前端压缩 + 地图选点 + 上传 + 删除管理) */
'use strict';

var $ = (s) => document.querySelector(s);

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
    syncTabH();   // 管理区刚显示出来,这时才量得到 tab 栏真实高度
    renderShares(); // 已分享快照列表(仅登录)
    renderAlbums(); // 专辑管理列表(仅登录)
    refreshAllEntries(); // 专辑查看数据(仅登录);地图等点专辑名展开时再渲染
    renderAlbumChips();
  } else {
    showLoginPanel();
    const sl = $('#share-list');
    if (sl) sl.innerHTML = '';
  }
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
/* ============================================================================
 * 管理页 UI 基建:Toast / 底部弹层 / 吸顶偏移 / 骨架屏
 * (2026-09-27 管理界面整体改版:分段 tab + 上下文操作栏 + 底部动作表)
 * ==========================================================================*/

/* 轻量提示,替代成功类 alert():不打断操作,2.2s 自动消失 */
let admToastTimer = null;
function toast(msg, isErr) {
  const el = $('#adm-toast');
  if (!el) { if (isErr) alert(msg); return; }
  el.textContent = msg;
  el.className = 'adm-toast on' + (isErr ? ' err' : '');
  clearTimeout(admToastTimer);
  admToastTimer = setTimeout(() => { el.className = 'adm-toast' + (isErr ? ' err' : ''); }, 2200);
}
function openSheet(sel) { const e = $(sel); if (e) e.hidden = false; }
function closeSheet(sel) { const e = $(sel); if (e) e.hidden = true; }

/* 吸顶的 tab 栏高度由 JS 实测:日期分组头贴它下沿(字体/安全区变化时也准)
 * 未登录时 #editor-area 是 hidden,量到的是 0 —— 所以登录后要再量一次(setAuthed) */
function syncTabH() {
  const t = document.querySelector('.adm-tabbar');
  if (!t) return;
  const h = t.offsetHeight;
  if (h > 0) document.body.style.setProperty('--tabh', h + 'px');
}

/* 管理条目状态:分页 */
let mgrState = { page: 1, size: '20' };
/* 批量操作:勾选集合(date|ts,跨页记忆)+ 是否处于「选择」模式 */
let mgrSel = new Set();
let mgrSelMode = false;
function mgrSelKey(date, ts) { return `${date}|${ts}`; }

/* 已渲染条目的索引(键 date|ts):动作表按条目键取数据,不依赖 DOM 位置 */
const entryIndex = new Map();
function indexEntries(list) { for (const e of list) entryIndex.set(mgrSelKey(e.date, entryTs(e)), e); }

function skeletonHtml(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += '<div class="adm-skel"><b></b><span></span></div>';
  return s;
}

function emptyHtml(icon, text, ctaText, ctaHref) {
  return `<div class="adm-empty"><i>${icon}</i><p>${esc(text)}</p>` +
    (ctaText ? `<a href="${ctaHref}">${esc(ctaText)}</a>` : '') + '</div>';
}

/* 日期分组头:显示周几 + 当天条数(卡片里不再重复日期) */
function dateHeadHtml(date, n) {
  const d = new Date(date + 'T00:00:00');
  const wd = Number.isNaN(d.getTime()) ? '' : '周' + '日一二三四五六'[d.getDay()];
  return `<div class="adm-date-head">${esc(date)}<em>${wd} · ${n} 条</em></div>`;
}

/* 一天一组:分组头吸顶靠「每组一个容器」实现 —— 所有头共享一个容器时它们会一起堆在顶部 */
function dateGroupHtml(date, items) {
  return `<section class="adm-group">${dateHeadHtml(date, items.length)}${items.map(mgrItemHtml).join('')}</section>`;
}

/* 条目卡:标题 / 时间 → 元信息(地点·专辑·可见性·作者)→ 正文摘要 → 缩略图
 * 主操作 = 点卡片(预览),次要操作收进右侧 ⋯ 动作表(不再每行堆四个按钮) */
function mgrItemHtml(e) {
  const ts = entryTs(e);
  const key = mgrSelKey(e.date, ts);
  const photos = e.photos || [];
  const thumbs = photos.slice(0, 3).map((p) => `<img src="${thumbUrl(p)}" data-full="${p}" alt="" loading="lazy">`).join('');
  const rest = photos.length - 3;
  const meta = [];
  if (e.location && e.location.name) meta.push(`📍 ${esc(shortLoc(e.location.name))}`);
  if (e.album) meta.push(`<span class="adm-tag album">${esc(e.album)}</span>`);
  if (e.visibility === 'private') meta.push('<span class="adm-tag priv">私有</span>');
  if (e.author) meta.push(`<span class="adm-tag author${e.author === '小红' ? ' rose' : ''}">${esc(e.author)}</span>`);
  // 没标题的条目(打卡/随手记很常见):拿正文首行当标题,信息量比「(无标题)」大得多
  const text = String(e.text || '');
  const nl = text.indexOf('\n');
  const hasTitle = !!e.title;
  const headText = hasTitle ? e.title : (nl > -1 ? text.slice(0, nl) : text);
  const restText = hasTitle ? text : (nl > -1 ? text.slice(nl + 1) : '');
  const headCls = hasTitle ? 'adm-item-title' : 'adm-item-title plain';
  return `<article class="adm-item${mgrSel.has(key) ? ' is-sel' : ''}" data-date="${esc(e.date)}" data-ts="${esc(ts)}">
    <label class="adm-check" title="选择"><input type="checkbox" data-date="${esc(e.date)}" data-ts="${esc(ts)}"${mgrSel.has(key) ? ' checked' : ''}></label>
    <div class="adm-item-body">
      <div class="adm-item-head">${headText ? `<span class="${headCls}">${esc(headText)}</span>` : '<span class="adm-item-title plain">(无内容)</span>'}<span class="adm-item-time">${fmtTime(ts)}</span></div>
      ${meta.length ? `<div class="adm-item-meta">${meta.join('<span class="adm-meta-sep">·</span>')}</div>` : ''}
      ${restText ? `<p class="adm-item-text">${esc(restText)}</p>` : ''}
      ${thumbs ? `<div class="adm-thumbs">${thumbs}${rest > 0 ? `<span class="adm-tag">+${rest}</span>` : ''}</div>` : ''}
    </div>
    <button type="button" class="adm-more-btn" data-more="1" aria-label="更多操作" title="更多操作">⋯</button>
  </article>`;
}


/* 管理条目列表:合并打卡/日记,支持起止日期过滤 + 每页条数 + 翻页 + 按日期分组
 * 卡片式行(标题/元信息/缩略图)+ 点行=预览 + ⋯=动作表,见 mgrItemHtml */
async function renderRecent() {
  const box = $('#mgr-list');
  if (!box) return;
  if (!box.dataset.ready) box.innerHTML = skeletonHtml(3); // 首屏骨架,避免白屏
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
    let all = (data.entries || [])
      .sort((a, b) => (a.date === b.date ? (a.created_at || '') > (b.created_at || '') ? -1 : 1 : a.date > b.date ? -1 : 1));
    indexEntries(all);
    // 起止日期过滤
    const from = $('#mgr-from').value;
    const to = $('#mgr-to').value;
    let filtered = all;
    if (from) filtered = filtered.filter((e) => e.date >= from);
    if (to) filtered = filtered.filter((e) => e.date <= to);
    // 计数(工具条右侧):总量 + 筛选后
    const countEl = $('#mgr-count');
    if (countEl) {
      countEl.textContent = from || to
        ? `筛选出 ${filtered.length} / ${all.length} 条`
        : `共 ${all.length} 条`;
    }
    // 分页
    const total = filtered.length;
    const sizeRaw = mgrState.size;
    const size = sizeRaw === 'all' ? Math.max(total, 1) : Number(sizeRaw);
    const pages = size > 0 ? Math.max(1, Math.ceil(total / size)) : 1;
    if (mgrState.page > pages) mgrState.page = pages;
    if (mgrState.page < 1) mgrState.page = 1;
    const pageItems = sizeRaw === 'all' ? filtered : filtered.slice((mgrState.page - 1) * size, mgrState.page * size);
    // 按日期分组(倒序)
    const byDate = {};
    for (const e of pageItems) (byDate[e.date] = byDate[e.date] || []).push(e);
    const grouped = Object.keys(byDate).sort().reverse().map((date) => ({ date, items: byDate[date] }));
    box.innerHTML = grouped.length
      ? grouped.map((g) => dateGroupHtml(g.date, g.items)).join('')
      : (all.length
        ? emptyHtml('🔍', '没有符合筛选条件的条目', '清除筛选', '#')
        : emptyHtml('🗺️', '还没有日记,写第一篇吧', '✏️ 写日记', 'edit.html'));
    box.dataset.ready = '1';
    // 空态里的「清除筛选」:一键还原时间区间
    const clearCta = box.querySelector('.adm-empty a[href="#"]');
    if (clearCta) clearCta.addEventListener('click', (ev) => { ev.preventDefault(); resetFilters(); });
    // 批量勾选(跨页记忆)与「全选」状态同步
    updateSelAllState();
    updateBatchBar();
    // 分页:只有一页时整条隐藏,少一行噪音
    const pager = $('#mgr-pager');
    if (pager) pager.hidden = pages <= 1;
    const pageEl = $('#mgr-page');
    if (pageEl) pageEl.textContent = `${mgrState.page} / ${pages}`;
    const prevBtn = $('#mgr-prev');
    const nextBtn = $('#mgr-next');
    if (prevBtn) prevBtn.disabled = mgrState.page <= 1;
    if (nextBtn) nextBtn.disabled = mgrState.page >= pages;
  } catch {
    box.innerHTML = emptyHtml('⚠️', '加载失败,下拉刷新试试');
  }
}

/* ---------- 筛选:快捷区间 / chips / 弹层 ---------- */
function dateStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function setRange(from, to) {
  const f = $('#mgr-from');
  const t = $('#mgr-to');
  if (f) f.value = from;
  if (t) t.value = to;
  mgrState.page = 1;
  renderRecent();
  renderFilterChips();
}
function resetFilters() {
  setRange('', '');
  applyQuickState();
}
function activeRangeKey() {
  const from = $('#mgr-from').value;
  const to = $('#mgr-to').value;
  const today = localToday();
  if (!from && !to) return 'all';
  if (from === today && to === today) return 'today';
  const now = new Date();
  const d7 = new Date(now.getTime() - 6 * 86400000);
  if (from === dateStr(d7) && to === today) return '7d';
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  if (from === dateStr(first) && to === today) return 'month';
  return '';
}
function applyQuickState() {
  const key = activeRangeKey();
  document.querySelectorAll('#fs-quick button').forEach((b) => b.classList.toggle('on', b.dataset.range === key));
}
/* 生效中的筛选条件:工具条角标 + 可点掉的 chips(不用打开弹层就知道现在筛了什么) */
function renderFilterChips() {
  const from = $('#mgr-from').value;
  const to = $('#mgr-to').value;
  const n = (from ? 1 : 0) + (to ? 1 : 0);
  const badge = $('#mgr-filter-badge');
  if (badge) { badge.hidden = n === 0; badge.textContent = n; }
  const btn = $('#mgr-filter-btn');
  if (btn) btn.classList.toggle('is-on', n > 0);
  const box = $('#mgr-active-filters');
  if (box) {
    box.hidden = n === 0;
    const parts = [];
    if (from) parts.push(`<button type="button" class="adm-chip" data-clear="from"><span>从 ${esc(from)}</span><i>✕</i></button>`);
    if (to) parts.push(`<button type="button" class="adm-chip" data-clear="to"><span>到 ${esc(to)}</span><i>✕</i></button>`);
    box.innerHTML = parts.join('');
  }
  applyQuickState();
}

/* ---------- 选择模式(上下文操作栏)---------- */
function setSelMode(on) {
  mgrSelMode = !!on;
  const btn = $('#mgr-selmode-btn');
  if (btn) {
    btn.classList.toggle('is-on', mgrSelMode);
    btn.textContent = mgrSelMode ? '完成' : '选择';
  }
  const list = $('#mgr-list');
  if (list) list.classList.toggle('sel-mode', mgrSelMode);
  if (!mgrSelMode) {
    // 退出选择模式即清空选择:避免「看不见但已选中」导致误操作
    mgrSel.clear();
    const sa = $('#mgr-select-all');
    if (sa) { sa.checked = false; sa.indeterminate = false; }
    applySelToDom();
  }
  updateBatchBar();
}
/* 把 mgrSel 状态回写到列表 DOM(不重渲整列表) */
function applySelToDom() {
  document.querySelectorAll('#mgr-list .adm-check input, #stream .adm-check input').forEach((cb) => {
    const k = mgrSelKey(cb.dataset.date, cb.dataset.ts);
    cb.checked = mgrSel.has(k);
    const item = cb.closest('.adm-item');
    if (item) item.classList.toggle('is-sel', mgrSel.has(k));
  });
}

/* ---------- 条目动作表(点卡片上的 ⋯)---------- */
let esKey = '';
let esBulk = false; // 从批量选择栏打开动作表(改可见性作用于整批)时为 true,这里始终单条
function openEntrySheet(date, ts) {
  const e = entryIndex.get(mgrSelKey(date, ts));
  esKey = mgrSelKey(date, ts);
  const title = $('#es-title');
  const sub = $('#es-sub');
  const visLabel = $('#es-vis-label');
  if (title) title.textContent = (e && e.title) ? e.title : `${date} ${fmtTime(ts) || ''}`.trim();
  if (sub) {
    const bits = [];
    if (e && e.album) bits.push(`专辑 ${e.album}`);
    if (e && e.author) bits.push(e.author);
    bits.push(e && e.visibility === 'private' ? '当前私有' : '当前公开');
    sub.textContent = bits.join(' · ');
  }
  if (visLabel) visLabel.textContent = e && e.visibility === 'private' ? '设为公开' : '设为私有';
  openSheet('#entry-sheet');
}
function closeEntrySheet() { closeSheet('#entry-sheet'); esKey = ''; }

/* ---------- 条目基本操作(动作表 / 列表共用同一套实现)---------- */
async function fetchEntry(date, ts) {
  try {
    const data = await (await fetch(`/api/entries?date=${date}`)).json();
    return (data.entries || []).find((x) => String(x.ts) === String(ts)) || null;
  } catch { return null; }
}
async function editEntry(date, ts) {
  const e = entryIndex.get(mgrSelKey(date, ts)) || await fetchEntry(date, ts);
  if (!e) return toast('条目不存在', true);
  EntryModal.open({ date, entry: e, onSaved: () => { renderRecent(); syncAlbumView(); } });
}
async function setEntryVisibility(date, ts, vis) {
  const fd = new FormData();
  fd.append('date', date);
  fd.append('ts', ts);
  fd.append('visibility', vis);
  try {
    const res = await (await fetch('/api/update', { method: 'POST', body: fd })).json();
    if (res.ok) {
      toast(vis === 'private' ? '已设为私有 🔒' : '已设为公开 🌐');
      renderRecent();
      syncAlbumView();
    } else toast(res.error || '切换失败', true);
  } catch { toast('网络异常,请重试', true); }
}

/* 列表点击委托(列表会整块重渲,委托避免绑定丢失)
 * 非选择模式:点卡片 = 预览,点 ⋯ = 动作表
 * 选择模式:点卡片 = 勾选/取消 */
function onItemClick(e) {
  const item = e.target.closest('.adm-item');
  if (!item) return;
  const { date, ts } = item.dataset;
  if (e.target.closest('.adm-more-btn')) { openEntrySheet(date, ts); return; }
  if (e.target.closest('.adm-check')) return; // 勾选框交给 change 事件
  if (mgrSelMode) {
    const k = mgrSelKey(date, ts);
    if (mgrSel.has(k)) mgrSel.delete(k); else mgrSel.add(k);
    applySelToDom();
    updateSelAllState();
    updateBatchBar();
    return;
  }
  openPreview(date, ts);
}
function onItemChange(e) {
  const cb = e.target.closest('.adm-check input');
  if (!cb) return;
  const k = mgrSelKey(cb.dataset.date, cb.dataset.ts);
  if (cb.checked) mgrSel.add(k); else mgrSel.delete(k);
  applySelToDom();
  updateSelAllState();
  updateBatchBar();
}

/* 管理条目工具行绑定(一次性) */
function initMgrTools() {
  syncTabH();
  window.addEventListener('resize', syncTabH);
  window.addEventListener('load', syncTabH);

  // 列表事件委托
  const list = $('#mgr-list');
  if (list) {
    list.addEventListener('click', onItemClick);
    list.addEventListener('change', onItemChange);
  }
  const stream = $('#stream');
  if (stream) {
    stream.addEventListener('click', onItemClick);
    stream.addEventListener('change', onItemChange);
  }

  // 日期/每页变化:立即生效(轻量筛选,自动应用)
  const from = $('#mgr-from');
  const to = $('#mgr-to');
  const size = $('#mgr-size');
  if (from) from.addEventListener('change', () => { mgrState.page = 1; renderRecent(); renderFilterChips(); });
  if (to) to.addEventListener('change', () => { mgrState.page = 1; renderRecent(); renderFilterChips(); });
  if (size) size.addEventListener('change', () => { mgrState.size = size.value; mgrState.page = 1; renderRecent(); });

  // 翻页(带回到列表顶部,手机上不用手滑回去)
  const prev = $('#mgr-prev');
  const next = $('#mgr-next');
  const gotoPage = (p) => {
    mgrState.page = p;
    renderRecent().then(() => {
      const box = $('#mgr-list');
      if (box) window.scrollTo({ top: Math.max(0, box.getBoundingClientRect().top + window.scrollY - 110), behavior: 'smooth' });
    });
  };
  if (prev) prev.addEventListener('click', () => { if (mgrState.page > 1) gotoPage(mgrState.page - 1); });
  if (next) next.addEventListener('click', () => gotoPage(mgrState.page + 1));

  initFilterSheet();
  initEntrySheet();
  initSelBar();

  const wxDate = $('#wx-date');
  if (wxDate) wxDate.value = localToday(); // 微信推送默认今天

  // 批量选专辑弹层
  const bam = $('#batch-album-modal');
  if (bam) bam.addEventListener('click', (e) => { if (e.target === bam) closeBatchAlbumModal(); });
  const bamClose = $('#btn-batch-album-close');
  if (bamClose) bamClose.addEventListener('click', closeBatchAlbumModal);
  const bamUnset = $('#btn-batch-album-unset');
  if (bamUnset) bamUnset.addEventListener('click', () => applyBatchAlbum(''));
  const bamNew = $('#btn-batch-album-new');
  if (bamNew) bamNew.addEventListener('click', () => applyBatchAlbum($('#batch-album-new').value.trim()));
  const bamNewInput = $('#batch-album-new');
  if (bamNewInput) bamNewInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyBatchAlbum(bamNewInput.value.trim()); }
  });
  renderFilterChips();
}

/* 筛选弹层:快捷区间 + 起止日期 + 每页条数 */
function initFilterSheet() {
  const open = $('#mgr-filter-btn');
  if (open) open.addEventListener('click', () => { renderFilterChips(); openSheet('#filter-sheet'); });
  const close = $('#fs-close');
  if (close) close.addEventListener('click', () => closeSheet('#filter-sheet'));
  const sheet = $('#filter-sheet');
  if (sheet) sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet('#filter-sheet'); });
  const quick = $('#fs-quick');
  if (quick) quick.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-range]');
    if (!b) return;
    const today = localToday();
    const now = new Date();
    if (b.dataset.range === 'all') resetFilters();
    else if (b.dataset.range === 'today') setRange(today, today);
    else if (b.dataset.range === '7d') setRange(dateStr(new Date(now.getTime() - 6 * 86400000)), today);
    else if (b.dataset.range === 'month') setRange(dateStr(new Date(now.getFullYear(), now.getMonth(), 1)), today);
    closeSheet('#filter-sheet');
  });
  const apply = $('#fs-apply');
  if (apply) apply.addEventListener('click', () => { renderRecent(); renderFilterChips(); closeSheet('#filter-sheet'); });
  const reset = $('#fs-reset');
  if (reset) reset.addEventListener('click', () => resetFilters());
  // 已生效条件的 chips:点掉即取消该条
  const chips = $('#mgr-active-filters');
  if (chips) chips.addEventListener('click', (e) => {
    const b = e.target.closest('.adm-chip');
    if (!b) return;
    const el = $(b.dataset.clear === 'from' ? '#mgr-from' : '#mgr-to');
    if (el) el.value = '';
    mgrState.page = 1;
    renderRecent();
    renderFilterChips();
  });
}

/* 条目动作表 */
function initEntrySheet() {
  const sheet = $('#entry-sheet');
  if (!sheet) return;
  const close = $('#es-close');
  if (close) close.addEventListener('click', closeEntrySheet);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) closeEntrySheet(); });
  sheet.addEventListener('click', async (e) => {
    const b = e.target.closest('.adm-sheet-actions button');
    if (!b) return;
    const key = esKey;
    if (!key) return;
    const i = key.indexOf('|');
    const date = key.slice(0, i);
    const ts = key.slice(i + 1);
    const e0 = entryIndex.get(key) || {};
    closeEntrySheet();
    if (b.dataset.act === 'preview') openPreview(date, ts);
    else if (b.dataset.act === 'edit') editEntry(date, ts);
    else if (b.dataset.act === 'vis') setEntryVisibility(date, ts, e0.visibility === 'private' ? 'public' : 'private');
    else if (b.dataset.act === 'album') {
      bamFromSheet = true;
      mgrSel.clear();
      mgrSel.add(key);
      openBatchAlbumModal();
    } else if (b.dataset.act === 'del') askDelete({ dataset: { date, ts } });
  });
}

/* 底部上下文操作栏 */
function initSelBar() {
  const selAll = $('#mgr-select-all');
  if (selAll) selAll.addEventListener('change', () => {
    const checked = selAll.checked;
    document.querySelectorAll('#mgr-list .adm-check input').forEach((cb) => {
      const k = mgrSelKey(cb.dataset.date, cb.dataset.ts);
      if (checked) mgrSel.add(k); else mgrSel.delete(k);
    });
    applySelToDom();
    updateBatchBar();
  });
  const modeBtn = $('#mgr-selmode-btn');
  if (modeBtn) modeBtn.addEventListener('click', () => setSelMode(!mgrSelMode));
  const batchBtn = $('#btn-batch-album');
  if (batchBtn) batchBtn.addEventListener('click', openBatchAlbumModal);
  const batchClear = $('#btn-batch-clear');
  if (batchClear) batchClear.addEventListener('click', () => {
    mgrSel.clear();
    const sa = $('#mgr-select-all');
    if (sa) { sa.checked = false; sa.indeterminate = false; }
    applySelToDom();
    updateBatchBar();
  });
}

/* ---- 管理条目批量操作:勾选 → 一键选专辑(或新建) ---- */
function updateBatchBar() {
  const bar = $('#mgr-batch-bar');
  const count = $('#mgr-sel-count');
  const has = mgrSel.size > 0;
  if (bar) bar.hidden = !has;
  if (count) count.textContent = `已选 ${mgrSel.size} 条`;
  // 底部操作栏浮出时让 FAB 暂时隐藏,避免两个浮动元素叠在一起
  document.body.classList.toggle('has-selbar', has);
}

function updateSelAllState() {
  const selAll = $('#mgr-select-all');
  const box = $('#mgr-list');
  if (!selAll || !box) return;
  const cbs = box.querySelectorAll('.adm-check input');
  const anyChecked = [...cbs].some((cb) => cb.checked);
  const allChecked = cbs.length > 0 && [...cbs].every((cb) => cb.checked);
  selAll.checked = allChecked;
  selAll.indeterminate = anyChecked && !allChecked;
}

/* 标记本次批量专辑弹层是从单条动作表打开的(与「选择」模式的多选区分) */
let bamFromSheet = false;

function closeBatchAlbumModal() {
  const m = $('#batch-album-modal');
  if (m) m.hidden = true;
  const st = $('#batch-album-status');
  if (st) st.className = 'form-status';
  // 从条目动作表(⋯ → 归入专辑)进来的:关闭即清掉这次临时勾选,否则底部会留一条「已选 1 条」
  if (bamFromSheet) { bamFromSheet = false; mgrSel.clear(); applySelToDom(); updateBatchBar(); }
}

async function openBatchAlbumModal() {
  if (mgrSel.size === 0) return toast('请先勾选要归入专辑的条目', true);
  const box = $('#batch-album-list');
  const hint = $('#batch-album-hint');
  if (hint) hint.textContent = `已选 ${mgrSel.size} 条,点一个专辑一键归入;也可以新建`;
  if (box) {
    box.innerHTML = '<p class="empty">加载中…</p>';
    try {
      const data = await (await fetch('/api/albums')).json();
      const albums = (data.albums || []).map((a) => a.album);
      box.innerHTML = albums.length
        ? albums.map((a) => `<button type="button" class="btn-small batch-album-item" data-album="${esc(a)}">${esc(a)}</button>`).join('')
        : '<p class="empty">还没有专辑,直接输入名字新建</p>';
      box.querySelectorAll('.batch-album-item').forEach((b) => b.addEventListener('click', () => applyBatchAlbum(b.dataset.album)));
    } catch {
      box.innerHTML = '<p class="empty">专辑加载失败,可直接输入名字新建</p>';
    }
  }
  const ni = $('#batch-album-new');
  if (ni) ni.value = '';
  const st = $('#batch-album-status');
  if (st) { st.className = 'form-status'; st.textContent = ''; }
  const m = $('#batch-album-modal');
  if (m) m.hidden = false;
}

/* 把已勾选条目批量设为 album(空串 = 不设专辑/未分类) */
async function applyBatchAlbum(album) {
  const st = $('#batch-album-status');
  if (st) { st.className = 'form-status'; st.textContent = '设置中…'; }
  const items = [...mgrSel].map((k) => {
    const i = k.indexOf('|');
    return { date: k.slice(0, i), ts: k.slice(i + 1) };
  });
  try {
    const res = await (await fetch('/api/albums', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'set_album', album, items }),
    })).json();
    if (!res.ok) {
      if (st) { st.className = 'form-status error'; st.textContent = res.error || '设置失败'; }
      return;
    }
    const n = res.count;
    mgrSel.clear();
    const sa = $('#mgr-select-all');
    if (sa) { sa.checked = false; sa.indeterminate = false; }
    closeBatchAlbumModal();
    setSelMode(false); // 操作完成 → 退出选择模式
    syncAlbumView();
    renderAlbums();
    renderRecent();
    toast(`已把 ${n} 条设为${album ? `专辑「${album}」` : '不设专辑'}`);
  } catch {
    if (st) { st.className = 'form-status error'; st.textContent = '网络异常,请重试'; }
  }
}

/* ---- 专辑管理 ---- */
async function renderAlbums() {
  const box = $('#album-mgr-list');
  if (!box) return;
  try {
    const data = await (await fetch('/api/albums')).json();
    const list = data.albums || [];
    if (!list.length && !(data.uncategorized && data.uncategorized.count > 0)) {
      box.innerHTML = emptyHtml('📁', '还没有专辑,在「写日记」里给条目设个专辑就会出现在这里', '✏️ 写日记', 'edit.html');
      return;
    }
    // 可见性按钮:全私密 → 全部改公开,否则 → 全部改私密
    // 布局:标题行(标题 + ›)在上,元信息(条数 · 可见性)在下 → 长专辑名不再被挤成省略号
    const rowHtml = (name, count, priv, display) => {
      const allPriv = priv === count && count > 0;
      const visTarget = allPriv ? 'public' : 'private';
      const visLabel = allPriv ? '全部改公开' : '全部改私密';
      const visText = count === 0 ? '空' : allPriv ? '含私密' : priv > 0 ? `含私密 ${priv}` : '全公开';
      return `
      <div class="album-mgr-item">
        <button type="button" class="album-mgr-name" data-album="${esc(name)}" title="查看该专辑的条目与地图">
          <span class="album-mgr-row1"><span class="album-mgr-title">${esc(display)}</span><i class="album-mgr-chev" aria-hidden="true">›</i></span>
          <span class="album-mgr-meta">${count} 条 · ${visText}</span>
        </button>
        <span class="album-mgr-actions">
          ${display === '未分类' ? '' : `<button type="button" class="btn-album-rename" data-album="${esc(name)}" title="改名" aria-label="改名"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>`}
          <button type="button" class="btn-small btn-album-vis" data-album="${esc(name)}" data-vis="${visTarget}" title="把该专辑下全部条目设为${visTarget === 'private' ? '私密' : '公开'}">${visLabel}</button>
        </span>
      </div>`;
    };
    let html = list.map((a) => rowHtml(a.album, a.count, a.privateCount || 0, a.album)).join('');
    // 未分类(无专辑条目):只支持一键可见性,无改名(没有 album 字段可改)
    if (data.uncategorized && data.uncategorized.count > 0) {
      html += rowHtml('', data.uncategorized.count, data.uncategorized.privateCount || 0, '未分类');
    }
    box.innerHTML = html;
    box.querySelectorAll('.btn-album-rename').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); renameAlbum(b.dataset.album); }));
    box.querySelectorAll('.btn-album-vis').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); setAlbumVisibility(b.dataset.album, b.dataset.vis); }));
    // 点专辑名 → 展开该专辑的条目流 + 打卡地图(专辑查看合入专辑管理)
    box.querySelectorAll('.album-mgr-name').forEach((b) => b.addEventListener('click', () => showAlbumView(b.dataset.album)));
  } catch { box.innerHTML = emptyHtml('⚠️', '专辑加载失败,下拉刷新试试'); }
}

/* 点专辑名 → 展开专辑查看(条目流 + 地图,复用 renderAlbumView) */
function showAlbumView(album) {
  mgrActiveAlbum = album;
  const vbox = $('#album-view-box');
  if (vbox) vbox.hidden = false;
  renderAlbumChips();
  renderAlbumView();
  if (vbox) window.scrollTo({ top: Math.max(0, vbox.getBoundingClientRect().top + window.scrollY - 110), behavior: 'smooth' });
}

/* 专辑查看「返回」:收起详情回到专辑列表 */
function closeAlbumView() {
  mgrActiveAlbum = null;
  const vbox = $('#album-view-box');
  if (vbox) vbox.hidden = true;
  renderAlbumChips();
}

async function renameAlbum(oldName) {
  const newName = prompt(`专辑「${oldName}」改名为:`, oldName);
  if (newName == null) return;
  const n = newName.trim();
  if (!n || n === oldName) return;
  if (n.length > 50) return toast('专辑名最多 50 字', true);
  try {
    const res = await (await fetch('/api/albums', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'rename', old: oldName, new: n }) })).json();
    if (res.ok) {
      renderAlbums();
      renderRecent();
      syncAlbumView();
      toast(`已改名,${res.count} 条条目同步更新`);
    } else toast(res.error || '改名失败', true);
  } catch { toast('网络异常,请重试', true); }
}

async function setAlbumVisibility(album, vis) {
  const label = vis === 'private' ? '私密' : '公开';
  const albumLabel = album ? `「${album}」` : '「未分类」';
  if (!confirm(`把${albumLabel}下所有条目设为${label}?`)) return;
  try {
    const res = await (await fetch('/api/albums', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'visibility', album, vis }) })).json();
    if (res.ok) {
      renderAlbums();
      renderRecent();
      syncAlbumView();
      toast(`已设置,${res.count} 条条目更新为${label}`);
    } else toast(res.error || '设置失败', true);
  } catch { toast('网络异常,请重试', true); }
}

/* ---- 预览(只读弹层,portal 同款卡片) ---- */
async function openPreview(date, ts) {
  const data = await (await fetch(`/api/entries?date=${date}`)).json();
  const e = (data.entries || []).find((x) => String(x.ts) === String(ts));
  if (!e) return toast('条目不存在', true);
  $('#preview-body').innerHTML = `<div class="preview-date">${esc(e.date)}</div>` + entryCardHtml(e);
  $('#preview-modal').hidden = false;
  bindPhotoGridFallback($('#preview-body'));
  // 点照片看大图:走共享 lightbox(点任意处/Esc 关),不再新开标签页 ——
  // 管理页没有 app.js,以前这里只能 new window,且页面里的 #lightbox 没人绑关闭
  $('#preview-body').querySelectorAll('.photo-grid img').forEach((img) => {
    img.addEventListener('click', () => {
      const src = img.dataset.full || img.src;
      if (window.MapCommon && MapCommon.openLightbox) MapCommon.openLightbox(src);
      else window.open(src, '_blank');
    });
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
    return toast(data.error || `删除失败(HTTP ${res.status})`, true);
  }
  toast('已删除 🗑');
  renderRecent();
  syncAlbumView();
}

/* ---- 专辑查看(从首页移入管理页):专辑 chips + 打卡地图 + 条目流 ---- */
let mgrAllEntries = [];   // 全部条目缓存(专辑查看用)
let mgrActiveAlbum = null;

async function refreshAllEntries() {
  try {
    const data = await (await fetch('/api/entries')).json();
    mgrAllEntries = data.entries || [];
  } catch { /* 保留旧数据 */ }
}

/* 条目变更后同步专辑查看(重拉 + 重渲染 chips/流/地图) */
function syncAlbumView() {
  refreshAllEntries().then(() => {
    renderAlbumChips();
    renderAlbumView();
  });
}

async function renderAlbumChips() {
  const chips = $('#album-chips');
  if (!chips) return;
  // 专辑清单以服务端 /api/albums 为准(它按 SQL 统计,完整);拉不到(未登录/离线)再退回本地条目缓存
  let albums = [...new Set(mgrAllEntries.map((e) => e.album).filter(Boolean))];
  let hasUncat = mgrAllEntries.some((e) => !e.album);
  try {
    const data = await (await fetch('/api/albums')).json();
    if (data && Array.isArray(data.albums)) albums = data.albums.map((a) => a.album);
    if (data && data.uncategorized) hasUncat = data.uncategorized.count > 0;
  } catch { /* 保持本地缓存那份 */ }
  chips.innerHTML = '';
  const mk = (label, album) => {
    const b = document.createElement('button');
    b.className = 'chip' + (mgrActiveAlbum === album ? ' active' : '');
    b.textContent = label;
    // 反选:再点已选中的专辑 → 收起详情(置空回占位态)
    b.addEventListener('click', () => {
      mgrActiveAlbum = mgrActiveAlbum === album ? null : album;
      renderAlbumChips();
      renderAlbumView();
    });
    chips.appendChild(b);
  };
  for (const a of albums) mk(a, a);
  if (hasUncat) mk('未分类', '');
}

/* 按专辑取条目:一律走服务端 ?album=(SQL 过滤),不要从 mgrAllEntries 里筛 ——
 * 全量接口有条数上限,老专辑(如「长沙2026」)会被截掉,表现为「这个专辑还没有条目」(2026-09-17 用户报) */
async function fetchAlbumEntries(album) {
  try {
    const data = await (await fetch(`/api/entries?album=${encodeURIComponent(album)}`)).json();
    return data.entries || [];
  } catch { return []; }
}

async function renderAlbumView() {
  const stream = $('#stream');
  const mapBox = $('#album-map');
  if (!stream || !mapBox) return;
  const vbox = $('#album-view-box');
  if (vbox && vbox.hidden) return; // 专辑查看未展开(展开时 showAlbumView 会重渲,避免在隐藏容器里初始化地图)
  const shareBtn = $('#btn-album-share');
  if (shareBtn) {
    shareBtn.hidden = !mgrActiveAlbum;
    if (mgrActiveAlbum) shareBtn.href = '/export?album=' + encodeURIComponent(mgrActiveAlbum);
  }
  const title = $('#stream-title');
  // 注意用 == null 而不是 !mgrActiveAlbum:未分类的专辑名就是空串 ''(falsy),
  // 原来写成 !mgrActiveAlbum 会让「未分类」永远停在占位文案(顺手修)
  if (mgrActiveAlbum == null) {
    if (title) title.textContent = '专辑';
    stream.innerHTML = `<p class="empty">${mgrAllEntries.length ? '选择一个专辑查看' : '还没有日记 ✏️'}</p>`;
    mapBox.style.display = 'none';
    return;
  }
  if (title) title.textContent = mgrActiveAlbum === '' ? '未分类' : mgrActiveAlbum;
  // 条目从服务端按专辑现取(SQL 过滤,完整),不再从本地缓存筛 —— 见 fetchAlbumEntries 注释
  const album = mgrActiveAlbum;
  let list = await fetchAlbumEntries(album);
  if (mgrActiveAlbum !== album) return; // 取数期间又切了别的专辑 → 让新的那次渲染说了算
  indexEntries(list);
  list = [...list].sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? -1 : 1)); // 专辑内正序
  const byDate = {};
  for (const e of list.slice(0, 60)) (byDate[e.date] = byDate[e.date] || []).push(e);
  const grouped = Object.keys(byDate).sort().reverse().map((d) => ({ date: d, items: byDate[d] }));
  stream.innerHTML = grouped.length
    ? grouped.map((g) => dateGroupHtml(g.date, g.items)).join('')
    : emptyHtml('📭', '这个专辑还没有条目');
  // 条目操作(预览/编辑/删除/可见性)统一走 #stream 上的事件委托,见 initMgrTools
  // 打卡地图(复用 map-common)
  await MapCommon.renderCheckinMap(mapBox, list, { containerId: 'album-map' });
}
/* ---- 已分享的快照管理(列表 / 复制 / 打开 / 更新 / 删除) ---- */
function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function shareCond(s) {
  const parts = [];
  if (s.album) parts.push(`专辑 · ${s.album}`);
  if (s.from && s.to) parts.push(`${s.from} ~ ${s.to}`);
  return parts.join(' ');
}

async function renderShares() {
  const box = $('#share-list');
  if (!box) return;
  try {
    const res = await fetch('/api/shares');
    if (res.status === 401) { bounceOn401(res); return; }
    const data = await res.json().catch(() => ({}));
    const list = data.shares || [];
    if (!list.length) {
      box.innerHTML = emptyHtml('🔗', '还没有分享过快照,去「导出」生成一个', '去导出', '#');
      const cta = box.querySelector('.adm-empty a');
      if (cta) cta.addEventListener('click', (ev) => { ev.preventDefault(); switchManageTab('export'); });
      return;
    }
    box.innerHTML = list.map((s) => `<div class="recent-item adm-share-item">
        <span class="recent-info">
          <b>${esc(shareCond(s) || '全部内容')}</b>
          <em>更新于 ${esc(fmtDateTime(s.updated_at))}</em>
        </span>
        <span class="recent-actions">
          <button type="button" class="btn-small btn-share-show" data-url="${esc(s.url)}">分享</button>
          <button type="button" class="btn-small btn-share-update" data-token="${esc(s.token)}" data-album="${esc(s.album || '')}" data-from="${esc(s.from || '')}" data-to="${esc(s.to || '')}">更新</button>
          <button type="button" class="btn-small btn-share-del" data-token="${esc(s.token)}">删除</button>
        </span>
      </div>`).join('');
    box.querySelectorAll('.btn-share-show').forEach((b) => b.addEventListener('click', () => showShareQr(b.dataset.url)));
    box.querySelectorAll('.btn-share-update').forEach((b) => b.addEventListener('click', () => updateShare(b.dataset)));
    box.querySelectorAll('.btn-share-del').forEach((b) => b.addEventListener('click', () => deleteShare(b.dataset.token)));
  } catch { /* 忽略 */ }
}

/* 「更新」→ 重新进入「生成分享页」,预填该快照条件与已导出内容,重新选择后保存(链接不变) */
async function updateShare(d) {
  if (!confirm('进入生成分享页重新选择导出内容?\n保存后链接和二维码不变。')) return;
  const q = new URLSearchParams();
  q.set('token', d.token);
  if (d.album) q.set('album', d.album);
  if (d.from) q.set('from', d.from);
  if (d.to) q.set('to', d.to);
  location.href = `/export?${q.toString()}`;
}

async function deleteShare(token) {
  if (!confirm('删除这个快照后,链接将立即失效,无法恢复。确定删除?')) return;
  try {
    const res = await fetch(`/api/share?token=${encodeURIComponent(token)}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { bounceOn401(res); return toast(data.error || `删除失败(HTTP ${res.status})`, true); }
    toast('快照已删除,链接立即失效');
    renderShares();
  } catch { toast('网络异常,请重试', true); }
}

/* ---- 分享二维码弹层(重新显示某条快照的二维码) ---- */
let shareQrLoaded = null;
let shareQrCanvas = null;
function loadQrLib() {
  if (!shareQrLoaded) {
    shareQrLoaded = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/qrious@4.0.2/dist/qrious.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('二维码库加载失败'));
      document.head.appendChild(s);
    });
  }
  return shareQrLoaded;
}

let shareQrFullUrl = '';
function showShareQr(url) {
  const box = $('#share-qr-modal');
  const link = $('#share-qr-link');
  const qrBox = $('#share-qr-box');
  const st = $('#share-qr-status');
  if (!box || !link) return;
  shareQrFullUrl = window.SITE_ORIGIN + url;
  link.value = shareQrFullUrl;
  st.textContent = '';
  box.hidden = false;
  qrBox.innerHTML = '';
  loadQrLib().then(() => {
    const canvas = document.createElement('canvas');
    new QRious({ element: canvas, value: shareQrFullUrl, size: 180 });
    shareQrCanvas = canvas;
    qrBox.appendChild(canvas);
  }).catch(() => {
    shareQrCanvas = null;
    qrBox.innerHTML = '<p class="empty">二维码生成失败,直接复制链接分享</p>';
  });
}

$('#btn-share-qr-copy').addEventListener('click', async () => {
  const st = $('#share-qr-status');
  try {
    await navigator.clipboard.writeText(shareQrFullUrl);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = shareQrFullUrl;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  st.textContent = '链接已复制 ✅';
});

$('#btn-share-qr-open').addEventListener('click', () => {
  if (shareQrFullUrl) window.open(shareQrFullUrl, '_blank');
});

$('#btn-share-qr-save').addEventListener('click', () => {
  const st = $('#share-qr-status');
  if (!shareQrCanvas) { st.textContent = '二维码还没生成,请稍等'; return; }
  const a = document.createElement('a');
  a.href = shareQrCanvas.toDataURL('image/png');
  a.download = 'gugugaga-share-qr.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
  st.textContent = '二维码已保存 ✅';
});

$('#btn-share-qr-close').addEventListener('click', () => { $('#share-qr-modal').hidden = true; });

/* ---- 导出行程(按专辑 / 按起止日期 / 叠加) ---- */
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

/* ---- 微信推送(把当天公开动态推到 WxPusher) ---- */
$('#btn-wx-push').addEventListener('click', async () => {
  const st = $('#wx-status');
  const btn = $('#btn-wx-push');
  const date = $('#wx-date').value || localToday();
  st.className = 'form-status';
  st.textContent = '推送中…';
  btn.disabled = true;
  try {
    const res = await fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date }),
    });
    if (res.status === 401) { bounceOn401(res); return; }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { st.className = 'form-status error'; st.textContent = data.error || `推送失败(HTTP ${res.status})`; return; }
    st.textContent = data.message || '已推送 ✅';
  } catch {
    st.className = 'form-status error';
    st.textContent = '网络异常,请重试';
  } finally {
    btn.disabled = false;
  }
});
/* 管理页 Tab(分段式;吸顶,窄屏可横滑) */
function switchManageTab(tab) {
  document.querySelectorAll('#manage-tabs .tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  document.querySelectorAll('#editor-area .tab-pane').forEach((p) => {
    p.hidden = p.id !== 'tab-' + tab;
  });
  // 每个 tab 都是独立任务:切换后回到顶部,不让用户自己找位置
  window.scrollTo({ top: 0, behavior: 'auto' });
  // 写日记 FAB 只在「条目 / 专辑」两个内容区出现(导出/快照/推送用不上,免得挡住按钮)
  const fab = $('#btn-write');
  if (fab) fab.hidden = tab !== 'manage' && tab !== 'album-mgr';
  const bar = $('#manage-tabs');
  if (bar) {
    const active = bar.querySelector('.tab-btn.active');
    if (active) active.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
  }
}
function initManageTabs() {
  const bar = $('#manage-tabs');
  if (!bar) return;
  bar.addEventListener('click', (e) => {
    const b = e.target.closest('.tab-btn');
    if (b && !b.hidden) switchManageTab(b.dataset.tab);
  });
  const back = $('#btn-album-back');
  if (back) back.addEventListener('click', closeAlbumView);
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function localToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
/* 管理页初始化 */
initMgrTools(); // 管理条目工具行(日期过滤/每页条数/翻页),静态元素,页面加载即绑定
initManageTabs(); // 管理区 Tab(默认管理条目)
initAuth();
renderRecent();
