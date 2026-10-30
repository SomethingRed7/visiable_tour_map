/* /swjs —— Service Worker 的对外入口(注意:不是 /sw.js)
 *
 * 为什么走 Functions 而不是静态文件:
 *   Cloudflare Pages 的 _headers 在「多条规则命中同一路径」时是**拼接**而非覆盖,
 *   `/*.js` 的 max-age=2592000 会和 no-cache 拼在一起且排在前 → 浏览器把 sw.js 缓存 30 天
 *   → 以后再也更新不了 SW(等于焊死)。Functions 的响应不受 _headers 影响,可以精确控制。
 *   (试过 functions/sw.js/index.js 想要 /sw.js 这个路径,wrangler 没识别成路由,故改用 /swjs)
 *
 * 正文仍然维护在 public/sw.js,这里只负责取过来换头,免得 SW 代码被塞进字符串里。
 * ⚠️ 注册处见 public/app.js: navigator.serviceWorker.register('/swjs')
 */
export async function onRequestGet(context) {
  const src = new URL('/sw.js', context.request.url);
  const res = await fetch(src);

  if (!res.ok) {
    return new Response('// service worker source unavailable', {
      status: 503,
      headers: { 'Content-Type': 'application/javascript; charset=utf-8' },
    });
  }

  const body = await res.text();
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      // no-store:不留任何副本。SW 更新与否必须由浏览器每次来问,不能被缓存挡住
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
