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
      ${e.ts ? `<span class="time-tag">${fmtTime(e.ts)}</span>` : ''}
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
    .map((e) => ({ date: e.date, ts: e.ts, title: e.title || '', name: (e.location.display || e.location.name || ''), lat: e.location.lat, lng: e.location.lng }));

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
    const mk = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'gg-marker', html: '📍', iconSize: [24, 24], iconAnchor: [12, 24] }) }).addTo(map);
    mk.bindPopup(`<b>${esc(p.date)} ${fmtTime(p.ts)}</b> ${esc(p.title)}<br>${esc(p.name)}`);
    mk.on('click', () => map.setView([p.lat, p.lng], Math.max(map.getZoom(), 12)));
  });
  if (pts.length > 1) {
    // 沿路规划:CF 边缘 OSRM 代理,失败回退直线;存储=GCJ-02,OSRM 要 WGS-84
    let line = latlngs;
    try {
      const wgsPts = pts.map((p) => gcj2wgs(p.lat, p.lng));
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
