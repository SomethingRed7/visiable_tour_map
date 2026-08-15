// IP 定位:GET /api/locate
// 按访客公网 IP 反查城市级坐标(高德 v3/ip),无需浏览器权限,任何网络必成功。
// 用途:精确定位(浏览器/高德 JS)失败时的城市级兜底 —— 打开选点器从城市中心开始,
// 附近地点推荐围绕城市,而不是每次从全国 [35,105] 开始。
// 注意:依赖 CF 的 CF-Connecting-IP 头(Cloudflare Pages 自动带);本地 dev 无此头,回退失败。
export async function onRequestGet(context) {
  const key = context.env.AMAP_WEB_KEY || '';
  if (!key) {
    return Response.json({ ok: false, error: '未配置 AMAP_WEB_KEY' }, { status: 500 });
  }
  const ip = context.request.headers.get('CF-Connecting-IP') || '';
  try {
    const url = `https://restapi.amap.com/v3/ip?key=${key}${ip ? `&ip=${encodeURIComponent(ip)}` : ''}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    const d = await res.json();
    // 调试:暴露高德原始响应(排查 rectangle 缺失)
    const debug = { ip, raw: d };
    if (d.status !== '1') {
      return Response.json({ ok: false, error: d.info || 'IP 定位失败', debug });
    }
    // v3/ip 成功响应无 location,只有 rectangle(城市范围 "minLng,minLat;maxLng,maxLat")→ 取中心
    // ⚠️ 部分 IP(数据中心/CF 出口)返回空数组 province:[] rectangle:[] → 判定无坐标
    let lat = null;
    let lng = null;
    if (d.location) {
      const p = String(d.location).split(',').map(Number);
      if (p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) { lng = p[0]; lat = p[1]; }
    } else if (d.rectangle && Array.isArray(d.rectangle) === false && String(d.rectangle).includes(';')) {
      const [min, max] = String(d.rectangle).split(';');
      const [minLng, minLat] = String(min).split(',').map(Number);
      const [maxLng, maxLat] = String(max).split(',').map(Number);
      if (Number.isFinite(minLat) && Number.isFinite(minLng) && Number.isFinite(maxLat) && Number.isFinite(maxLng)) {
        lat = (minLat + maxLat) / 2;
        lng = (minLng + maxLng) / 2;
      }
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return Response.json({ ok: false, error: 'IP 定位无有效坐标', debug });
    }
    return Response.json({
      ok: true,
      lat,
      lng,
      city: (d.city && Array.isArray(d.city) === false) ? d.city : (d.province && Array.isArray(d.province) === false ? d.province : ''),
      adcode: (d.adcode && Array.isArray(d.adcode) === false) ? d.adcode : '',
      // 高德 IP 定位返回 GCJ-02(与瓦片一致),前端勿再转
      crs: 'gcj',
      ip,
    });
  } catch {
    return Response.json({ ok: false, error: 'IP 定位服务不可用' }, { status: 502 });
  }
}
