// 快照只读页 HTML 生成(共用)
// - /s/<token>        :Cloudflare 服务端渲染(响应头带 CSP)
// - share/<token>.html:github.io 静态快照(纯静态,CSP 走 meta)
// 与导出 HTML(export-html.js)同款样式:服务端渲染条目 + Leaflet(高德瓦片)地图,自包含无外部门户依赖。
// 照片用绝对地址指向 pages.dev,github.io 静态页也能直读。
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function thumbUrl(p) { return p.replace(/\.(jpg|jpeg|png)$/i, '-thumb.$1'); }

// 照片绝对地址(pages.dev),与导出页一致
function photoSrc(p, origin) {
  const rel = p.startsWith('/') ? p : `/${p}`;
  return `${origin}${rel}`;
}

export function buildSnapshotHtml(snap, opts = {}) {
  const origin = opts.origin || 'https://gugugaga-viw.pages.dev';
  const entries = snap.entries || [];
  const todos = snap.todos || [];

  // 页面标题:专辑名 → 日期区间 → 兜底(与导出 HTML 的 docTitle 一致)
  const docTitle = snap.album || (snap.from && snap.to ? `${snap.from} ~ ${snap.to}` : '');
  const title = docTitle ? `${docTitle} · 咕咕嘎嘎` : '行程分享 · 咕咕嘎嘎';

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

  // 地图数据点(标题/日期已 esc,防 </script> 注入)
  const mapPts = entries
    .filter((e) => e.location && e.location.lat != null && e.location.lng != null)
    .map((e) => ({ lat: Number(e.location.lat), lng: Number(e.location.lng), t: esc(e.title || ''), d: esc(e.date), h: e.ts ? esc(fmtTime(e.ts)) : '' }));

  const hasContent = entries.length || todos.length;

  // 静态快照(github.io)无响应头,CSP 走 meta:放行 leaflet CDN / 高德瓦片 / pages.dev 照片 / 内联脚本样式
  const cspMeta = opts.cspMeta
    ? `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: blob: https://*.is.autonavi.com https://cdn.jsdelivr.net https://gugugaga-viw.pages.dev; connect-src 'self' https://cdn.jsdelivr.net https://gugugaga-viw.pages.dev; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'">`
    : '';

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
${cspMeta}
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
  .photos img { width: 96px; height: 96px; object-fit: cover; border-radius: 8px; cursor: pointer; }
  footer { text-align: center; color: #9ca3af; font-size: 0.75rem; padding: 20px 0; }
</style>
</head>
<body>
<header>
  <h1>${esc(docTitle || '行程分享')}</h1>
  <div class="sub">咕咕嘎嘎 · 共 ${entries.length} 条${todos.length ? ` · 待办 ${todos.length} 项` : ''}</div>
</header>
<div class="wrap">
  <div id="map"></div>
  ${entriesHtml}
  ${todosHtml}
  ${hasContent ? '' : '<p style="text-align:center;color:#9ca3af;">这个分享里还没有内容</p>'}
</div>
<footer>由咕咕嘎嘎生成</footer>
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
</body>
</html>`;
}
