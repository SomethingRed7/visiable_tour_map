// 快照只读页 HTML 生成(共用)
// - /s/<token>    :Cloudflare 服务端渲染,response 头带 CSP(不嵌 meta)
// - share/<token>.html:github.io 静态快照(纯静态,无响应头 → CSP 走 meta,且须放行 pages.dev 的照片/API)
// 快照 JSON 注入前必须把 < 转义为 \u003c,防条目文本里出现 </script> 逃逸出数据块。
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildSnapshotHtml(snap, opts = {}) {
  const json = JSON.stringify(snap).replace(/</g, '\\u003c');
  // 页面标题:专辑名 → 日期区间 → 兜底(与导出 HTML 的 docTitle 一致)
  const docTitle = snap.album || (snap.from && snap.to ? `${snap.from} ~ ${snap.to}` : '');
  const title = docTitle ? `${docTitle} · 咕咕嘎嘎` : '行程分享 · 咕咕嘎嘎';
  const cspMeta = opts.cspMeta
    ? `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://cdn.jsdelivr.net https://webapi.amap.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: blob: https://*.is.autonavi.com https://*.amap.com https://gugugaga-viw.pages.dev; connect-src 'self' https://webapi.amap.com https://restapi.amap.com https://*.amap.com https://gugugaga-viw.pages.dev; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'">`
    : '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
${cspMeta}
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header class="site-header">
  <div class="header-main">
    <h1 class="site-title"><a href="/">咕咕嘎嘎</a></h1>
    <p class="site-subtitle">${esc(docTitle || '行程分享')}</p>
  </div>
</header>
<main class="layout">
  <section class="panel">
    <h2 class="panel-heading">地图路线</h2>
    <p class="manage-hint" id="sv-subtitle"></p>
    <p class="manage-hint" id="sv-meta"></p>
    <div id="sv-map" class="album-map"></div>
    <p id="sv-map-note" class="manage-hint"></p>
  </section>
  <section class="panel">
    <h2 class="panel-heading">行程总览</h2>
    <div id="sv-overview" class="entries"></div>
  </section>
</main>
<footer class="site-footer">咕咕嘎嘎 · 记录每一段在路上</footer>
<script type="application/json" id="snapshot-data">${json}</script>
<script src="/api.js"></script>
<script src="/loc-picker.js"></script>
<script src="/share-view.js"></script>
</body>
</html>`;
}
