// 地理编码 API:GET /api/geocode?q=地名 | ?lat=&lng=(反向)
// 反向(国内):高德 regeo + place/around(数据与地图瓦片同源,GCJ-02 直接用)
// 反向(海外 / 高德失败):Nominatim → Photon → BigDataCloud(免 key,有 UA),坐标须先 GCJ→WGS
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

/* ---------- GCJ-02 ⇄ WGS-84(国内偏移 ~500m)----------
 * ⚠️ 前端点图/拖图钉/定位传来的坐标一律是 ****GCJ-02****(应用存储与 Leaflet 地图空间都是 GCJ),
 * 而 Nominatim/Photon/Overpass/BigDataCloud 全部按 ****WGS-84**** 解释坐标。
 * 之前直接把 GCJ 丢给它们 → 反查点东南偏 ~550m,名字认成隔壁小区
 * (实测 2026-09-17:点在「万科·星图光年轩」,反查却给出 600m 外的「万科·桂语里」)。
 * 算法与 loc-picker.js 同款(纯 JS 无依赖,本站各文件各持一份)。 */
function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320.0 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}
function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0;
  return ret;
}
function wgs2gcj(lat, lng) {
  const a = 6378245.0, ee = 0.00669342162296594323;
  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((a * (1 - ee)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((a / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lat: lat + dLat, lng: lng + dLng };
}
function gcj2wgs(lat, lng) {
  const g = wgs2gcj(lat, lng);
  return { lat: lat * 2 - g.lat, lng: lng * 2 - g.lng };
}
/* 楼栋号/门牌对「选地点」没意义("11幢" / "X号楼"),别让它当主名或铺满候选 */
function isBuildingNo(name) {
  return /^[0-9]+(号楼|[幢栋])/.test(String(name || '')) || /^[0-9]+[单元室]/.test(String(name || ''));
}

/* 高德 regeo 的详细地址去掉省/市/区/街道前缀:"浙江省杭州市余杭区良渚街道万科·星图光年轩(南门)"
 * → "万科·星图光年轩(南门)"(纯 POI 名更好用) */
function shortAddr(regeo) {
  let s = String((regeo && regeo.formatted_address) || '').trim();
  const ac = (regeo && regeo.addressComponent) || {};
  for (const k of ['province', 'city', 'district', 'township']) {
    const v = ac[k];
    if (typeof v === 'string' && v) s = s.split(v).join('');
  }
  return s.replace(/^[,，、\s]+/, '').slice(0, 60);
}

/* 高德 Web 服务反查(国内首选):主名=regeo 最近 POI(与高德 App 所见一致),
 * 附近=place/around 按距离;坐标是 GCJ-02,直接配地图瓦片,标 crs:'gcj' 让前端别再转换 */
async function amapReverse(key, lat, lng) {
  if (!key) return null;
  const loc = `${lng},${lat}`;
  const get = async (url) => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) return null;
      const d = await res.json();
      return d && d.status === '1' ? d : null;
    } catch { return null; }
  };
  // place/around 参数坑:extensions=base / 多值 types 都会返回空,必须不带 extensions、不带 types + sortrule=distance
  const [rg, ar] = await Promise.all([
    get(`https://restapi.amap.com/v3/geocode/regeo?key=${key}&location=${loc}&radius=200&extensions=all`),
    get(`https://restapi.amap.com/v3/place/around?key=${key}&location=${loc}&radius=1000&offset=30&page=1&sortrule=distance`),
  ]);
  const regeo = rg && rg.regeocode ? rg.regeocode : null;
  const toItem = (p) => {
    const c = String((p && p.location) || '').split(',');
    const la = parseFloat(c[1]);
    const ln = parseFloat(c[0]);
    const name = String((p && p.name) || '').trim();
    if (!name || !Number.isFinite(la) || !Number.isFinite(ln)) return null;
    return { name, lat: la, lng: ln, type: String((p && p.type) || '') };
  };
  const pois = (((regeo && regeo.pois) || []).map(toItem)).filter(Boolean);
  const around = (((ar && ar.pois) || []).map(toItem)).filter(Boolean);
  const name = (pois[0] && pois[0].name) || (around[0] && around[0].name) || shortAddr(regeo);
  if (!name) return null;
  // 候选:周边(距离序)在前,regeo POI 补充;去重、去掉楼栋号,按距离排
  const plain = around.filter((p) => p.type.indexOf('门牌信息') < 0).length;
  const seen = new Set([name]);
  const all = [];
  for (const p of [...around, ...pois]) {
    if (seen.has(p.name)) continue;
    if (plain >= 5 && p.type.indexOf('门牌信息') >= 0) continue;
    if (isBuildingNo(p.name)) continue;
    seen.add(p.name);
    all.push(p);
  }
  all.sort((a, b) => Math.hypot(a.lat - lat, a.lng - lng) - Math.hypot(b.lat - lat, b.lng - lng));
  return {
    name: String(name).slice(0, 80),
    nearby: all.slice(0, 20).map((p) => ({ name: p.name, lat: p.lat, lng: p.lng, crs: 'gcj' })),
  };
}

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
      if (osmKey === 'highway') continue; // 过滤路名
      if (isBuildingNo(name)) continue;
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
      const LA = parseFloat(lat);
      const LN = parseFloat(lng);
      // 0) 缓存
      const cached = _geoCacheGet(LA, LN);
      if (cached) return Response.json({ results: [{ name: cached.name, lat: LA, lng: LN, nearby: cached.nearby || [] }] });

      const isCN = inChina(LA, LN);

      // 0.5) 国内:高德优先 —— 数据与地图瓦片同源、坐标同为 GCJ-02(零换算零偏差),
      // 商铺/小区收录远胜 OSM(OSM 在这一带只有零星几个小区名)
      if (isCN) {
        const am = await amapReverse(context.env.AMAP_WEB_KEY || '', LA, LN);
        if (am && am.name) {
          try { _geoCachePut(LA, LN, am); } catch { /* 忽略 */ }
          return Response.json({ results: [{ name: am.name, lat: LA, lng: LN, nearby: am.nearby }] });
        }
      }

      // 1) OSM 兜底(海外常态 / 国内高德失败):先 GCJ→WGS,否则偏 ~550m 认错地方
      const W = isCN ? gcj2wgs(LA, LN) : { lat: LA, lng: LN };
      const [pois, nomName] = await Promise.all([
        photonNearby(W.lat, W.lng),
        nominatimReverse(W.lat, W.lng),
      ]);
      // 2) Photon reverse / BigDataCloud 兜底主名(海外无 OSM POI 或 Nominatim 限流时)
      let name = nomName;
      if (!name) name = await photonReverse(W.lat, W.lng);
      if (!name) name = await bigDataCloudReverse(W.lat, W.lng);

      let nearby = pois;
      // 3) Photon 失败时再试 Overpass 兜底(并发三镜像)
      if (!nearby.length) nearby = await overpassNearby(W.lat, W.lng);
      // POI 名优先:Nominatim 在 zoom=17 常把 amenity 折成 road,把店名盖住;
      // 附近有 POI 时用最近的作主名(更"店名"),POI 缺则保留路名兜底
      if (nearby.length) name = nearby[0].name;

      if (name) {
        const finalName = String(name).slice(0, 80);
        try { _geoCachePut(LA, LN, { name: finalName, nearby }); } catch { /* 忽略 */ }
        return Response.json({ results: [{ name: finalName, lat: LA, lng: LN, nearby }] });
      }
      return Response.json({ results: [] });
    }
  } catch { /* 兜底 */ }
  return Response.json({ results: [] });
}
