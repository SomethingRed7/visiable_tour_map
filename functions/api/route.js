// 路线 API:GET /api/route?pts=lat,lng|lat,lng|...&profile=driving|walking
// 返回 { coordinates: [[lat,lng],...](GCJ-02), source: 'amap:driving'|'amap:walking'|'straight' }
// ⚠️ 2026-08 起改用高德 v3/direction(国内稳定,OSRM router.project-osrm.org 在国外频繁不可达
// 导致一直回退直线;高德返回 GCJ-02 直接匹配瓦片,无需坐标转换)
// driving/walking 均支持 waypoints(经度,纬度;经度,纬度 分号分隔,最多16个)
const MAX_POINTS = 250;

// 解析高德路径 steps 的 polyline(每步 "lng,lat;lng,lat;...",步骤间独立)
function parseSteps(steps) {
  const out = [];
  for (const s of steps || []) {
    const pl = s && s.polyline ? String(s.polyline) : '';
    for (const seg of pl.split(';')) {
      const [lng, lat] = seg.split(',').map(Number);
      if (Number.isFinite(lat) && Number.isFinite(lng)) out.push([lat, lng]);
    }
  }
  return out;
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const ptsRaw = url.searchParams.get('pts') || '';
  const profile = url.searchParams.get('profile') || 'driving';
  const pts = ptsRaw
    .split('|')
    .map((s) => {
      const [lat, lng] = s.split(',').map(Number);
      return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
    })
    .filter(Boolean);

  if (pts.length < 2) return Response.json({ coordinates: null, source: 'none' });

  const key = context.env.AMAP_WEB_KEY || '';
  const safe = profile === 'walking' ? 'walking' : 'driving';
  // 高德 direction:origin/destination 用 "经度,纬度";waypoints 用分号分隔
  const origin = `${pts[0][1]},${pts[0][0]}`;
  const dest = `${pts[pts.length - 1][1]},${pts[pts.length - 1][0]}`;
  const wps = pts.slice(1, -1).map((p) => `${p[1]},${p[0]}`).join(';');

  try {
    const q = new URLSearchParams({
      key,
      origin,
      destination: dest,
      extensions: 'all',
    });
    if (wps) q.set('waypoints', wps);
    const res = await fetch(`https://restapi.amap.com/v3/direction/${safe}?${q.toString()}`, {
      signal: AbortSignal.timeout(12000),
    });
    if (res.ok) {
      const d = await res.json();
      if (d.status === '1' && d.route && d.route.paths && d.route.paths.length) {
        const line = parseSteps(d.route.paths[0].steps);
        if (line.length > 1) {
          // 抽稀控制体积
          const step = Math.max(1, Math.ceil(line.length / MAX_POINTS));
          const out = [];
          for (let i = 0; i < line.length; i += step) out.push(line[i]);
          return Response.json({ coordinates: out, source: `amap:${safe}` });
        }
      }
    }
  } catch { /* 回退 */ }

  return Response.json({ coordinates: pts, source: 'straight' });
}
