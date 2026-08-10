/* 咕咕嘎嘎 - 行程导出分享页(?from=YYYY-MM-DD&to=YYYY-MM-DD) */
'use strict';

const $ = (s) => document.querySelector(s);

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function thumbUrl(p) { return p.replace(/\.(jpg|jpeg|png)$/i, '-thumb.$1'); }

function fmt(d) {
  const [y, m, day] = d.split('-');
  return `${y} 年 ${Number(m)} 月 ${Number(day)} 日`;
}

async function init() {
  const params = new URLSearchParams(location.search);
  const from = params.get('from') || '';
  const to = params.get('to') || '';
  const valid = /^\d{4}-\d{2}-\d{2}$/;
  const box = $('#ex-overview');
  const mapBox = $('#ex-map');

  if (!valid.test(from) || !valid.test(to) || from > to) {
    $('#ex-title').textContent = '参数不对';
    box.innerHTML = '<p class="empty">请在写日记页「导出行程」选择日期区间,或检查链接 ?from=YYYY-MM-DD&to=YYYY-MM-DD</p>';
    mapBox.style.display = 'none';
    return;
  }

  $('#ex-subtitle').textContent = `${fmt(from)} ~ ${fmt(to)}`;
  document.title = `行程总览 ${from} ~ ${to} · 咕咕嘎嘎`;

  const data = await (await fetch('/api/entries')).json();
  const list = (data.entries || [])
    .filter((e) => e.date >= from && e.date <= to)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.ts || 0) - (b.ts || 0)));

  if (!list.length) {
    $('#ex-title').textContent = '这段时间还没有日记';
    box.innerHTML = '<p class="empty">区间内没有条目,换个日期试试</p>';
    mapBox.style.display = 'none';
    return;
  }

  box.innerHTML = list.map((e) => `<article class="entry">
    <div class="entry-meta">
      <span class="stream-date">${esc(e.date)}</span>
      ${e.author ? `<span class="author-tag${e.author === '小红' ? ' rose' : ''}">${esc(e.author)}</span>` : ''}
      ${e.album ? `<span class="album-tag">${esc(e.album)}</span>` : ''}
      ${e.location && e.location.name ? `<span class="loc-tag">📍 ${esc(e.location.name)}</span>` : ''}
    </div>
    ${e.title ? `<h3 class="entry-title">${esc(e.title)}</h3>` : ''}
    ${e.text ? `<div class="entry-text">${esc(e.text).replace(/\n/g, '<br>')}</div>` : ''}
    ${(e.photos || []).length ? `<div class="photo-grid">${e.photos.map((p) => `<img src="${thumbUrl(p)}" data-full="${p}" alt="照片" loading="lazy" onerror="if(this.src!==this.dataset.full){this.src=this.dataset.full}else{this.style.display='none'}">`).join('')}</div>` : ''}
  </article>`).join('');

  // 照片点击开大图
  box.querySelectorAll('.photo-grid img').forEach((img) => {
    img.addEventListener('click', () => window.open(img.dataset.full || img.src, '_blank'));
  });

  // 地图路线:按日期连线
  await renderMap(list, mapBox, $('#ex-map-note'));
}

async function renderMap(list, box, noteEl) {
  const pts = list
    .filter((e) => e.location && e.location.lat != null && e.location.lng != null)
    .map((e) => ({ date: e.date, title: e.title || '', name: (e.location.display || e.location.name || ''), lat: e.location.lat, lng: e.location.lng }));

  const skipped = list.length - pts.length;
  noteEl.textContent = skipped > 0 ? `(有 ${skipped} 条没有坐标,未上地图)` : '';

  if (!pts.length) { box.style.display = 'none'; return; }
  box.style.display = 'block';

  try {
    if (!window.L) await loadLeaflet();
  } catch {
    box.style.display = 'none';
    noteEl.textContent = '地图加载失败,请刷新重试';
    return;
  }

  const map = L.map('ex-map', { scrollWheelZoom: false });
  L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
    maxZoom: 18,
    subdomains: ['1', '2', '3', '4'],
    attribution: '&copy; 高德地图',
  }).addTo(map);

  const latlngs = pts.map((p) => [p.lat, p.lng]);
  pts.forEach((p, i) => {
    const mk = L.marker([p.lat, p.lng]).addTo(map);
    mk.bindPopup(`<b>${esc(p.date)}</b> ${esc(p.title)}<br>${esc(p.name)}`);
    mk.on('click', () => map.setView([p.lat, p.lng], Math.max(map.getZoom(), 12)));
  });
  if (pts.length > 1) {
    // 沿路规划:CF 边缘 OSRM 代理,失败回退直线
    let line = latlngs;
    try {
      const ptsStr = pts.map((p) => `${p.lat},${p.lng}`).join('|');
      const route = await (await fetch(`/api/route?pts=${encodeURIComponent(ptsStr)}`)).json();
      if (route.coordinates && route.coordinates.length > 1) line = route.coordinates;
    } catch { /* 直线 */ }
    L.polyline(line, { color: '#d97706', weight: 3, opacity: 0.8 }).addTo(map);
    map.fitBounds(line, { padding: [40, 40] });
  } else {
    map.setView(latlngs[0], 12);
  }
}

function loadLeaflet() {
  return new Promise((resolve, reject) => {
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

$('#btn-print').addEventListener('click', () => window.print());

init().catch((err) => {
  console.error(err);
  $('#ex-overview').innerHTML = `<p class="empty">加载失败:${esc(err.message)}</p>`;
});
