// /s/<token> 公开快照渲染页(免登录,家人访问入口)
// 读取 KV share:<token>,渲染只读页面;渲染逻辑在 public/share-view.js。
// 未知/已删 token → 404 提示页。
// 注意:CSP 由响应头提供;静态快照(github.io share/<token>.html)由 /api/share 生成,见 _lib/snapshot.js。
import { buildSnapshotHtml } from '../_lib/snapshot.js';

// 快照页 = 门户样式(/style.css + share-view.js 同源渲染),CSP 放行 leaflet CDN + 高德瓦片
const CSP = "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net https://webapi.amap.com; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: blob: https://*.is.autonavi.com https://*.amap.com; connect-src 'self' https://webapi.amap.com https://restapi.amap.com https://*.amap.com; font-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";

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
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>分享不存在 · 咕咕嘎嘎</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
${main}
</body>
</html>`;
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
  return new Response(buildSnapshotHtml(snap, { origin: new URL(context.request.url).origin }), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': CSP,
      'Cache-Control': 'public, max-age=300',
    },
  });
}
