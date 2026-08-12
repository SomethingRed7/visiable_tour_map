/* 咕咕嘎嘎 - 旅行日记 portal */
'use strict';

const $ = (s) => document.querySelector(s);

let allEntries = [];
let currentMonth = null;   // 'YYYY-MM'
let selectedDate = null;
let activeAlbum = null;
let currentUser = null;    // 登录用户;null=未登录(待办完全不可见)
let allTodos = [];         // 私有待办(仅登录后拉取)
// 暂不显示「最近动态」流:默认只保留专辑入口;true = 恢复(含「全部」chip)
const SHOW_RECENT_FEED = false;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function thumbUrl(p) {
  return p.replace(/\.(jpg|jpeg|png)$/i, '-thumb.$1');
}

function photoGridHtml(photos, altPrefix) {
  if (!photos || photos.length === 0) return '';
  const imgs = photos
    .map((p, i) => `<img src="${thumbUrl(p)}" data-full="${p}" alt="${altPrefix} ${i + 1}" loading="lazy" onerror="if(this.src!==this.dataset.full){this.src=this.dataset.full}else{this.style.display='none'}">`)
    .join('');
  return `<div class="photo-grid">${imgs}</div>`;
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/* 坐标系统:存储=GCJ-02(高德瓦片系),OSRM 要 WGS-84,互转 */
function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320.0 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}
function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}
function wgs2gcj(lat, lng) {
  const a = 6378245.0, ee = 0.00669342162296594323;
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lat: lat + dLat, lng: lng + dLng };
}
function gcj2wgs(lat, lng) {
  const g = wgs2gcj(lat, lng);
  return { lat: lat * 2 - g.lat, lng: lng * 2 - g.lng };
}

/* 泪滴形图钉(内联 SVG,无外部依赖):橙红渐变不可行用纯色 + 白点 + 投影 */
function ggPinSvg() {
  return '<svg viewBox="0 0 24 24" width="28" height="28" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">'
    + '<path d="M12 1.8C7.4 1.8 3.7 5.5 3.7 10.1c0 5.6 6.8 12.6 7.4 13.3.5.5 1.3.5 1.8 0 .6-.7 7.4-7.7 7.4-13.3C20.3 5.5 16.6 1.8 12 1.8z" fill="#e11d48"/>'
    + '<circle cx="12" cy="10" r="3.1" fill="#fff"/></svg>';
}

function entryCard(e) {
  const authorTag = e.author
    ? `<span class="author-tag${e.author === '小红' ? ' rose' : ''}">${esc(e.author)}</span>`
    : '';
  const locTag = e.location && e.location.name
    ? `<span class="loc-tag">📍 ${esc(e.location.name)}</span>`
    : '';
  const timeTag = e.ts ? `<span class="time-tag">${fmtTime(e.ts)}</span>` : '';
  return `<article class="entry">
    <div class="entry-meta">${timeTag}${authorTag}${e.album ? `<span class="album-tag">${esc(e.album)}</span>` : ''}${locTag}</div>
    ${e.title ? `<h3 class="entry-title">${esc(e.title)}</h3>` : ''}
    ${e.text ? `<div class="entry-text">${esc(e.text).replace(/\n/g, '<br>')}</div>` : ''}
    ${photoGridHtml(e.photos, e.date)}
  </article>`;
}

/* ---------- 日历 ---------- */
function initCalendar() {
  const now = new Date();
  currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  $('#cal-prev').addEventListener('click', () => shiftMonth(-1));
  $('#cal-next').addEventListener('click', () => shiftMonth(1));
  renderCalendar();
}

function shiftMonth(delta) {
  const [y, m] = currentMonth.split('-').map(Number);
  const d0 = new Date(y, m - 1 + delta, 1);
  currentMonth = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}`;
  renderCalendar();
}

function renderCalendar() {
  const [y, m] = currentMonth.split('-').map(Number);
  $('#cal-title').textContent = `${y} 年 ${m} 月`;
  const startWd = new Date(y, m - 1, 1).getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const entrySet = new Set(allEntries.filter((e) => e.date.startsWith(currentMonth)).map((e) => e.date));
  // 待办橙点:仅登录用户可见(隐私:未登录日历与以前完全一致)
  const todoSet = currentUser
    ? new Set(allTodos.filter((t) => t.date.startsWith(currentMonth)).map((t) => t.date))
    : new Set();

  const grid = $('#cal-grid');
  grid.innerHTML = '';
  for (let i = 0; i < startWd; i++) {
    const b = document.createElement('div');
    b.className = 'cal-blank';
    grid.appendChild(b);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${currentMonth}-${String(d).padStart(2, '0')}`;
    const cell = document.createElement('div');
    cell.className = 'cal-day'
      + (entrySet.has(ds) ? ' has-entry' : '')
      + (todoSet.has(ds) ? ' has-todo' : '')
      + (ds === selectedDate ? ' selected' : '');
    cell.innerHTML = `<span class="cal-num">${d}</span>${entrySet.has(ds) ? '<span class="cal-dot"></span>' : ''}${todoSet.has(ds) ? '<span class="cal-todo-dot"></span>' : ''}`;
    cell.addEventListener('click', () => selectDate(ds));
    grid.appendChild(cell);
  }
}

function selectDate(ds) {
  selectedDate = ds;
  activeAlbum = null;
  renderAlbums();
  renderCalendar();
  renderStream(); // 专辑面板同步回占位态(否则残留上一次的专辑列表/地图)
  const dayEntries = allEntries
    .filter((e) => e.date === ds)
    .sort((a, b) => ((a.created_at || '') < (b.created_at || '') ? -1 : 1));
  const [y, m, d] = ds.split('-');
  $('#day-title').textContent = `${y} 年 ${Number(m)} 月 ${Number(d)} 日`;
  $('#day-entries').innerHTML = dayEntries.length
    ? dayEntries.map(entryCard).join('')
    : '<p class="empty">这天还没有日记</p>';
  renderDayTodos(ds);
}

/* ---------- 私有待办(规划打卡;仅登录用户可见) ---------- */
async function initPortalUser() {
  const box = $('#portal-user');
  if (!box) return;
  try {
    const res = await (await fetch('/api/auth')).json();
    currentUser = res.user || null;
  } catch { currentUser = null; }
  if (currentUser) {
    box.hidden = false;
    box.innerHTML = `<span class="user-name">${esc(currentUser)}</span><a class="btn-small" href="/write">管理</a>`;
    try {
      const d = await (await fetch('/api/todos')).json();
      allTodos = d.todos || [];
    } catch { allTodos = []; }
    renderCalendar();
    if (selectedDate) renderDayTodos(selectedDate);
  } else {
    box.hidden = false;
    box.innerHTML = '<a class="btn-small" href="/write">登录</a>';
  }
}

function renderDayTodos(ds) {
  const box = $('#day-todos');
  if (!currentUser) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  const list = allTodos.filter((t) => t.date === ds);
  const done = list.filter((t) => t.done).length;
  const items = list.length
    ? list.map((t) => `
      <div class="todo-item${t.done ? ' done' : ''}" data-id="${t.id}">
        <span class="todo-check">${t.done ? '✅' : '○'}</span>
        <span class="todo-text">${esc(t.text)}</span>
        <button type="button" class="todo-del" data-id="${t.id}" aria-label="删除">✕</button>
      </div>`).join('')
    : '<p class="todo-empty">这天还没有待办,添加一条开始打卡</p>';
  box.innerHTML = `
    <div class="todo-head"><span>当天待办</span><span class="todo-progress">已勾 ${done}/${list.length}</span></div>
    ${items}
    <form class="todo-add"><input type="text" maxlength="200" placeholder="添加一条待办…" required><button type="submit" class="btn-small">添加</button></form>`;
  box.querySelectorAll('.todo-item').forEach((el) => {
    el.addEventListener('click', (ev) => {
      if (ev.target.closest('.todo-del')) return; // 删除按钮不触发勾选
      toggleTodo(Number(el.dataset.id), ds);
    });
  });
  box.querySelectorAll('.todo-del').forEach((b) => {
    b.addEventListener('click', () => deleteTodo(Number(b.dataset.id), ds));
  });
  const form = box.querySelector('.todo-add');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const input = form.querySelector('input');
    const text = input.value.trim();
    if (!text) return;
    const fd = new FormData();
    fd.append('date', ds);
    fd.append('text', text);
    try {
      const res = await (await fetch('/api/todos', { method: 'POST', body: fd })).json();
      if (res.ok && res.todo) {
        allTodos.push(res.todo);
        renderDayTodos(ds);
      } else if (res.error) input.placeholder = res.error;
    } catch { /* 忽略 */ }
  });
}

async function deleteTodo(id, ds) {
  try {
    const res = await fetch(`/api/todos?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      allTodos = allTodos.filter((t) => t.id !== id);
      renderDayTodos(ds);
    }
  } catch { /* 忽略 */ }
}

async function toggleTodo(id, ds) {
  const fd = new FormData();
  fd.append('id', String(id));
  try {
    const res = await (await fetch('/api/todos/toggle', { method: 'POST', body: fd })).json();
    if (!res.ok) return;
    const t = allTodos.find((x) => x.id === id);
    if (t) t.done = res.todo.done;
    renderDayTodos(ds);
  } catch { /* 忽略 */ }
}

/* ---------- 专辑地图(Leaflet + 高德瓦片,懒加载) ---------- */
let albumMap = null;

function loadLeaflet() {
  return new Promise((resolve, reject) => {
    if (window.L) return resolve();
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js';
    s.onload = () => {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(l);
      resolve();
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function renderAlbumMap(list) {
  const box = $('#album-map');
  const withLoc = list.filter((e) => e.location && e.location.lat != null && e.location.lng != null);
  if (!withLoc.length) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';
  try {
    await loadLeaflet();
  } catch {
    box.style.display = 'none';
    return;
  }
  if (albumMap) albumMap.remove();
  const map = L.map('album-map', { scrollWheelZoom: false });
  albumMap = map;
  L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
    maxZoom: 18,
    subdomains: ['1', '2', '3', '4'],
    attribution: '&copy; 高德地图',
  }).addTo(map);
  const bounds = [];
  for (const e of withLoc) {
    const mk = L.marker([e.location.lat, e.location.lng], { icon: L.divIcon({ className: 'gg-marker', html: ggPinSvg(), iconSize: [28, 28], iconAnchor: [14, 27] }) }).addTo(map);
    mk.bindPopup(`<b>${esc(e.date)} ${fmtTime(e.ts)}</b> ${esc(e.title || '')}<br>${esc(e.location.display || e.location.name || '')}`);
    bounds.push([e.location.lat, e.location.lng]);
  }
  if (bounds.length === 1) {
    map.setView(bounds[0], 12);
  } else if (bounds.length > 1) {
    // 沿路规划(CF 边缘 OSRM 代理,失败回退直线),按日期排序连线
    const ordered = withLoc.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    // 存储坐标=GCJ-02(高德系),OSRM 要 WGS-84,请求前转换
    const wgsPts = ordered.map((e) => gcj2wgs(e.location.lat, e.location.lng));
    let line = ordered.map((e) => [e.location.lat, e.location.lng]);
    try {
      const ptsStr = wgsPts.map((p) => `${p.lat},${p.lng}`).join('|');
      const route = await (await fetch(`/api/route?pts=${encodeURIComponent(ptsStr)}`)).json();
      if (route.coordinates && route.coordinates.length > 1) {
        // 响应几何是 WGS-84,转回 GCJ-02 才与瓦片/图钉对齐
        line = route.coordinates.map(([lat, lng]) => {
          const g = wgs2gcj(lat, lng);
          return [g.lat, g.lng];
        });
      }
    } catch { /* 直线 */ }
    L.polyline(line, { color: '#d97706', weight: 3, opacity: 0.8 }).addTo(map);
    map.fitBounds(line, { padding: [30, 30] });
  }
}

/* ---------- 专辑 / 动态流 ---------- */
function renderAlbums() {
  const albums = [...new Set(allEntries.map((e) => e.album).filter(Boolean))];
  const chips = $('#album-chips');
  chips.innerHTML = '';
  const mk = (label, album, active) => {
    const b = document.createElement('button');
    b.className = 'chip' + (active ? ' active' : '');
    b.textContent = label;
    // 反选:再点已选中的专辑 → 收起详情(置空回占位态)
    b.addEventListener('click', () => setAlbum(activeAlbum === album ? null : album));
    chips.appendChild(b);
  };
  if (SHOW_RECENT_FEED) mk('全部', null, activeAlbum === null);
  for (const a of albums) mk(a, a, activeAlbum === a);
}

function setAlbum(album) {
  activeAlbum = album;
  renderAlbums();
  renderStream();
}

async function renderStream() {
  let list = allEntries;
  if (activeAlbum) list = list.filter((e) => e.album === activeAlbum);
  if (!activeAlbum && !SHOW_RECENT_FEED) {
    // 专辑入口:默认不渲染动态流
    $('#stream-title').textContent = '专辑';
    $('#stream').innerHTML = `<p class="empty">${allEntries.length ? '选择一个专辑查看' : '还没有日记 ✏️'}</p>`;
    $('#album-map').style.display = 'none';
    return;
  }
  list = [...list].sort((a, b) => {
    if (activeAlbum) return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; // 专辑正序
    if (a.date !== b.date) return a.date > b.date ? -1 : 1;                 // 动态倒序
    return (a.created_at || '') > (b.created_at || '') ? -1 : 1;
  });
  $('#stream-title').textContent = activeAlbum ? `专辑 · ${activeAlbum}` : '最近动态';
  $('#stream').innerHTML = list
    .slice(0, 60)
    .map((e) => `<article class="entry stream-entry"><div class="stream-date">${esc(e.date)}</div>${entryCard(e)}</article>`)
    .join('')
    || '<p class="empty">还没有日记 ✏️</p>';
  // 地图仅在选中专辑时显示
  if (activeAlbum) await renderAlbumMap(list);
  else $('#album-map').style.display = 'none';
}

/* ---------- 大图 ---------- */
function setupLightbox() {
  const lb = document.getElementById('lightbox');
  document.addEventListener('click', (e) => {
    const img = e.target.closest('.photo-grid img');
    if (!img || !lb) return;
    lb.querySelector('img').src = img.dataset.full || img.src;
    lb.classList.add('open');
  });
  if (lb) {
    lb.addEventListener('click', () => lb.classList.remove('open'));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') lb.classList.remove('open');
    });
  }
}

/* ---------- 启动 ---------- */
async function init() {
  const data = await (await fetch('/api/entries')).json();
  allEntries = data.entries || [];
  setupLightbox();
  initCalendar();
  renderAlbums();
  renderStream();
  initPortalUser(); // 探测登录态 + 拉私有待办(待办橙点/待办区仅登录可见)

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const urlDate = new URLSearchParams(location.search).get('date');

  if (urlDate && /^\d{4}-\d{2}-\d{2}$/.test(urlDate)) {
    // 上传成功跳转 ?date=YYYY-MM-DD → 定位到该月并选中当天
    currentMonth = urlDate.slice(0, 7);
    renderCalendar();
    selectDate(urlDate);
  } else if (allEntries.some((e) => e.date === today)) {
    selectDate(today);
  }
}

init().catch((err) => {
  console.error(err);
  $('#stream').innerHTML = `<p class="empty">加载失败:${esc(err.message)}</p>`;
});
