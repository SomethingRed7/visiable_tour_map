/* 咕咕嘎嘎 - 行程分享快照只读页(公开,免登录;由 /s/<token> 注入快照 JSON)
 * 与导出页同款展示:按日期分组条目+待办小节+地图路线;
 * 无勾选器/无打印/无管理(快照内容固定,生成者决定)。 */
'use strict';

var $ = (s) => document.querySelector(s);

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function shortLoc(name) {
  const s = String(name || '').split(/[,，]/)[0].trim();
  return (s || String(name || '')).slice(0, 30);
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

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* 泪滴形图钉(与导出页/专辑预览同款) */
function ggPinSvg() {
  return '<svg viewBox="0 0 24 24" width="28" height="28" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">'
    + '<path d="M12 1.8C7.4 1.8 3.7 5.5 3.7 10.1c0 5.6 6.8 12.6 7.4 13.3.5.5 1.3.5 1.8 0 .6-.7 7.4-7.7 7.4-13.3C20.3 5.5 16.6 1.8 12 1.8z" fill="#e11d48"/>'
    + '<circle cx="12" cy="10" r="3.1" fill="#fff"/></svg>';
}

/* 照片兜底:缩略图 404 → 全图 → 隐藏;横图 landscape 置顶排列(CSP 禁内联 onerror,必须 addEventListener) */
function bindPhotoGridFallback(container) {
  container.querySelectorAll('.photo-grid img').forEach((img) => {
    const fb = () => {
      if (img.src !== img.dataset.full) img.src = img.dataset.full;
      else img.style.display = 'none';
    };
    img.addEventListener('error', fb);
    if (img.complete && img.naturalWidth === 0) fb();
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
  const map = L.map('sv-map', { scrollWheelZoom: false });
  L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
    maxZoom: 18,
    subdomains: ['1', '2', '3', '4'],
    attribution: '&copy; 高德地图',
  }).addTo(map);
  // 右上角全屏查看按钮(铺满视口 + 自动 fit 所有打卡点)
  LocPicker.lpMapFullscreen(map, box);
  // 容器刚从 display:none 切到 block,立即初始化 Leaflet 尺寸未就绪 → 延时校正(与专辑地图同款)
  setTimeout(() => map.invalidateSize(), 120);
  setTimeout(() => map.invalidateSize(), 400);
  pts.forEach((p, i) => {
    const mk = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'gg-marker', html: ggPinSvg(), iconSize: [28, 28], iconAnchor: [14, 27] }) }).addTo(map);
    mk.bindPopup(`<b>${esc(p.date)} ${fmtTime(p.ts)}</b> ${esc(p.title)}<br>${esc(p.name)}`);
    mk.on('click', () => map.setView([p.lat, p.lng], Math.max(map.getZoom(), 12)));
  });
  if (pts.length > 1) {
    const ordered = pts.slice().sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.ts || 0) - (b.ts || 0);
    });
    const line = await getRouteLine(ordered.map((p) => ({ location: { lat: p.lat, lng: p.lng } })));
    L.polyline(line, { color: '#e11d48', weight: 4, opacity: 0.9 }).addTo(map);
    map.fitBounds(line, { padding: [40, 40] });
  } else {
    map.setView([pts[0].lat, pts[0].lng], 12);
  }
}

async function render() {
  const snap = JSON.parse(document.getElementById('snapshot-data').textContent);
  const list = snap.entries || [];
  const todos = snap.todos || [];
  const rangeText = (snap.from && snap.to) ? `${fmt(snap.from)} ~ ${fmt(snap.to)}` : '';
  $('#sv-subtitle').textContent = [snap.album && `专辑 · ${snap.album}`, rangeText].filter(Boolean).join('  ');
  $('#sv-meta').textContent = snap.updated_at ? `快照更新于 ${fmtDateTime(snap.updated_at)}` : '';

  const box = $('#sv-overview');
  const days = new Map();
  for (const e of list) {
    if (!days.has(e.date)) days.set(e.date, { entries: [], todos: [] });
    days.get(e.date).entries.push(e);
  }
  for (const t of todos) {
    if (!days.has(t.date)) days.set(t.date, { entries: [], todos: [] });
    days.get(t.date).todos.push(t);
  }
  if (!days.size) {
    box.innerHTML = '<p class="empty">这个分享里还没有内容</p>';
    $('#sv-map').style.display = 'none';
    return;
  }
  box.innerHTML = [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, { entries, todos: dayTodos }]) => {
      const todoHtml = dayTodos.length
        ? `<div class="ex-todos"><div class="ex-todos-title">待办</div>${dayTodos
            .map((t) => `<div class="ex-todo${t.done ? ' done' : ''}"><span class="todo-check">${t.done ? '✅' : '○'}</span>${esc(t.text)}</div>`)
            .join('')}</div>`
        : '';
      const entryHtml = entries
        .map((e) => `<article class="entry">
    <div class="entry-meta">
      <span class="stream-date">${esc(e.date)}</span>
      ${e.ts ? `<span class="time-tag">${fmtTime(e.ts)}</span>` : ''}
      ${e.author ? `<span class="author-tag${e.author === '小红' ? ' rose' : ''}">${esc(e.author)}</span>` : ''}
      ${e.visibility === 'private' ? '<span class="vis-tag">私有</span>' : ''}
      ${e.album ? `<span class="album-tag">${esc(e.album)}</span>` : ''}
      ${e.location && e.location.name ? `<span class="loc-tag">📍 ${esc(shortLoc(e.location.name))}</span>` : ''}
    </div>
    ${e.title ? `<h3 class="entry-title">${esc(e.title)}</h3>` : ''}
    ${e.text ? `<div class="entry-text">${esc(e.text).replace(/\n/g, '<br>')}</div>` : ''}
    ${(e.photos || []).length ? `<div class="photo-grid">${e.photos.map((p) => `<img src="${thumbUrl(p)}" data-full="${p}" alt="照片" loading="lazy">`).join('')}</div>` : ''}
  </article>`)
        .join('');
      return `<div class="ex-day">${todoHtml}${entryHtml}</div>`;
    })
    .join('');

  bindPhotoGridFallback(box);
  // 照片点击 → 大图预览(与主页当日动态一致,不跳转新窗口;由 document 级 lightbox 处理)
  await renderMap(list, $('#sv-map'), $('#sv-map-note'));
}

/* 大图预览:点缩略图 → 全屏大图;点遮罩 / Esc 关闭(与主页当日动态同款,不跳转新窗口) */
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

setupLightbox();

render().catch((err) => {
  console.error(err);
  $('#sv-overview').innerHTML = `<p class="empty">加载失败:${esc(err.message)}</p>`;
});
