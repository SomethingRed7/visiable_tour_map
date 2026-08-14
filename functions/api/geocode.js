// 地理编码 API:GET /api/geocode?q=地名 | ?lat=&lng=(反向,含附近地点)
// 反向:配置了 AMAP_KEY 时用高德 regeo(与瓦片同源,POI 名一致,含附近 pois);
// 否则回退 Nominatim(反查)+ Overpass(nearby)——两者都是 OSM 数据,与高德瓦片不一致
const UA = 'gugugaga-travel-diary/1.0 (personal use)';

// 地点名截短:Nominatim 返回完整地址(逗号串),只保留第一段短名(如「杭州东站」)
function shortName(display) {
  const first = String(display || '').split(/[,，]/)[0].trim();
  if (first) return first.slice(0, 40);
  return String(display || '').slice(0, 40);
}

async function amapRegeo(env, lat, lng) {
  const key = env.AMAP_WEB_KEY || '';
  if (!key) return null;
  try {
    const res = await fetch(
      `https://restapi.amap.com/v3/geocode/regeo?key=${key}&location=${lng},${lat}&radius=300&extensions=all`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const d = await res.json();
    if (d.status !== '1' || !d.regeocode) return null;
    const pois = (d.regeocode.pois || [])
      .filter((p) => p && p.name)
      .sort((a, b) => parseFloat(a.distance || 99999) - parseFloat(b.distance || 99999))
      .slice(0, 6);
    const name = pois[0] ? pois[0].name : (d.regeocode.formatted_address || '自定义位置').slice(0, 80);
    const nearby = pois.slice(1).map((p) => {
      const [lngN, latN] = String(p.location || '').split(',').map(Number);
      return { name: p.name, lat: Number.isFinite(latN) ? latN : null, lng: Number.isFinite(lngN) ? lngN : null };
    });
    return { name: name.slice(0, 80), lat: parseFloat(lat), lng: parseFloat(lng), nearby };
  } catch { return null; }
}
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

  try {
    if (lat && lng && Number.isFinite(parseFloat(lat)) && Number.isFinite(parseFloat(lng))) {
      // 优先高德 regeo(与瓦片同源);失败回退 Nominatim+Overpass
      const amap = await amapRegeo(context.env, lat, lng);
      if (amap) return Response.json({ results: [amap] });

      const [revSettled, nearby] = await Promise.allSettled([
        fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=17&accept-language=zh-CN`,
          { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) }
        ),
        nearbyOverpass(lat, lng),
      ]);
      // allSettled:一方失败不影响另一方(本地 Nominatim 被墙时 Overpass 仍可用)
      let name = '自定义位置';
      if (revSettled.status === 'fulfilled' && revSettled.value.ok) {
        const d = await revSettled.value.json();
        if (d && d.display_name) name = shortName(d.display_name);
      }
      const nearbyList = nearby.status === 'fulfilled' ? nearby.value : [];
      return Response.json({ results: [{ name, lat: parseFloat(lat), lng: parseFloat(lng), nearby: nearbyList }] });
    }

    if (q) {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=zh-CN&q=${encodeURIComponent(q)}`,
        { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) }
      );
      if (!res.ok) return Response.json({ results: [] });
      const arr = await res.json();
      return Response.json({ results: arr.map((a) => ({ name: a.display_name?.slice(0, 80), lat: parseFloat(a.lat), lng: parseFloat(a.lon) })) });
    }
  } catch { /* 兜底 */ }

  return Response.json({ results: [] });
}
