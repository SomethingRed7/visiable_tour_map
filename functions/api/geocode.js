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

export async function onRequestGet(context) {
  try {
    const url = new URL(context.request.url);
    const q = url.searchParams.get('q');
    const lat = url.searchParams.get('lat');
    const lng = url.searchParams.get('lng');

    if (lat && lng && Number.isFinite(parseFloat(lat)) && Number.isFinite(parseFloat(lng))) {
      // 0) 缓存
      const cached = _geoCacheGet(lat, lng);
      if (cached) return Response.json({ results: [{ name: cached.name, lat: parseFloat(lat), lng: parseFloat(lng), nearby: cached.nearby || [] }] });

      // 1) Nominatim
      let name = await nominatimReverse(lat, lng);
      // 2) Photon
      if (!name) name = await photonReverse(lat, lng);
      // 3) BigDataCloud
      if (!name) name = await bigDataCloudReverse(lat, lng);

      if (name) {
        const finalName = String(name).slice(0, 80);
        try { _geoCachePut(lat, lng, { name: finalName, nearby: [] }); } catch { /* 忽略 */ }
        return Response.json({ results: [{ name: finalName, lat: parseFloat(lat), lng: parseFloat(lng), nearby: [] }] });
      }
      return Response.json({ results: [] });
    }

    if (q) {
      // 简单 forward:Nominatim 搜索(有 UA 不会被限)
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
    }
  } catch { /* 兜底 */ }
  return Response.json({ results: [] });
}
