// 前端配置:GET /api/config → { amap_key }
// 高德 JS 定位 key 属前端公钥,经此下发;未配置时前端走纯浏览器定位
export async function onRequestGet(context) {
  return Response.json({ amap_key: context.env.AMAP_KEY || '' });
}
