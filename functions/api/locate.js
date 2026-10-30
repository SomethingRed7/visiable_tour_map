// IP 定位:GET /api/locate —— 城市级兜底,不需要任何浏览器权限
//
// 两级来源:
//   ① 高德 v3/ip:能给出城市名 + adcode + 城市矩形,精度到区,返回 GCJ-02
//   ② Cloudflare 自带的 request.cf(IP 归属地):零外部依赖,Worker 必定拿得到,返回 WGS-84
//
// 为什么要有②:2026-10-30 实测 /api/locate 返回「IP 定位服务不可用」——
// 高德 key 本身是好的(本机直连 0.12s 就返回杭州),是 **Worker 从境外节点访问 restapi.amap.com
// 这一步失败/超时**。而前端的定位链里 IP 是最后一层,它一挂就整条链全灭,app 里直接「定位不上」。
// 换成 CF 自带数据后,这一层再也不会因为外部服务而失效。
//
// 返回里 crs 字段标明坐标系:gcj(高德,前端直接用)/ wgs(CF,前端需 fromWgs 转换)。
export async function onRequestGet(context) {
  const ip = context.request.headers.get('CF-Connecting-IP') || '';

  // ---------- ① 高德 v3/ip ----------
  const key = context.env.AMAP_WEB_KEY || '';
  if (key) {
    try {
      const url = `https://restapi.amap.com/v3/ip?key=${key}${ip ? `&ip=${encodeURIComponent(ip)}` : ''}`;
      const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const d = await res.json();

      if (d && d.status === '1') {
        // v3/ip 成功响应没有 location,只有 rectangle("minLng,minLat;maxLng,maxLat")→ 取中心
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
          if ([minLat, minLng, maxLat, maxLng].every(Number.isFinite)) {
            lat = (minLat + maxLat) / 2;
            lng = (minLng + maxLng) / 2;
          }
        }

        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          return Response.json({
            ok: true,
            lat,
            lng,
            city: (d.city && Array.isArray(d.city) === false) ? d.city
              : (d.province && Array.isArray(d.province) === false ? d.province : ''),
            adcode: (d.adcode && Array.isArray(d.adcode) === false) ? d.adcode : '',
            crs: 'gcj',        // 高德 IP 定位就是 GCJ-02,与瓦片一致,前端勿再转
            source: 'amap',
            ip,
          });
        }
      }
    } catch { /* 静默落到 CF 兜底 */ }
  }

  // ---------- ② Cloudflare 自带 IP 地理(兜底,不依赖任何第三方) ----------
  const cf = context.request.cf || {};
  const cfLat = Number(cf.latitude);
  const cfLng = Number(cf.longitude);
  if (Number.isFinite(cfLat) && Number.isFinite(cfLng) && (cfLat !== 0 || cfLng !== 0)) {
    return Response.json({
      ok: true,
      lat: cfLat,
      lng: cfLng,
      city: String(cf.city || ''),
      region: String(cf.region || ''),
      country: String(cf.country || ''),
      crs: 'wgs',          // CF 给的是 WGS-84,前端要用 fromWgs 转成 GCJ-02
      source: 'cf',
      ip,
    });
  }

  return Response.json({ ok: false, error: 'IP 定位不可用' }, { status: 502 });
}
