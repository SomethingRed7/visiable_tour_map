// 地理编码 API:GET /api/geocode?q=地名 | ?lat=&lng=(反向,含附近地点)
// 经 CF 边缘调 Nominatim/Overpass(国内网络直连不可达)
// 注意:Nominatim 反查返回的是 OSM 最近命名节点(常是星巴克/小区名),与高德瓦片上的
// POI 标签不一致——所以反向结果附带 nearby(Overpass 周边命名建筑/场所)供前端点选
async function nearbyOverpass(lat, lng) {
  // 注意:around:400 在高密度城区会返回超大结果导致 overpass 服务端报错(实测),
  // 300m + relation 子句是稳定可用的形态
  const q = `[out:json][timeout:12];(way["name"](around:300,${lat},${lng});node["name"](around:300,${lat},${lng});relation["name"](around:300,${lat},${lng}););out center tags 40;`;
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'gugugaga-travel-diary/1.0 (personal use)' },
      body: 'data=' + encodeURIComponent(q),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return [];
    const d = await res.json();
    const seen = new Set();
    const out = [];
    for (const e of d.elements || []) {
      const tags = e.tags || {};
      const name = (tags.name || '').trim();
      if (!name || seen.has(name)) continue;
      const t = tags.building || tags.amenity || tags.shop || tags.office || tags.leisure || tags.tourism || tags.craft || '';
      if (!t) continue; // 只留建筑/场所,排除街道等
      const latN = e.lat ?? (e.center || {}).lat;
      const lngN = e.lon ?? (e.center || {}).lon;
      if (latN == null || lngN == null) continue;
      seen.add(name);
      out.push({ name, lat: latN, lng: lngN });
      if (out.length >= 6) break;
    }
    return out;
  } catch { return []; }
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const q = url.searchParams.get('q');
  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');
  const ua = 'gugugaga-travel-diary/1.0 (personal use)';

  try {
    if (lat && lng && Number.isFinite(parseFloat(lat)) && Number.isFinite(parseFloat(lng))) {
      const [revSettled, nearby] = await Promise.allSettled([
        fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=17&accept-language=zh-CN`,
          { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(8000) }
        ),
        nearbyOverpass(lat, lng),
      ]);
      // allSettled:一方失败不影响另一方(本地 Nominatim 被墙时 Overpass 仍可用)
      let name = '自定义位置';
      if (revSettled.status === 'fulfilled' && revSettled.value.ok) {
        const d = await revSettled.value.json();
        if (d && d.display_name) name = d.display_name.slice(0, 80);
      }
      const nearbyList = nearby.status === 'fulfilled' ? nearby.value : [];
      return Response.json({ results: [{ name, lat: parseFloat(lat), lng: parseFloat(lng), nearby: nearbyList }] });
    }

    if (q) {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=zh-CN&q=${encodeURIComponent(q)}`,
        { headers: { 'User-Agent': ua }, signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return Response.json({ results: [] });
      const arr = await res.json();
      return Response.json({ results: arr.map((a) => ({ name: a.display_name?.slice(0, 80), lat: parseFloat(a.lat), lng: parseFloat(a.lon) })) });
    }
  } catch { /* 兜底 */ }

  return Response.json({ results: [] });
}
