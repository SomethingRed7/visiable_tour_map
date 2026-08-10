// 路线 API:GET /api/route?pts=lat,lng|lat,lng|... → OSRM 真实道路折线
// 返回 { coordinates: [[lat,lng],...], source: 'osrm'|'straight' }
// 国内浏览器直连 router.project-osrm.org 不可达 → 走 CF 边缘代理(与 Nominatim geocode 同理)
// 抽稀到 MAX_POINTS 控制分享页体积;OSRM 失败/点位不足回退直线
const MAX_POINTS = 250;

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const ptsRaw = url.searchParams.get('pts') || '';
  const pts = ptsRaw
    .split('|')
    .map((s) => {
      const [lat, lng] = s.split(',').map(Number);
      return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
    })
    .filter(Boolean);

  if (pts.length < 2) return Response.json({ coordinates: null, source: 'none' });

  const coords = pts.map(([lat, lng]) => `${lng},${lat}`).join(';');
  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&steps=false`,
      { signal: AbortSignal.timeout(12000) }
    );
    if (res.ok) {
      const data = await res.json();
      const line = data.routes && data.routes[0] && data.routes[0].geometry;
      if (line && line.coordinates && line.coordinates.length > 1) {
        // GeoJSON 坐标是 [lng,lat],转 [lat,lng] 并抽稀
        const raw = line.coordinates;
        const step = Math.max(1, Math.ceil(raw.length / MAX_POINTS));
        const out = [];
        for (let i = 0; i < raw.length; i += step) out.push([raw[i][1], raw[i][0]]);
        return Response.json({ coordinates: out, source: 'osrm' });
      }
    }
  } catch { /* 回退 */ }

  return Response.json({ coordinates: pts, source: 'straight' });
}
