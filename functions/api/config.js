// 前端配置:GET /api/config → { amap_key, amap_security_js_code, users }
// 高德 JS key 与安全密钥(securityJsCode)均属前端公钥,经此下发;2021 后无安全密钥
// 时 JS API 服务(Geocoder/PlaceSearch/Geolocation)全部报 INVALID_USER_SCODE
// users = 登录白名单(公开:首页条目署名本就展示;前端用于「你是?」两步登录的本地校验)
export async function onRequestGet(context) {
  const users = String(context.env.USERS || '').split(',').map((u) => u.trim()).filter(Boolean);
  return Response.json({
    amap_key: context.env.AMAP_KEY || '',
    amap_security_js_code: context.env.AMAP_SECURITY || '',
    users,
  });
}
