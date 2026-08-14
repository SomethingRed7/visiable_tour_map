// 反查地名:GET /api/reverse?lat=..&lng=.. → {name, display}
// 服务端 Nominatim reverse(浏览器端高德 REST 与 JS key 平台不匹配,无法用)
// 失败返回 {name:null, display:null}(调用方回退坐标字符串)
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return Response.json({ error: '坐标不对' }, { status: 400 });
  }
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=zh-CN`,
      {
        headers: { 'User-Agent': 'gugugaga-travel-diary/1.0 (personal use)' },
        signal: AbortSignal.timeout(8000),
      }
    );
    if (res.ok) {
      const d = await res.json();
      const name = (d.display_name || '').split(',').slice(0, 3).join(',').trim();
      if (name) return Response.json({ name, display: (d.display_name || '').slice(0, 80) });
    }
  } catch { /* 超时/失败走回退 */ }
  return Response.json({ name: null, display: null });
}
