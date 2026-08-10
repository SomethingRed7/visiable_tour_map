// 地理编码 API:GET /api/geocode?q=地名 | ?lat=&lng=(反向)
// 经 CF 边缘调 Nominatim(国内网络直连不可达)
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const q = url.searchParams.get('q');
  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');
  const ua = 'gugugaga-travel-diary/1.0 (personal use)';

  try {
    if (lat && lng && Number.isFinite(parseFloat(lat)) && Number.isFinite(parseFloat(lng))) {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}&accept-language=zh-CN`,
        { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return Response.json({ results: [] });
      const d = await res.json();
      return Response.json({
        results: [{ name: (d.display_name || '未知位置').slice(0, 80), lat: parseFloat(lat), lng: parseFloat(lng) }],
      });
    }
    if (q) {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=zh-CN&q=${encodeURIComponent(q)}`,
        { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return Response.json({ results: [] });
      const arr = await res.json();
      return Response.json({
        results: arr.map((a) => ({
          name: (a.display_name || '').slice(0, 80),
          lat: parseFloat(a.lat),
          lng: parseFloat(a.lon),
        })),
      });
    }
  } catch {
    return Response.json({ results: [] });
  }
  return Response.json({ results: [] });
}
