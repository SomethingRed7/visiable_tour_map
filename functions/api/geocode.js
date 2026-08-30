// 地理编码 API:GET /api/geocode?q=地名 | ?lat=&lng=(反向,含附近地点)
// 反向:配置了 AMAP_KEY 时用高德 regeo(与瓦片同源,POI 名一致,含附近 pois);
// 否则回退 Nominatim → Photon(Komoot,OSM 反查,有 UA 不被限流)→ BigDataCloud(中文结果,免 key,CORS 友好)
// + 服务端 in-memory 缓存(1h),同一坐标秒回
const UA = 'gugugaga-travel-diary/1.0 (personal use)';
const _geoCache = new Map(); // key: "lat,lng" 1h TTL
const _geoCacheKey = (la, ln) => `${Number(la).toFixed(5)},${Number(ln).toFixed(5)}`;
function _geoCacheGet(la, ln) {
  const e = _geoCache.get(_geoCacheKey(la, ln));
  return e && (Date.now() - e.t) < 3600e3 ? e.v : null;
}
function _geoCachePut(la, ln, v) { _geoCache.set(_geoCacheKey(la, ln), { v, t: Date.now() }); }

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
      `https://restapi.amap.com/v3/geocode/regeo?key=${key}&location=${lng},${lat}&radius=1000&extensions=all`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return null;
    const d = await res.json();
    if (d.status !== '1' || !d.regeocode) return null;
    // 主名:regeo 的 formatted_address(带行政区划,比 poi[0] 更稳)
    const name = (d.regeocode.formatted_address || '自定义位置').slice(0, 80);
    // 附近地点:PlaceSearch 周边搜索(types=050000 餐饮+生活服务,按距离排)
    // —— regeo 的 pois 是有限集合常漏店铺(实测丹丹热卤 16m 却不在 regeo 列表),around 全且按距离
    let nearby = [];
    try {
      // around 不带 types = 全品类 POI(餐饮+酒店+购物+生活+交通…),与高德 App 一致
      // ⚠️ 曾用 types=050000(餐饮单类)导致酒店/购物查不到;多值 types 返回空(高德坑)
      const ar = await fetch(
        `https://restapi.amap.com/v3/place/around?key=${key}&location=${lng},${lat}&radius=1000&offset=30&sortrule=distance`,
        { signal: AbortSignal.timeout(8000) }
      );
      const ad = await ar.json();
      if (ad.status === '1' && ad.pois) {
        nearby = ad.pois.slice(0, 20).map((p) => {
          const [lngN, latN] = String(p.location || '').split(',').map(Number);
          // 高德 around 坐标 = GCJ-02,与高德瓦片一致,前端勿再转(WGS-84→GCJ 会双重偏移 1.4km)
          return { name: p.name, lat: Number.isFinite(latN) ? latN : null, lng: Number.isFinite(lngN) ? lngN : null, dist: p.distance, crs: 'gcj' };
        }).filter((n) => n.lat != null);
      }
    } catch { /* 周边失败就空列表 */ }
    // around 无结果(CF Worker 出口 IP 可能被高德风控)→ 回退 regeo 自带的 pois
    if (!nearby.length) {
      const pois = (d.regeocode.pois || [])
        .filter((p) => p && p.name)
        .sort((a, b) => parseFloat(a.distance || 99999) - parseFloat(b.distance || 99999))
        .slice(0, 20)
        .map((p) => {
          const [lngN, latN] = String(p.location || '').split(',').map(Number);
          return { name: p.name, lat: Number.isFinite(latN) ? latN : null, lng: Number.isFinite(lngN) ? lngN : null, dist: p.distance, crs: 'gcj' };
        });
      nearby = pois;
    }
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
      out.push({ name, lat: latN, lng: lngN, crs: 'wgs' }); // Overpass = WGS-84,前端需转 GCJ-02
      if (out.length >= 6) break;
    }
    return out;
  } catch { return []; }
}

/* Photon 反查(OSM,Komoot,免 key 限流宽松;有 UA 浏览器直连不会被限,服务端更稳)
 * 优先 locality(小区名,比如 Mountview Green)> name(POI)> street(路)> suburb/village/neighbourhood > city */
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

/* BigDataCloud 反查(中文本地化,免 key,CORS 友好;不同 IP 池,服务端稳)
 * locality(如 罗托鲁瓦) > city > principalSubdivision > countryName */
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

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const q = url.searchParams.get('q');
  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');

  try {
    if (lat && lng && Number.isFinite(parseFloat(lat)) && Number.isFinite(parseFloat(lng))) {
      // 优先高德 regeo(与瓦片同源,有 AMAP_WEB_KEY 才有)
      try {
        const amap = await amapRegeo(context.env, lat, lng);
        if (amap) return Response.json({ results: [amap] });
      } catch { /* 高德失败继续 */ }

      // 0) 服务端缓存(同坐标 1h 秒回)
      try {
        const cached = _geoCacheGet(lat, lng);
        if (cached) return Response.json({ results: [{ name: cached.name, lat: parseFloat(lat), lng: parseFloat(lng), nearby: cached.nearby || [] }] });
      } catch { /* 缓存读失败继续 */ }

      // 依次: Nominatim → Photon(小区名)→ BigDataCloud(中文) — 任一成功即用
      let name = '自定义位置';
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=17&accept-language=zh-CN`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(7000) });
        if (r.ok) { const d = await r.json(); if (d && d.display_name) name = shortName(d.display_name); }
      } catch { /* 继续 */ }
      if (name === '自定义位置') {
        const p = await photonReverse(lat, lng);
        if (p) name = String(p).slice(0, 80);
      }
      if (name === '自定义位置') {
        const b = await bigDataCloudReverse(lat, lng);
        if (b) name = String(b).slice(0, 80);
      }

      // 附近(Overpass,失败不阻塞)
      let nearbyList = [];
      try { nearbyList = await nearbyOverpass(lat, lng); } catch { /* 继续 */ }

      // 写缓存(1h,有名字才写)
      if (name !== '自定义位置') { try { _geoCachePut(lat, lng, { name, nearby: nearbyList }); } catch { /* 继续 */ } }
      return Response.json({ results: [{ name, lat: parseFloat(lat), lng: parseFloat(lng), nearby: nearbyList }] });
    }

    if (q) {
      // 优先高德 place/text(全品类、中国 POI 全;Nominatim/OSM 中国数据极少「9栋/10栋」)
      const key = context.env.AMAP_WEB_KEY || '';
      if (key) {
        try {
          const city = (url.searchParams.get('city') || '').trim();
          // citylimit=true 需配 city(前端传 IP 定位城市,如「长沙市」),避免同名搜到外地
          const ar = await fetch(
            `https://restapi.amap.com/v3/place/text?key=${key}&keywords=${encodeURIComponent(q)}&city=${encodeURIComponent(city)}&citylimit=true&offset=10&page=1`,
            { signal: AbortSignal.timeout(8000) }
          );
          const ad = await ar.json();
          if (ad.status === '1' && ad.pois && ad.pois.length) {
            return Response.json({
              results: ad.pois.slice(0, 8).map((p) => {
                const [lngN, latN] = String(p.location || '').split(',').map(Number);
                return { name: String(p.name || '').slice(0, 80), lat: Number.isFinite(latN) ? latN : null, lng: Number.isFinite(lngN) ? lngN : null, crs: 'gcj' };
              }).filter((r) => r.lat != null),
            });
          }
        } catch { /* 回退 Nominatim */ }
      }
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
