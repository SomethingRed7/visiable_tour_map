// 前端配置:GET /api/config → { amap_key, amap_security_js_code }
// 高德 JS key 与安全密钥(securityJsCode)均属前端公钥,经此下发;2021 后无安全密钥
// 时 JS API 服务(Geocoder/PlaceSearch/Geolocation)全部报 INVALID_USER_SCODE
export async function onRequestGet(context) {
  return Response.json({
    amap_key: context.env.AMAP_KEY || '',
    amap_security_js_code: context.env.AMAP_SECURITY || '',
  });
}
