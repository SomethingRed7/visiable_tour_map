/* 咕咕嘎嘎 - 旅行日记 portal */
'use strict';

const $ = (s) => document.querySelector(s);

let allEntries = [];
let currentMonth = null;   // 'YYYY-MM'
let selectedDate = null;
let activeAlbum = null;

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

function entryCard(e) {
  const authorTag = e.author
    ? `<span class="author-tag${e.author === '小红' ? ' rose' : ''}">${esc(e.author)}</span>`
    : '';
  const locTag = e.location && e.location.name
    ? `<span class="loc-tag">📍 ${esc(e.location.name)}</span>`
    : '';
  return `<article class="entry">
    <div class="entry-meta">${authorTag}${e.album ? `<span class="album-tag">${esc(e.album)}</span>` : ''}${locTag}</div>
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
      + (ds === selectedDate ? ' selected' : '');
    cell.innerHTML = `<span class="cal-num">${d}</span>${entrySet.has(ds) ? '<span class="cal-dot"></span>' : ''}`;
    cell.addEventListener('click', () => selectDate(ds));
    grid.appendChild(cell);
  }
}

function selectDate(ds) {
  selectedDate = ds;
  activeAlbum = null;
  renderAlbums();
  renderCalendar();
  const dayEntries = allEntries
    .filter((e) => e.date === ds)
    .sort((a, b) => ((a.created_at || '') < (b.created_at || '') ? -1 : 1));
  const [y, m, d] = ds.split('-');
  $('#day-title').textContent = `${y} 年 ${Number(m)} 月 ${Number(d)} 日`;
  $('#day-entries').innerHTML = dayEntries.length
    ? dayEntries.map(entryCard).join('')
    : '<p class="empty">这天还没有日记</p>';
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
    const mk = L.marker([e.location.lat, e.location.lng]).addTo(map);
    mk.bindPopup(`<b>${esc(e.date)}</b> ${esc(e.title || '')}<br>${esc(e.location.display || e.location.name || '')}`);
    bounds.push([e.location.lat, e.location.lng]);
  }
  if (bounds.length === 1) map.setView(bounds[0], 12);
  else map.fitBounds(bounds, { padding: [30, 30] });
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
    b.addEventListener('click', () => setAlbum(album));
    chips.appendChild(b);
  };
  mk('全部', null, activeAlbum === null);
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
    || '<p class="empty">还没有日记,点右上角「写日记」开始吧 ✏️</p>';
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
