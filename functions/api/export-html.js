// 行程导出 HTML API:
//   POST /api/export-html → 按专辑/日期区间 + 逐个条目导出选择,生成自包含 HTML 文件下载(离线可看,照片走线上 URL)
// 参数与 /api/share 一致:album/from/to/inc(条目 key 逗号串)/inc_todo(待办 key 逗号串);字段缺席=全选
import { verifySession } from '../_lib/auth.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 60;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* 导出文件名:有专辑名用专辑名,否则起止日期+标识(不用随机/当天名) */
function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

/* 逐个条目导出选择:inc/inc_todo 逗号分隔 key(date|ts / date|sort|id);
 * 表单未提供该字段 → null(全选,旧客户端兼容);提供空串 → 一个都不导出 */
function parseKeys(form, name) {
  if (!form || !form.has(name)) return null;
  const s = (form.get(name) || '').trim();
  return new Set(s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);
}

/* 过滤:专辑/日期区间 + 逐个条目导出勾选(incSet 为 null 则全选) */
function filterEntries(list, album, from, to, incSet) {
  return list
    .filter((e) => {
      if (album && e.album !== album) return false;
      if (from && to && (e.date < from || e.date > to)) return false;
      if (incSet) return incSet.has(`${e.date}|${e.ts}`);
      return true;
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.ts || 0) - (b.ts || 0)));
}

function normEntry(e) {
  let location = null;
  try { location = e.location ? JSON.parse(e.location) : null; } catch { location = null; }
  let photos = [];
  try { photos = JSON.parse(e.photos || '[]'); } catch { photos = []; }
  return {
    date: e.date || '', title: e.title || '', text: e.text || '', album: e.album || null,
    author: e.author || null, location, ts: e.ts ?? null, photos,
    visibility: e.visibility || 'public', created_at: e.created_at || null,
  };
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function thumbUrl(p) { return p.replace(/\.(jpg|jpeg|png)$/i, '-thumb.$1'); }

/* photos 数组元素已是 /photos/... 绝对路径(勿再加 /photos/ 前缀,曾拼成 photos/photos 404) */
function photoSrc(p, origin) {
  const rel = p.startsWith('/') ? p : `/${p}`;
  return `${origin}${rel}`;
}

export async function onRequestPost(context) {
  const user = await verifySession(context.env, context.request);
  if (!user) return Response.json({ error: '请先登录' }, { status: 401 });

  const form = await context.request.formData().catch(() => null);
  if (!form) return Response.json({ error: '缺少表单数据' }, { status: 400 });

  const album = (form.get('album') || '').trim();
  const from = (form.get('from') || '').trim();
  const to = (form.get('to') || '').trim();
  const fromOk = DATE_RE.test(from);
  const toOk = DATE_RE.test(to);
  const rangeOk = fromOk && toOk && from <= to;
  if (!album && !rangeOk) return Response.json({ error: '请选择专辑,或选择起止日期(可都选叠加)' }, { status: 400 });
  if ((from || to) && !rangeOk) return Response.json({ error: '起始/结束日期需成对且起始不晚于结束' }, { status: 400 });
  if (rangeOk) {
    const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
    if (days > MAX_RANGE_DAYS) return Response.json({ error: '区间最多 60 天' }, { status: 400 });
  }

  const incSet = parseKeys(form, 'inc');
  const incTodoSet = parseKeys(form, 'inc_todo');
  const { results: entryRows } = await context.env.DB.prepare('SELECT * FROM entries').all();
  const entries = filterEntries((entryRows || []).map(normEntry), album || null, rangeOk ? from : null, rangeOk ? to : null, incSet);

  let todos = [];
  if (rangeOk) {
    const { results: todoRows } = await context.env.DB
      .prepare('SELECT id, date, text, done, sort_order, checkin_ts FROM todos ORDER BY date ASC, sort_order ASC, id ASC')
      .all();
    todos = (todoRows || []).filter((t) => t.date >= from && t.date <= to && (incTodoSet ? incTodoSet.has(`${t.date}|${t.sort_order}|${t.id}`) : true));
  }

  const origin = new URL(context.request.url).origin;

  // ---- 渲染 HTML ----
  const condParts = [];
  if (album) condParts.push(`专辑：${esc(album)}`);
  if (rangeOk) condParts.push(`${esc(from)} ~ ${esc(to)}`);
  if (!condParts.length) condParts.push('全部内容');

  // 按日期分组
  const byDate = {};
  for (const e of entries) (byDate[e.date] = byDate[e.date] || []).push(e);
  const dateKeys = Object.keys(byDate).sort();

  const entriesHtml = dateKeys.map((d) => `
    <div class="date-head">${esc(d)}</div>
    ${byDate[d].map((e) => {
      const meta = [];
      if (e.ts) meta.push(esc(fmtTime(e.ts)));
      if (e.author) meta.push(esc(e.author));
      meta.push(e.visibility === 'private' ? '私有' : '公开');
      if (e.album) meta.push(esc(e.album));
      if (e.location && e.location.name) meta.push(`📍 ${esc(String(e.location.name).split(/[,，]/)[0])}`);
      const photos = (e.photos || []).map((p) => `<img src="${esc(photoSrc(thumbUrl(p), origin))}" data-full="${esc(photoSrc(p, origin))}" loading="lazy" alt="照片">`).join('');
      return `
      <div class="item">
        <div class="meta">${meta.join(' · ')}</div>
        <div class="title">${esc(e.title || '')}</div>
        ${e.text ? `<div class="text">${esc(e.text).replace(/\n/g, '<br>')}</div>` : ''}
        ${photos ? `<div class="photos">${photos}</div>` : ''}
      </div>`;
    }).join('')}
  `).join('');

  const todosHtml = todos.length ? `
    <div class="date-head">待办</div>
    ${todos.map((t) => `<div class="item"><div class="meta">${esc(t.date)}${t.done ? ' · 已完成 ✅' : ' · 未完成'}</div><div class="title">${esc(t.text)}</div></div>`).join('')}
  ` : '';

  // 标题:专辑名/日期区间/兜底,加粗
  const docTitle = album || (rangeOk ? `${from} ~ ${to}` : '咕咕嘎嘎 · 行程导出');

  // 地图数据:有条目坐标的点(标题/日期已 esc,防 </script> 注入)
  const mapPts = entries
    .filter((e) => e.location && e.location.lat != null && e.location.lng != null)
    .map((e) => ({ lat: Number(e.location.lat), lng: Number(e.location.lng), t: esc(e.title || ''), d: esc(e.date), h: e.ts ? esc(fmtTime(e.ts)) : '' }));

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(docTitle)} · 咕咕嘎嘎</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css">
<script src="https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js"></script>
<style>
  body { margin: 0; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2937; background: #f5f5f7; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 16px; }
  header { background: #111827; color: #fff; padding: 18px 16px; }
  header h1 { margin: 0; font-size: 1.3rem; font-weight: 800; }
  header .sub { font-size: 0.8rem; color: #9ca3af; margin-top: 4px; }
  #map { height: 240px; border-radius: 10px; margin: 12px 0; z-index: 0; }
  .date-head { font-weight: 700; font-size: 0.9rem; margin: 16px 0 6px; display: flex; align-items: center; gap: 8px; }
  .date-head::after { content: ''; flex: 1; height: 1px; background: #e5e7eb; }
  .item { background: #fff; border-radius: 10px; padding: 12px; margin-bottom: 8px; }
  .item .meta { font-size: 0.75rem; color: #6b7280; margin-bottom: 4px; }
  .item .title { font-weight: 600; font-size: 1rem; }
  .item .text { font-size: 0.9rem; color: #374151; margin-top: 6px; white-space: pre-wrap; }
  .photos { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .photos img { width: 96px; height: 96px; object-fit: cover; border-radius: 8px; cursor: zoom-in; }
  #gg-lightbox { position: fixed; inset: 0; background: rgba(0,0,0,.92); display: none; align-items: center; justify-content: center; z-index: 9999; cursor: zoom-out; }
  #gg-lightbox:not([hidden]) { display: flex; }
  #gg-lightbox img { max-width: 94vw; max-height: 94vh; border-radius: 6px; }
  footer { text-align: center; color: #9ca3af; font-size: 0.75rem; padding: 20px 0; }
</style>
</head>
<body>
<header>
  <h1>${esc(docTitle)}</h1>
  <div class="sub">咕咕嘎嘎 · 共 ${entries.length} 条${todos.length ? ` · 待办 ${todos.length} 项` : ''}</div>
</header>
<div class="wrap">
  <div id="map"></div>
  ${entriesHtml}
  ${todosHtml}
  ${entries.length || todos.length ? '' : '<p style="text-align:center;color:#9ca3af;">没有符合条件的内容</p>'}
</div>
<footer>由咕咕嘎嘎生成</footer>
<div id="gg-lightbox" hidden><img id="gg-lightbox-img" alt="照片"></div>
<script>
(function () {
  var pts = ${JSON.stringify(mapPts)};
  var box = document.getElementById('map');
  if (!window.L || !pts.length) { if (box) box.style.display = 'none'; return; }
  var map = L.map(box).setView([35, 105], 5);
  L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
    maxZoom: 18,
    subdomains: ['1', '2', '3', '4'],
    attribution: '&copy; 高德地图',
  }).addTo(map);
  var marks = [];
  pts.forEach(function (p) {
    var mk = L.marker([p.lat, p.lng]).addTo(map);
    mk.bindPopup('<b>' + p.d + (p.h ? ' ' + p.h : '') + '</b> ' + p.t);
    marks.push(mk);
  });
  if (marks.length > 1) map.fitBounds(L.featureGroup(marks).getBounds(), { padding: [30, 30] });
  else map.setView([pts[0].lat, pts[0].lng], 14);
})();
</script>
<script>
// 照片放大预览:点缩略图看大图,点遮罩关闭
(function () {
  var lb = document.getElementById('gg-lightbox');
  var big = document.getElementById('gg-lightbox-img');
  if (!lb || !big) return;
  lb.addEventListener('click', function () { lb.hidden = true; });
  document.querySelectorAll('.photos img').forEach(function (im) {
    im.addEventListener('click', function () {
      big.src = im.getAttribute('data-full') || im.src;
      lb.hidden = false;
    });
  });
})();
</script>
</body>
</html>`;

  // 导出文件名:有专辑名用专辑名,否则起止日期+标识;不用随机/当天名
  let nameBase;
  if (album) nameBase = safeName(album);
  else if (rangeOk) nameBase = `${from}~${to}-行程`;
  else nameBase = '行程导出';
  const filename = encodeURIComponent(`咕咕嘎嘎-${nameBase}.html`);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="gugugaga-export.html"; filename*=UTF-8''${filename}`,
    },
  });
}
