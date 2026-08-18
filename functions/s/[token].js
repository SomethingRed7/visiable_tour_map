// /s/<token> 公开快照渲染页(免登录,家人访问入口)
// 读取 KV share:<token>,渲染只读页面:冻结内容以 JSON 注入(script type=application/json,数据块不受 CSP script-src 限制),
// 渲染逻辑在 public/share-view.js(外部脚本,CSP 合规)。未知/已删 token → 404 提示页。
// 注意:快照 JSON 注入前必须把 < 转义为 \u003c,防条目文本里出现 </script> 逃逸出数据块。
const CSP = "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net https://webapi.amap.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: blob: https://*.is.autonavi.com https://*.amap.com; connect-src 'self' https://webapi.amap.com https://restapi.amap.com https://*.amap.com; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

function htmlPage(title, mainHtml, extraHead, extraScripts) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<link rel="stylesheet" href="/style.css">
${extraHead || ''}
</head>
<body>
${mainHtml}
${extraScripts || ''}
</body>
</html>`;
}

function snapshotPage(snap) {
  const json = JSON.stringify(snap).replace(/</g, '\\u003c');
  const main = `<header class="site-header">
  <div class="header-main">
    <h1 class="site-title"><a href="/">咕咕嘎嘎</a></h1>
    <p class="site-subtitle">行程分享</p>
  </div>
</header>
<main class="layout">
  <section class="panel">
    <h2 class="panel-heading">行程总览</h2>
    <p class="manage-hint" id="sv-subtitle"></p>
    <p class="manage-hint" id="sv-meta"></p>
    <div id="sv-overview" class="entries"></div>
  </section>
  <section class="panel">
    <h2 class="panel-heading">地图路线</h2>
    <div id="sv-map" class="album-map"></div>
    <p id="sv-map-note" class="manage-hint"></p>
  </section>
</main>
<footer class="site-footer">咕咕嘎嘎 · 记录每一段在路上</footer>
<script type="application/json" id="snapshot-data">${json}</script>`;
  const scripts = `<script src="/loc-picker.js"></script>
<script src="/share-view.js"></script>`;
  return htmlPage('行程分享 · 咕咕嘎嘎', main, '', scripts);
}

function notFoundPage() {
  const main = `<header class="site-header">
  <div class="header-main">
    <h1 class="site-title"><a href="/">咕咕嘎嘎</a></h1>
    <p class="site-subtitle">行程分享</p>
  </div>
</header>
<main class="layout">
  <section class="panel">
    <h2 class="panel-heading">分享不存在</h2>
    <p class="manage-hint">这个分享链接不存在或已被删除。可以回到首页看看,或联系分享给你的人确认链接。</p>
    <p><a class="btn-write" href="/">← 回首页</a></p>
  </section>
</main>`;
  return htmlPage('分享不存在 · 咕咕嘎嘎', main, '', '');
}

export async function onRequestGet(context) {
  const token = context.params.token || '';
  if (!/^[a-z0-9]{8}$/.test(token)) {
    return new Response(notFoundPage(), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP } });
  }
  const raw = await context.env.ENTRIES.get(`share:${token}`);
  if (!raw) {
    return new Response(notFoundPage(), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP } });
  }
  let snap;
  try { snap = JSON.parse(raw); } catch {
    return new Response(notFoundPage(), { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP } });
  }
  return new Response(snapshotPage(snap), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': CSP,
      'Cache-Control': 'public, max-age=300',
    },
  });
}
