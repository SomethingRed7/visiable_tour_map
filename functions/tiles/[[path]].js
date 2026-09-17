/* OSM 瓦片代理:GET /tiles/{z}/{x}/{y}.png
 *
 * 为什么需要:海外路线/相册用 OpenStreetMap 瓦片,但 tile.openstreetmap.org 在国内不可达
 * (用户 2026-09-17 反馈)。走本站代理后,浏览器只请求 gugugaga-viw.pages.dev(国内可达),
 * 由边缘节点去取图并缓存 —— 人在国内也能看新西兰的路线。
 *
 * 只做最小职责:校验参数 → 取上游 → 边缘缓存 → 原样回传图片。
 * User-Agent 按 OSM 瓦片使用政策要求标明来源;max-age 一周(瓦片内容基本不变)。
 */
const UPSTREAM = 'https://tile.openstreetmap.org';
const UA = 'gugugaga-tour-map/1.0 (+https://gugugaga-viw.pages.dev; family travel diary)';
const MAX_Z = 19;

export async function onRequestGet(context) {
  const parts = context.params.path;
  if (!Array.isArray(parts) || parts.length !== 3) return new Response('Not found', { status: 404 });
  const [zs, xs, yRaw] = parts;
  const ys = String(yRaw).replace(/\.png$/i, '');
  if (!/^\d{1,2}$/.test(zs) || !/^\d{1,9}$/.test(xs) || !/^\d{1,9}$/.test(ys) || !/\.png$/i.test(String(yRaw))) {
    return new Response('Not found', { status: 404 });
  }
  const z = Number(zs), x = Number(xs), y = Number(ys);
  const n = 2 ** z;
  if (z > MAX_Z || x >= n || y >= n) return new Response('Not found', { status: 404 });

  const upstream = `${UPSTREAM}/${z}/${x}/${y}.png`;

  // 边缘缓存:同一瓦片只回源一次
  const cache = caches.default;
  const cacheKey = new Request(upstream, { method: 'GET' });
  let res = await cache.match(cacheKey);
  if (!res) {
    const up = await fetch(upstream, { headers: { 'User-Agent': UA, Referer: 'https://gugugaga-viw.pages.dev/' } });
    if (!up.ok) return new Response('Upstream error', { status: 502 });
    res = new Response(up.body, {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Cache-Control': 'public, max-age=604800, immutable',
      },
    });
    context.waitUntil(cache.put(cacheKey, res.clone()));
  }
  const out = new Response(res.body, res);
  out.headers.set('Content-Type', 'image/png');
  return out;
}
