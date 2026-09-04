// 地理编码 API:GET /api/geocode?q=地名 | ?lat=&lng=(反向)
// 反向:Nominatim → Photon(免 key 限流宽松,有 UA)→ BigDataCloud(中文结果)
// 简化稳健版:每步独立 try/catch,绝不互相牵连
const UA = 'gugugaga-travel-diary/1.0 (personal use)';
const _geoCache = new Map();
const _geoCacheKey = (la, ln) => `${Number(la).toFixed(4)},${Number(ln).toFixed(4)}`;
function _geoCacheGet(la, ln) {
  const e = _geoCache.get(_geoCacheKey(la, ln));
  return e && (Date.now() - e.t) < 3600e3 ? e.v : null;
}
function _geoCachePut(la, ln, v) { _geoCache.set(_geoCacheKey(la, ln), { v, t: Date.now() }); }

// 国家级粗判(同 loc-picker.inChina,避免重复转换):海外走 Photon 按 lat/lon 偏好,
// 国内 Nominatim + city 兜底,品牌搜索不再跑到地球另一边
function inChina(lat, lng) { return lng > 73 && lng < 136 && lat > 3 && lat < 55; }

function shortName(display) {
  const first = String(display || '').split(/[,，]/)[0].trim();
  return (first || String(display || '')).slice(0, 40);
}

async function nominatimReverse(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=17&addressdetails=1&accept-language=zh`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d) return null;
    const a = d.address || {};
    return a.attraction || a.amenity || a.shop || a.tourism || a.building || a.house_name
      || a.road || a.neighbourhood || a.suburb || a.village || a.hamlet || a.town || a.city || a.county
      || (d.display_name ? shortName(d.display_name) : null)
      || null;
  } catch { return null; }
}

async function photonReverse(lat, lng) {
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lon=${lng}&lat=${lat}`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    const f = d && d.features && d.features[0];
    if (!f) return null;
    const p = f.properties || {};
    return p.locality || p.name || p.street || p.suburb || p.village || p.neighbourhood || p.district || p.city || p.county || p.state || null;
  } catch { return null; }
}

async function bigDataCloudReverse(lat, lng) {
  try {
    const res = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=zh`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d) return null;
    return d.locality || d.city || d.principalSubdivision || d.countryName || null;
  } catch { return null; }
}

/* 附近 POI(优先 Photon,稳;Overpass 兜底)
 * 返回 top 5(name+lat+lng+crs:wgs),调用方按距离/有分类排,最近 POI 用作主名
 * (Nominatim 常只返 road 把店名盖住)。Photon 的 reverse?limit=N 直接给 POI 排序好的列表 */
async function photonNearby(lat, lng) {
  try {
    const res = await fetch(`https://photon.komoot.io/reverse?lon=${lng}&lat=${lat}&limit=10`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return [];
    const d = await res.json();
    const seen = new Set();
    const all = [];
    for (const f of (d.features || [])) {
      const p = f.properties || {};
      const name = (p.name || p.street || '').trim();
      if (!name || seen.has(name)) continue;
      const c = (f.geometry || {}).coordinates || [];
      const flng = c[0]; const flat = c[1];
      if (flat == null || flng == null) continue;
      const osmKey = p.osm_key || '';
      const osmValue = p.osm_value || '';
      // 过滤:路名(highway)和纯路牌;保留 amenity/shop/tourism/building/office/place 等
      if (osmKey === 'highway') continue;
      if (osmKey === 'place' && osmValue === 'house') continue;
      const hasCat = ['amenity', 'shop', 'tourism', 'building', 'leisure', 'office', 'craft'].includes(osmKey);
      const dist = Math.hypot(flat - lat, flng - lng);
      seen.add(name);
      all.push({ name, lat: flat, lng: flng, osmKey, osmValue, hasCat, dist });
    }
    // 有分类优先(POI/店/楼),同优先级按距离近;同名同距稳定排序
    all.sort((a, b) => (b.hasCat - a.hasCat) || (a.dist - b.dist) || a.name.localeCompare(b.name));
    return all.slice(0, 5).map((p) => ({ name: p.name, lat: p.lat, lng: p.lng, crs: 'wgs' }));
  } catch { return []; }
}

/* Photon forward 搜索(按 lat/lon 距离偏好 — 海外品牌关键:NZ 搜 pak'n save 不再跑到加州)
 * 返回 [{name, lat, lng}] —— name = 名字 + 城市/区域(去重) */
async function photonSearch(q, lat, lng) {
  try {
    const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lat=${lat}&lon=${lng}&limit=8&lang=en`, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return [];
    const d = await res.json();
    const out = [];
    const seen = new Set();
    for (const f of (d.features || [])) {
      const p = f.properties || {};
      const name = (p.name || '').trim();
      if (!name || seen.has(name)) continue;
      const c = (f.geometry || {}).coordinates || [];
      const flat = c[1]; const flng = c[0];
      if (flat == null || flng == null) continue;
      const placeBits = [];
      if (p.city && p.city !== name) placeBits.push(p.city);
      else if (p.town) placeBits.push(p.town);
      else if (p.village) placeBits.push(p.village);
      else if (p.suburb) placeBits.push(p.suburb);
      else if (p.state && p.state !== name) placeBits.push(p.state);
      const display = placeBits.length ? `${name}, ${placeBits.join(', ')}` : name;
      seen.add(name);
      out.push({ name: display.slice(0, 80), lat: flat, lng: flng });
    }
    return out;
  } catch { return []; }
}

/* Overpass 附近 POI 兜底(Photon 限流时),并发三镜像任一成功即返回 */
const _overpassMirrors = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
async function _overpassFetchOnce(url, q, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(q),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error('http ' + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}
async function overpassNearby(lat, lng) {
  const q = `[out:json][timeout:8];(node["name"](around:120,${lat},${lng});way["name"](around:120,${lat},${lng});relation["name"](around:120,${lat},${lng}););out center tags 40;`;
  let d = null;
  try {
    d = await Promise.any(_overpassMirrors.map((u, i) => _overpassFetchOnce(u, q, [8000, 14000, 14000][i])));
  } catch { return []; }
  if (!d) return [];
  const seen = new Set();
  const all = [];
  for (const e of (d.elements || [])) {
    const t = e.tags || {};
    const name = (t.name || '').trim();
    if (!name || seen.has(name)) continue;
    if (t.highway) continue; // 过滤路名
    const elat = e.lat ?? (e.center || {}).lat;
    const elng = e.lon ?? (e.center || {}).lon;
    if (elat == null || elng == null) continue;
    const hasCat = !!(t.amenity || t.shop || t.tourism || t.building || t.leisure || t.office || t.craft);
    const dist = Math.hypot(elat - lat, elng - lng);
    seen.add(name);
    all.push({ name, lat: elat, lng: elng, hasCat, dist });
  }
  all.sort((a, b) => (b.hasCat - a.hasCat) || (a.dist - b.dist) || a.name.localeCompare(b.name));
  return all.slice(0, 5).map((p) => ({ name: p.name, lat: p.lat, lng: p.lng, crs: 'wgs' }));
}

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const q = url.searchParams.get('q');
    const lat = url.searchParams.get('lat');
    const lng = url.searchParams.get('lng');

    // 路由优先级:forward(q) 优先于 reverse(lat+lng);否则 q 被忽略,只返反向名(2026-09 bug)
    if (q) {
      const qlat = parseFloat(lat), qlng = parseFloat(lng);
      const hasCoords = Number.isFinite(qlat) && Number.isFinite(qlng);
      // 海外 + 有坐标 → Photon 按 lat/lon 距离偏好(关键:搜 NZ 品牌不再返回加州同名店)
      if (hasCoords && !inChina(qlat, qlng)) {
        const ps = await photonSearch(q, qlat, qlng);
        if (ps.length) return Response.json({ results: ps });
      }
      // 兜底 Nominatim 搜索(国内或无坐标)
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=zh&q=${encodeURIComponent(q)}`, {
          headers: { 'User-Agent': UA },
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const arr = await res.json();
          return Response.json({ results: (arr || []).map((a) => ({ name: a.display_name?.slice(0, 80), lat: parseFloat(a.lat), lng: parseFloat(a.lon) })) });
        }
      } catch { /* 忽略 */ }
    } else if (lat && lng && Number.isFinite(parseFloat(lat)) && Number.isFinite(parseFloat(lng))) {
      // 0) 缓存
      const cached = _geoCacheGet(lat, lng);
      if (cached) return Response.json({ results: [{ name: cached.name, lat: parseFloat(lat), lng: parseFloat(lng), nearby: cached.nearby || [] }] });

      // 1) 并行:Photon 附近 POI(快/稳,带 amenity/shop/tourism 等)+ Nominatim 反查(常只返 road)
      const [pois, nomName] = await Promise.all([
        photonNearby(parseFloat(lat), parseFloat(lng)),
        nominatimReverse(lat, lng),
      ]);
      // 2) Photon reverse / BigDataCloud 兜底主名(海外无 OSM POI 或 Nominatim 限流时)
      let name = nomName;
      if (!name) name = await photonReverse(lat, lng);
      if (!name) name = await bigDataCloudReverse(lat, lng);

      let nearby = pois;
      // 3) Photon 失败时再试 Overpass 兜底(并发三镜像)
      if (!nearby.length) nearby = await overpassNearby(parseFloat(lat), parseFloat(lng));
      // POI 名优先:Nominatim 在 zoom=17 常把 amenity 折成 road,把店名盖住;
      // 附近有 POI 时用最近的作主名(更"店名"),POI 缺则保留路名兜底
      if (nearby.length) name = nearby[0].name;

      if (name) {
        const finalName = String(name).slice(0, 80);
        try { _geoCachePut(lat, lng, { name: finalName, nearby }); } catch { /* 忽略 */ }
        return Response.json({ results: [{ name: finalName, lat: parseFloat(lat), lng: parseFloat(lng), nearby }] });
      }
      return Response.json({ results: [] });
    }
  } catch { /* 兜底 */ }
  return Response.json({ results: [] });
}
