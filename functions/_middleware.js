// 跨域中间件:前端托管在 github.io,需允许其调用本 API。
// 仅对已知前端源返回 Access-Control-Allow-Origin;同源(pages.dev 本地/dev)请求本就无需 CORS,原样放行。
// 处理 OPTIONS 预检(写接口带 Authorization 头会触发预检)。
const ALLOWED_ORIGINS = [
  'https://somethingred7.github.io',
  'http://localhost:8788',
  'http://127.0.0.1:8788',
  'http://localhost:8787',
  'http://127.0.0.1:8787',
];

function corsHeaders(origin) {
  const h = {
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
  }
  return h;
}

export async function onRequest(context) {
  const origin = context.request.headers.get('Origin');
  if (context.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  const res = await context.next();
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(origin))) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
