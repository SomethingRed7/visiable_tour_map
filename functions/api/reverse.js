// 反查地名:GET /api/reverse?lat=..&lng=.. → {name, display}(打卡弹窗 📍 定位填地点框用)
// 入参是 ****GCJ-02****(应用存储/地图空间统一 GCJ-02):
//   国内 → 高德 regeo(同坐标系,直接查,名字与地图瓦片一致,商铺/小区收录远胜 OSM)
//   海外 / 高德失败 → Nominatim(要 WGS-84,先 gcj2wgs,否则偏 ~550m 认错地方)
// 失败返回 {name:null, display:null}(调用方回退坐标字符串)
const UA = 'gugugaga-travel-diary/1.0 (personal use)';

function inChina(lat, lng) { return lng > 73 && lng < 136 && lat > 3 && lat < 55; }

/* GCJ-02 → WGS-84(算法同 loc-picker.js,本站各文件各持一份,无依赖) */
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

/* 高德 regeo 主名:最近 POI(高德自家相关性,通常是小区/商场名)→ 去掉省市区街道的详细地址 */
async function amapName(key, lat, lng) {
  if (!key) return null;
  try {
    const res = await fetch(
      `https://restapi.amap.com/v3/geocode/regeo?key=${key}&location=${lng},${lat}&radius=200&extensions=all`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!res.ok) return null;
    const d = await res.json();
    if (!d || d.status !== '1' || !d.regeocode) return null;
    const r = d.regeocode;
    const p0 = (r.pois || [])[0];
    if (p0 && p0.name) return String(p0.name).slice(0, 80);
    let s = String(r.formatted_address || '').trim();
    const ac = r.addressComponent || {};
    for (const k of ['province', 'city', 'district', 'township']) {
      const v = ac[k];
      if (typeof v === 'string' && v) s = s.split(v).join('');
    }
    s = s.replace(/^[,，、\s]+/, '');
    return s ? s.slice(0, 80) : null;
  } catch { return null; }
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const lat = parseFloat(url.searchParams.get('lat'));
  const lng = parseFloat(url.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return Response.json({ error: '坐标不对' }, { status: 400 });
  }
  // 国内:高德优先(GCJ-02 直接查,零换算)
  if (inChina(lat, lng)) {
    const am = await amapName(context.env.AMAP_WEB_KEY || '', lat, lng);
    if (am) return Response.json({ name: am, display: am });
  }
  // 兜底:Nominatim 要 WGS-84(国内坐标必须先转,否则东南偏 ~550m)
  const w = inChina(lat, lng) ? gcj2wgs(lat, lng) : { lat, lng };
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${w.lat}&lon=${w.lng}&accept-language=zh-CN`,
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(8000) }
    );
    if (res.ok) {
      const d = await res.json();
      const name = (d.display_name || '').split(',').slice(0, 3).join(',').trim();
      if (name) return Response.json({ name, display: (d.display_name || '').slice(0, 80) });
    }
  } catch { /* 超时/失败走回退 */ }
  return Response.json({ name: null, display: null });
}
