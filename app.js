/* 旅行地图集 - 数据驱动渲染 */
'use strict';

const $ = (sel) => document.querySelector(sel);

// 部署/数据更新时递增,强制浏览器刷新 JSON 缓存
const DATA_VERSION = '20260810a';

async function loadJSON(url) {
  const res = await fetch(`${url}?v=${DATA_VERSION}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`加载失败 ${url} (HTTP ${res.status})`);
  return res.json();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---------- 状态徽章 ---------- */
const STATUS = {
  booked:  { label: '已订',  cls: 'booked' },
  pending: { label: '待定',  cls: 'pending' },
};

function statusBadge(status) {
  const s = STATUS[status] || STATUS.pending;
  return `<span class="status-badge ${s.cls}">${s.label}</span>`;
}

/* ---------- 头部 ---------- */
function renderHeader(trip, index, data) {
  $('#trip-title').textContent = data.meta.title || trip.title || '旅行';
  $('#trip-subtitle').textContent = data.meta.subtitle || '';
  document.title = `${data.meta.title || trip.title} · 旅行地图集`;

  const sel = $('#trip-switcher');
  if (index.length > 1) {
    sel.hidden = false;
    sel.innerHTML = index
      .map((t) => `<option value="${escapeHtml(t.id)}" ${t.id === trip.id ? 'selected' : ''}>${escapeHtml(t.title)}</option>`)
      .join('');
  } else {
    sel.hidden = true;
  }
}

function setupSwitcher() {
  $('#trip-switcher').addEventListener('change', (e) => {
    const url = new URL(window.location.href);
    url.searchParams.set('trip', e.target.value);
    window.location.href = url.toString();
  });
}

/* ---------- 每日卡片 ---------- */
function renderCards(data) {
  const tl = $('#timeline');
  tl.innerHTML = '';

  if (!data.days || data.days.length === 0) {
    tl.innerHTML = '<p class="empty">暂无行程数据</p>';
    return;
  }

  const todayDay = tripPhase(data) === 'during' ? tripDayNumber(data, nzToday()) : null;

  for (const d of data.days) {
    const card = document.createElement('article');
    card.className = `day-card${d.status === 'booked' ? ' status-booked' : ''}${d.day === todayDay ? ' is-today' : ''}`;
    card.dataset.day = d.day;

    const activities = (d.activities || [])
      .map((a) => `<li>${escapeHtml(a)}</li>`)
      .join('');

    card.innerHTML = `
      <div class="day-head">
        <span class="day-badge">Day ${d.day}</span>
        <span class="day-date">${escapeHtml(d.date)}${d.weekday ? ' ' + escapeHtml(d.weekday) : ''}</span>
        ${statusBadge(d.status)}
      </div>
      <h3 class="day-city">${escapeHtml(d.city)}${d.city_en ? ` <span class="city-en">${escapeHtml(d.city_en)}</span>` : ''}</h3>
      ${d.summary ? `<p class="day-summary">${escapeHtml(d.summary)}</p>` : ''}
      ${activities ? `<ul class="day-activities">${activities}</ul>` : ''}
      <dl class="day-meta">
        ${d.accommodation ? `<div><dt>住宿</dt><dd>${escapeHtml(d.accommodation)}</dd></div>` : ''}
        ${d.meals ? `<div><dt>餐食</dt><dd>${escapeHtml(d.meals)}</dd></div>` : ''}
        ${d.transport ? `<div><dt>交通</dt><dd>${escapeHtml(d.transport)}</dd></div>` : ''}
      </dl>
    `;
    tl.appendChild(card);
  }
}

/* ---------- 底部 ---------- */
function renderFooter(data) {
  const updated = data.meta && data.meta.updated_at;
  $('#footer').textContent = updated
    ? `最近更新:${updated} · 数据源:飞书文档`
    : '数据源:飞书文档';
}

/* ---------- 日期与进度 ---------- */
const NZ_OFFSET_H = 12; // 新西兰 9 月为 NZST (UTC+12)

function dateStr(offsetHours) {
  const now = new Date(Date.now() + (offsetHours || 0) * 3600 * 1000);
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const cnToday = () => dateStr(0);
const nzToday = () => dateStr(NZ_OFFSET_H);

function daysDiff(a, b) {
  return Math.round((new Date(`${a}T00:00:00`) - new Date(`${b}T00:00:00`)) / 86400000);
}

function tripDayNumber(data, today) {
  const n = daysDiff(today, data.meta.departure) + 1;
  return Math.min(Math.max(n, 1), data.days.length);
}

function tripPhase(data) {
  const t = cnToday();
  if (t < data.meta.departure) return 'before';
  if (t > data.meta.return) return 'after';
  return 'during';
}

function renderCountdown(data) {
  const el = $('#countdown');
  const phase = tripPhase(data);
  if (phase === 'before') {
    el.textContent = `距出发还有 ${daysDiff(data.meta.departure, cnToday())} 天`;
  } else if (phase === 'during') {
    const day = tripDayNumber(data, nzToday());
    el.textContent = `第 ${day} 天 · ${data.days[day - 1].city}`;
  } else {
    el.textContent = '旅程已结束 🎉';
  }
}

function renderDailyUpdate(data) {
  const tl = $('#timeline');
  if (tripPhase(data) !== 'during') return;

  const day = tripDayNumber(data, nzToday());
  const d = data.days[day - 1];
  if (!d) return;

  const card = document.createElement('section');
  card.className = 'update-card';
  card.id = 'today-update';

  const photos = (d.actual && d.actual.photos && d.actual.photos.length)
    ? `<div class="update-photos">${d.actual.photos.map((p) => `<img src="${p}" alt="Day ${day} 实况照片" loading="lazy">`).join('')}</div>`
    : '';

  card.innerHTML = `
    <div class="update-title">
      <span class="day-badge">今日播报</span>
      <h2>Day ${day} · ${escapeHtml(d.city)}${d.city_en ? ` <span class="city-en">${escapeHtml(d.city_en)}</span>` : ''}</h2>
    </div>
    ${d.actual && d.actual.text
      ? `<p class="update-text">${escapeHtml(d.actual.text)}</p>`
      : `<p class="update-text">${escapeHtml(d.summary)}</p><p class="soft-note">按计划中,实况待更新 ✉️</p>`}
    ${photos}
  `;
  tl.prepend(card);
}

/* ---------- 地图(懒加载) ---------- */
function loadResource(kind, src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement(kind === 'css' ? 'link' : 'script');
    if (kind === 'css') {
      el.rel = 'stylesheet';
      el.href = src;
    } else {
      el.src = src;
    }
    el.onload = resolve;
    el.onerror = () => reject(new Error(`加载失败 ${src}`));
    document.head.appendChild(el);
  });
}

const MARKER_COLORS = { booked: '#15803d', pending: '#9ca3af' };
let currentData = null;
let mapInited = false;

function focusDay(day) {
  const card = document.querySelector(`.day-card[data-day="${day}"]`);
  if (!card) return;
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  card.classList.add('is-focused');
  setTimeout(() => card.classList.remove('is-focused'), 1600);
}

async function initMap(data) {
  const area = $('#map-area');
  area.innerHTML = '<div id="leaflet-map" class="leaflet-map"></div>';
  try {
    await Promise.all([
      loadResource('css', 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css'),
      loadResource('js', 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js'),
    ]);
  } catch (e) {
    area.innerHTML = '<div class="map-placeholder">🗺️ 地图资源加载失败(网络原因),行程卡片不受影响</div>';
    return;
  }
  if (typeof L === 'undefined') {
    area.innerHTML = '<div class="map-placeholder">🗺️ 地图不可用,行程卡片不受影响</div>';
    return;
  }

  const map = L.map('leaflet-map', { scrollWheelZoom: false }).setView([-41.5, 173], 5);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>',
  }).addTo(map);

  for (const d of data.days) {
    const color = MARKER_COLORS[d.status] || MARKER_COLORS.pending;
    const icon = L.divIcon({
      className: 'day-marker-wrap',
      html: `<div class="day-marker" style="background:${color}">${d.day}</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });
    const m = L.marker([d.lat, d.lon], { icon });
    m.bindTooltip(
      `<b>${d.city}</b>${d.city_en ? ' ' + d.city_en : ''}<br>Day ${d.day} · ${d.date}`,
      { direction: 'top', offset: [0, -10] }
    );
    m.on('click', () => focusDay(d.day));
    m.addTo(map);
  }

  for (const r of data.routes || []) {
    L.polyline(r.coords, { color: '#0e7490', weight: 3, opacity: 0.65 }).addTo(map);
  }

  const bounds = L.latLngBounds(data.days.map((d) => [d.lat, d.lon]));
  for (const r of data.routes || []) {
    for (const c of r.coords) bounds.extend(c);
  }
  map.fitBounds(bounds.pad(0.08));
  mapInited = true;
}

function setupMapLazyLoad() {
  const area = $('#map-area');
  if (!area) return;
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && currentData && !mapInited) {
          io.disconnect();
          initMap(currentData);
        }
      },
      { rootMargin: '400px' }
    );
    io.observe(area);
  } else if (currentData) {
    initMap(currentData);
  }
}

/* ---------- 启动 ---------- */
async function init() {
  const index = await loadJSON('data/trips/index.json');

  if (!Array.isArray(index) || index.length === 0) {
    $('#timeline').innerHTML = '<p class="empty">暂无行程,请先在 data/trips/ 中添加</p>';
    return;
  }

  const requested = new URLSearchParams(window.location.search).get('trip');
  const trip = index.find((t) => t.id === requested) || index[0];
  const data = await loadJSON(`data/trips/${encodeURIComponent(trip.id)}.json`);

  currentData = data;
  renderHeader(trip, index, data);
  setupSwitcher();
  renderCountdown(data);
  renderCards(data);
  renderDailyUpdate(data);
  renderFooter(data);
  setupMapLazyLoad();
}

init().catch((err) => {
  console.error(err);
  $('#timeline').innerHTML = `<p class="empty">页面加载失败:${escapeHtml(err.message)}</p>`;
});
