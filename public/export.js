/* 咕咕嘎嘎 - 行程导出分享页(?from=YYYY-MM-DD&to=YYYY-MM-DD) */
'use strict';

var $ = (s) => document.querySelector(s);

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* 地点名截短:只显示第一段短名(如「杭州东站」,忽略完整地址逗号串) */
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

/* 泪滴形图钉(内联 SVG,无外部依赖) */
function ggPinSvg() {
  return '<svg viewBox="0 0 24 24" width="28" height="28" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">'
    + '<path d="M12 1.8C7.4 1.8 3.7 5.5 3.7 10.1c0 5.6 6.8 12.6 7.4 13.3.5.5 1.3.5 1.8 0 .6-.7 7.4-7.7 7.4-13.3C20.3 5.5 16.6 1.8 12 1.8z" fill="#e11d48"/>'
    + '<circle cx="12" cy="10" r="3.1" fill="#fff"/></svg>';
}

/* 导出的数据与勾选状态(登录后加载) */
let exFrom = '';
let exTo = '';
let exAlbum = ''; // 专辑导出模式(可单独或与日期叠加)
let exAllEntries = [];
let exAllTodos = [];
let exMapInstance = null;

async function init() {
  const params = new URLSearchParams(location.search);
  exFrom = params.get('from') || '';
  exTo = params.get('to') || '';
  exAlbum = params.get('album') || '';
  const valid = /^\d{4}-\d{2}-\d{2}$/;
  const box = $('#ex-overview');
  const mapBox = $('#ex-map');

  // 登录门:导出含私有内容,未登录引导去登录(不渲染任何内容)
  const auth = await (await fetch('/api/auth')).json();
  if (!auth.user) {
    $('#ex-login').hidden = false;
    $('#ex-controls').hidden = true;
    box.innerHTML = '';
    mapBox.style.display = 'none';
    return;
  }
  $('#ex-login').hidden = true;
  $('#ex-controls').hidden = false;

  // 模式:①专辑 ②起止日期 ③叠加;至少一个有效
  const fromOk = valid.test(exFrom);
  const toOk = valid.test(exTo);
  const rangeOk = fromOk && toOk && exFrom <= exTo;
  if (!exAlbum && !rangeOk) {
    $('#ex-title').textContent = '参数不对';
    box.innerHTML = '<p class="empty">请在写日记页「导出行程」选择专辑或日期区间,或检查链接 ?album=&from=&to=</p>';
    mapBox.style.display = 'none';
    return;
  }
  if ((exFrom || exTo) && !rangeOk) {
    $('#ex-title').textContent = '日期区间不对';
    box.innerHTML = '<p class="empty">起始/结束日期需成对且起始不晚于结束</p>';
    mapBox.style.display = 'none';
    return;
  }

  // 副标题:专辑名 / 区间 / 组合
  const rangeText = rangeOk ? `${fmt(exFrom)} ~ ${fmt(exTo)}` : '';
  $('#ex-subtitle').textContent = [exAlbum && `专辑 · ${exAlbum}`, rangeText].filter(Boolean).join('  ');
  document.title = `行程总览 ${[exAlbum, rangeText].filter(Boolean).join(' ')} · 咕咕嘎嘎`;

  const [entriesData, todosData] = await Promise.all([
    fetch('/api/entries').then((r) => r.json()),
    fetch('/api/todos').then((r) => r.json()).catch(() => ({ todos: [] })),
  ]);
  let list = entriesData.entries || [];
  if (exAlbum) list = list.filter((e) => e.album === exAlbum);
  if (rangeOk) list = list.filter((e) => e.date >= exFrom && e.date <= exTo);
  exAllEntries = list;
  // 待办仅日期区间时参与;纯专辑模式待办不参与(待办无专辑概念)
  exAllTodos = rangeOk ? (todosData.todos || []).filter((t) => t.date >= exFrom && t.date <= exTo) : [];

  // 勾选变化即时重渲染
  ['ck-public', 'ck-private', 'ck-todo', 'ck-checkin'].forEach((id) => {
    document.getElementById(id).addEventListener('change', renderExport);
  });
  renderExport();
}

// 按勾选过滤条目:公开 / 私有(非打卡)/ 打卡(私有子集,需「私有」与「打卡」都勾)
function filteredEntries() {
  const showPublic = $('#ck-public').checked;
  const showPrivate = $('#ck-private').checked;
  const showCheckin = $('#ck-checkin').checked;
  return exAllEntries
    .filter((e) => {
      if (e.visibility !== 'private') return showPublic;
      const isCheckin = (e.title || '').startsWith('打卡:');
      if (isCheckin) return showPrivate && showCheckin;
      return showPrivate;
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.ts || 0) - (b.ts || 0)));
}

async function renderExport() {
  const box = $('#ex-overview');
  const mapBox = $('#ex-map');
  const list = filteredEntries();
  const showTodo = $('#ck-todo').checked;

  if (!list.length && !(showTodo && exAllTodos.length)) {
    $('#ex-title').textContent = '这段时间还没有内容';
    box.innerHTML = '<p class="empty">所选区间与勾选条件下没有内容,换个日期或勾选试试</p>';
    mapBox.style.display = 'none';
    return;
  }
  $('#ex-title').textContent = '行程总览';

  // 按日期分组:条目 + 待办
  const days = new Map();
  for (const e of list) {
    if (!days.has(e.date)) days.set(e.date, { entries: [], todos: [] });
    days.get(e.date).entries.push(e);
  }
  if (showTodo) {
    const todos = [...exAllTodos].sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
    for (const t of todos) {
      if (!days.has(t.date)) days.set(t.date, { entries: [], todos: [] });
      days.get(t.date).todos.push(t);
    }
  }

  box.innerHTML = [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, { entries, todos }]) => {
      const todoHtml = todos.length
        ? `<div class="ex-todos"><div class="ex-todos-title">待办</div>${todos
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

  // 照片兜底:缩略图 404 → 回退全图;全图也挂 → 隐藏(CSP 禁内联 onerror,必须 addEventListener)
  box.querySelectorAll('.photo-grid img').forEach((img) => {
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

  // 照片点击开大图
  box.querySelectorAll('.photo-grid img').forEach((img) => {
    img.addEventListener('click', () => window.open(img.dataset.full || img.src, '_blank'));
  });

  // 地图路线:与条目列表一致(仅含坐标的条目)
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

  if (exMapInstance) { exMapInstance.remove(); exMapInstance = null; }
  try {
    if (!window.L) await loadLeaflet();
  } catch {
    box.style.display = 'none';
    noteEl.textContent = '地图加载失败,请刷新重试';
    return;
  }

  const map = L.map('ex-map', { scrollWheelZoom: false });
  exMapInstance = map;
  L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
    maxZoom: 18,
    subdomains: ['1', '2', '3', '4'],
    attribution: '&copy; 高德地图',
  }).addTo(map);

  const latlngs = pts.map((p) => [p.lat, p.lng]);
  pts.forEach((p, i) => {
    const mk = L.marker([p.lat, p.lng], { icon: L.divIcon({ className: 'gg-marker', html: ggPinSvg(), iconSize: [28, 28], iconAnchor: [14, 27] }) }).addTo(map);
    mk.bindPopup(`<b>${esc(p.date)} ${fmtTime(p.ts)}</b> ${esc(p.title)}<br>${esc(p.name)}`);
    mk.on('click', () => map.setView([p.lat, p.lng], Math.max(map.getZoom(), 12)));
  });
  if (pts.length > 1) {
    // 与专辑预览一致:driving → walking → 直线三级(带吸附检测,步行景区自动降级步行导航)
    const ordered = pts.slice().sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (a.ts || 0) - (b.ts || 0);
    });
    const line = await getRouteLine(ordered.map((p) => ({ location: { lat: p.lat, lng: p.lng } })));
    // 轨迹线:品牌红(与专辑预览同款)
    L.polyline(line, { color: '#e11d48', weight: 4, opacity: 0.9 }).addTo(map);
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

/* 打印:桌面/移动真弹出对话框时照常;浏览器吞掉 window.print(微信内置/部分国产如夸克)
 * 时用 beforeprint 事件探测:触发过 = 对话框真的弹了;600ms 内没触发 = 被吞 → 给可执行指引。
 * 桌面 Chrome window.print 是同步阻塞的,beforeprint 在对话框打开前必触发,不会误报。 */
function doPrint() {
  let fired = false;
  const onBefore = () => { fired = true; };
  window.addEventListener('beforeprint', onBefore);
  try { window.print(); } catch (e) { /* 忽略 */ }
  setTimeout(() => {
    window.removeEventListener('beforeprint', onBefore);
    if (!fired) {
      alert('当前浏览器未弹出打印窗口。请点浏览器右上角菜单 →「打印」或「保存为 PDF」(微信内请先点右上角 ⋯ 选「在浏览器打开」)。');
    }
  }, 600);
}
$('#btn-print').addEventListener('click', doPrint);

init().catch((err) => {
  console.error(err);
  $('#ex-overview').innerHTML = `<p class="empty">加载失败:${esc(err.message)}</p>`;
});
