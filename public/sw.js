/* 咕咕嘎嘎 Service Worker
 *
 * 为什么需要:pages.dev 在国内没有边缘节点,每次打开都要跨境拉 HTML(实测 0.8~6.5s)。
 * SW 把 HTML 和静态资源留在本地,第二次打开连请求都不用发。
 *
 * 策略(刻意保守):
 *  - 导航(HTML):network-first,1.5s 内没回来就用缓存 —— 宁可看旧一版,也不让人对着白屏等
 *  - /vendor/ + *.js/*.css:stale-while-revalidate —— 这些 URL 带 ?v= 版本号,内容变了 URL 就变了
 *  - /api/*:完全不拦截。数据语义 app.js 的 localStorage 层更清楚,SW 碰了只会出乱子
 *  - /tiles/*、/photos/*:不拦截。它们本身已有 7 天 HTTP 缓存,SW 再存一层纯属浪费
 *
 * ⚠️ 改这里的逻辑必须 bump VERSION,否则老 SW 不会退场。
 * ⚠️ /sw.js 自己的响应头必须是 no-cache(_headers 里单独写了),否则浏览器永远拿不到新版本。
 */

const VERSION = 'gg-sw-20261030a';
const HTML_CACHE = VERSION + '-html';
const ASSET_CACHE = VERSION + '-asset';
// HTML 只留一份:主页面和 ?date=xxx 返回的是同一份 HTML,不必按 query 分开存
const SHELL_KEY = '/__gg_shell';
const HTML_TIMEOUT_MS = 1500;

self.addEventListener('install', () => {
  // 新版立刻接手,不等所有 tab 关掉(家庭自用场景,不需要灰度)
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

function isAsset(url) {
  return (
    url.pathname.startsWith('/vendor/') ||
    /\.(js|css)$/i.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }
  if (url.origin !== self.location.origin) return;   // 高德/瓦片/照片 CDN 一律不管
  if (url.pathname.startsWith('/api/')) return;       // 数据交给页面自己缓存
  if (url.pathname.startsWith('/tiles/')) return;     // 已有 7 天 HTTP 缓存
  if (url.pathname.startsWith('/photos/')) return;

  if (req.mode === 'navigate') {
    event.respondWith(htmlNetworkFirst(req));
    return;
  }
  if (isAsset(url)) {
    event.respondWith(assetStaleWhileRevalidate(req));
  }
});

/* 页面:网络优先,超时回退缓存。
 * 网络回来后即使已经用缓存响应了,也顺手把新 HTML 存下来,下次打开就是新的。 */
async function htmlNetworkFirst(req) {
  let cache;
  try { cache = await caches.open(HTML_CACHE); } catch { return fetch(req); }

  const cached = await cache.match(SHELL_KEY).catch(() => null);

  const network = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(SHELL_KEY, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => null);

  if (!cached) {
    const res = await network;
    return res || new Response('离线了,连不上咕咕嘎嘎', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  // 有缓存:谁先到用谁(网络 1.5s 内没回就用缓存,后台继续等网络)
  const timeout = new Promise((resolve) => setTimeout(() => resolve(null), HTML_TIMEOUT_MS));
  const winner = await Promise.race([network, timeout]);
  if (winner) return winner;
  network.then((res) => { if (res) cache.put(SHELL_KEY, res.clone()).catch(() => {}); });
  return cached;
}

/* 静态资源:先给缓存,同时后台拉新的存起来。
 * URL 带 ?v= 版本号,所以「缓存住了就永远旧」这件事不会发生 —— 改文件时会改 URL。 */
async function assetStaleWhileRevalidate(req) {
  let cache;
  try { cache = await caches.open(ASSET_CACHE); } catch { return fetch(req); }

  const cached = await cache.match(req).catch(() => null);
  const network = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => null);

  if (cached) {
    network.catch(() => {});   // 后台更新失败无所谓
    return cached;
  }
  const fresh = await network;
  return fresh || new Response('', { status: 504 });
}
