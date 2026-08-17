/* 咕咕嘎嘎 - 共享地图选点组件(打卡弹窗 + 写日记页共用,一套代码两处复用)
 *
 * 用法:
 *   <script src="loc-picker.js"></script>
 *   LocPicker.open({ lat, lng, onPick: (name, lat, lng) => {...} })
 *     - lat/lng 可选:初始视野中心(有则定位到该点并打点)
 *     - onPick:用户点「确定选这个点」后回调(回填表单)
 *
 * HTML 结构(两页必须一致,ID 固定):
 *   <div id="loc-overlay" class="loc-overlay" hidden>
 *     <div class="loc-overlay-card">
 *       <div class="loc-overlay-head">
 *         <span class="loc-overlay-title">选择位置</span>
 *         <button type="button" id="btn-loc-close" class="btn-small">✕</button>
 *       </div>
 *       <div class="loc-search-row">
 *         <input type="search" id="loc-search" placeholder="搜索地名/店铺,如:橘子洲" autocomplete="off" enterkeyhint="search">
 *         <button type="button" id="btn-loc-current" class="btn-small">📍 定位</button>
 *       </div>
 *       <div id="loc-results" class="loc-results"></div>
 *       <div id="loc-map" class="loc-map"></div>
 *       <div id="loc-nearby" class="loc-nearby" hidden></div>
 *       <p id="loc-status" class="form-status"></p>
 *       <div id="loc-confirm" class="loc-confirm" hidden>
 *         <span id="loc-confirm-name" class="loc-confirm-name"></span>
 *         <button type="button" id="btn-loc-done" class="btn-small">确定选这个点</button>
 *       </div>
 *     </div>
 *   </div>
 */
'use strict';

/* 独立 $ 助手(loc-picker.js 先于页面 JS 加载,不能依赖 app.js/edit.js 的 $) */
var $ = (s) => document.querySelector(s);

/* ---------- 坐标系统转换 ----------
 * 高德瓦片/高德 API 用 GCJ-02(火星坐标);Nominatim/Overpass/浏览器定位是 WGS-84。
 * 在 WGS-84 来源的数据进入存储前统一转 GCJ-02,否则图钉画在高德瓦片上偏几百米。
 */
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

/* 泪滴形图钉(内联 SVG,无外部依赖) */
function ggPinSvg() {
  return '<svg viewBox="0 0 24 24" width="28" height="28" style="display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">'
    + '<path d="M12 1.8C7.4 1.8 3.7 5.5 3.7 10.1c0 5.6 6.8 12.6 7.4 13.3.5.5 1.3.5 1.8 0 .6-.7 7.4-7.7 7.4-13.3C20.3 5.5 16.6 1.8 12 1.8z" fill="#e11d48"/>'
    + '<circle cx="12" cy="10" r="3.1" fill="#fff"/></svg>';
}

/* ---------- 依赖加载(Leaflet 懒加载 / 高德 SDK) ---------- */
let pickerMap = null;
let pickerMarker = null;
let picked = null; // { name, lat, lng }
let amapKey = '';      // 高德 JS key(经 /api/config 下发;空=纯浏览器定位)
let amapSecurity = ''; // 高德安全密钥 securityJsCode(2021 后服务必需)

function loadLeaflet() {
  return new Promise((resolve, reject) => {
    if (window.L) return resolve();
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.min.js';
    s.onload = () => {
      const l = document.createElement('link');
      l.rel = 'stylesheet';
      l.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(l);
      resolve();
    };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function loadAmap(key, securityCode) {
  return new Promise((resolve, reject) => {
    if (window.AMap && window.AMap.Geolocation) return resolve();
    const s = document.createElement('script');
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${key}`;
    s.onload = () => {
      if (window.AMap && window.AMap.plugin) {
        window.AMap.plugin(['AMap.Geolocation', 'AMap.Geocoder', 'AMap.PlaceSearch'], resolve);
      } else resolve();
    };
    s.onerror = reject;
    if (securityCode) window._AMapSecurityConfig = { securityJsCode: securityCode };
    document.head.appendChild(s);
  });
}

async function fetchConfig() {
  try {
    const res = await (await fetch('/api/config')).json();
    amapKey = res.amap_key || '';
    amapSecurity = res.amap_security_js_code || '';
  } catch { amapKey = ''; amapSecurity = ''; }
}

let amapReadyPromise = null;
let lpCityCache = ''; // 最近一次 IP 定位的城市(搜索时限定,避免搜出外地的同名店铺)
function ensureAmap() {
  if (window.AMap && window.AMap.Geocoder && window.AMap.PlaceSearch) return Promise.resolve(true);
  if (!amapKey) return Promise.resolve(false);
  if (!amapReadyPromise) {
    amapReadyPromise = loadAmap(amapKey, amapSecurity)
      .then(() => !!(window.AMap && window.AMap.Geocoder && window.AMap.PlaceSearch))
      .catch(() => {
        amapReadyPromise = null;
        return false;
      });
  }
  return amapReadyPromise;
}

/* 高德定位(基站/WiFi 三角,国内可靠;浏览器原生定位在国内安卓常因 Google 服务不可达超时)
 * 返回 GCJ-02 坐标 {lat,lng};失败 resolve(null)。安全:高德插件内部自己调 getCurrentPosition,
 * 但它在浏览器定位之后串行触发(不并发),避免抢手势被拒。 */
async function lpAmapLocate() {
  try {
    await fetchConfig();
    const ready = await Promise.race([ensureAmap(), new Promise((r) => setTimeout(() => r(false), 8000))]);
    if (!ready || !window.AMap || !window.AMap.Geolocation) return null;
    return await new Promise((resolve) => {
      try {
        const gl = new AMap.Geolocation({ enableHighAccuracy: true, timeout: 10000, zoomToAccuracy: false });
        gl.getCurrentPosition((status, result) => {
          if (status === 'complete' && result && result.position) {
            resolve({ lat: result.position.getLat(), lng: result.position.getLng(), accuracy: result.accuracy || null });
          } else resolve(null);
        });
      } catch { resolve(null); }
    });
  } catch { return null; }
}

/* IP 定位(城市级兜底):服务端按访客 IP 反查(高德 v3/ip),无权限限制必成功。
 * 返回 GCJ-02 {lat,lng,city};失败 resolve(null)。精确定位失败后用它兜底,
 * 让选点器/附近推荐从城市中心开始,而不是每次从全国 [35,105] 开始。 */
async function lpIpLocate() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch('/api/locate', { signal: ctrl.signal });
    clearTimeout(timer);
    const d = await r.json();
    if (d && d.ok && Number.isFinite(d.lat) && Number.isFinite(d.lng)) {
      lpCityCache = d.city || '';
      return { lat: d.lat, lng: d.lng, city: d.city || '' };
    }
    return null;
  } catch { return null; }
}

/* 路线三级获取(driving → walking → 直线),带吸附检测:
 * OSRM 会把步行景区(橘子洲)的点吸附到远处驾车路 → 检查每个原始点到路线最近点距离,
 * 任一点偏离 > 200m 判定不合格,降级 walking(步行导航);walking 也失败/不合格才直线。
 * entries: [{date, ts, location:{lat,lng}}](GCJ-02)按时间排序;
 * 返回 [[lat,lng],...](GCJ-02,与瓦片对齐) */
async function getRouteLine(entries) {
  const pts = entries.map((e) => [e.location.lat, e.location.lng]);
  const straight = () => pts;
  // 点(GCJ)到路线(WGS→GCJ)最近距离,米
  const maxDeviation = (routeGcj, origPts) => {
    let worst = 0;
    for (const [lat, lng] of origPts) {
      let best = Infinity;
      for (const [rlat, rlng] of routeGcj) {
        const dy = (lat - rlat) * 111320;
        const dx = (lng - rlng) * 111320 * Math.cos(lat * Math.PI / 180);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < best) best = d;
      }
      if (best > worst) worst = best;
    }
    return worst;
  };
  const tryProfile = async (profile) => {
    try {
      // 存储=GCJ-02,OSRM 要 WGS-84
      const wgsPts = entries.map((e) => gcj2wgs(e.location.lat, e.location.lng));
      const ptsStr = wgsPts.map((p) => `${p.lat},${p.lng}`).join('|');
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const route = await (await fetch(`/api/route?profile=${profile}&pts=${encodeURIComponent(ptsStr)}`, { signal: ctrl.signal })).json();
      clearTimeout(timer);
      if (route.coordinates && route.coordinates.length > 1) {
        if (route.source !== 'osrm:driving' && route.source !== 'osrm:walking') {
          // OSRM 服务不可达(返回 straight)→ 直接放弃路线,直线兜底(不白等下一级)
          return { failed: true };
        }
        // 响应几何是 WGS-84,转回 GCJ-02 才与瓦片/图钉对齐
        const gcj = route.coordinates.map(([lat, lng]) => {
          const g = wgs2gcj(lat, lng);
          return [g.lat, g.lng];
        });
        if (maxDeviation(gcj, pts) <= 200) return { line: gcj }; // 所有点都经过路线(偏差≤200m)
        return { failed: false }; // OSRM 在线但吸附不合格 → 试下一级(仅当 OSRM 可用才有意义)
      }
      return { failed: true };
    } catch { return { failed: true }; }
  };
  const d = await tryProfile('driving');
  if (d && d.line) return d.line;
  if (d && d.failed) return straight(); // OSRM 挂了 → 直线,不试 walking(会同样失败白等)
  const w = await tryProfile('walking');
  if (w && w.line) return w.line;
  return straight();
}
function placeMarker(lat, lng) {
  if (!pickerMap) return;
  if (pickerMarker) pickerMap.removeLayer(pickerMarker);
  pickerMarker = L.marker([lat, lng], {
    icon: L.divIcon({ className: 'gg-marker', html: ggPinSvg(), iconSize: [28, 28], iconAnchor: [14, 27] }),
    draggable: true,
  }).addTo(pickerMap);
  pickerMarker.on('dragend', () => {
    const p = pickerMarker.getLatLng();
    setPoint(p.lat, p.lng, '');
  });
}

function setPoint(lat, lng, name) {
  picked = { name, lat, lng };
  placeMarker(lat, lng);
  $('#loc-confirm').hidden = false;
  $('#loc-confirm-name').textContent = name || '选择的位置';
  $('#loc-status').textContent = `坐标 ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  reverseNearby(lat, lng);
}

/* 反查地名 + 附近地点:服务端 /api/geocode(高德 regeo+around 优先,失败 Nominatim+Overpass) */
async function reverseNearby(lat, lng) {
  const st = $('#loc-status');
  st.textContent = '反查中…';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const r = await (await fetch(`/api/geocode?lat=${lat}&lng=${lng}`, { signal: ctrl.signal })).json();
    clearTimeout(timer);
    const res = r.results && r.results[0];
    if (res && res.name) {
      picked.name = res.name;
      $('#loc-confirm-name').textContent = res.name;
    }
    // crs: 'gcj'=高德(已是 GCJ-02 勿转);'wgs'=Overpass(WGS-84 需转 GCJ-02 才对得上高德瓦片)
    const nearby = ((res && res.nearby) || []).map((n) => {
      const p = n.crs === 'wgs' ? wgs2gcj(n.lat, n.lng) : { lat: n.lat, lng: n.lng };
      return { name: n.name, lat: p.lat, lng: p.lng };
    }).slice(0, 12);
    const nb = $('#loc-nearby');
    if (nearby.length) {
      nb.hidden = false;
      nb.innerHTML = '<div class="loc-nearby-title">附近:点一个用它的名字</div>' +
        nearby.map((n, i) => `<button type="button" class="loc-nearby-chip" data-i="${i}">${esc(n.name)}</button>`).join('');
      [...nb.querySelectorAll('.loc-nearby-chip')].forEach((b) => {
        b.addEventListener('click', () => {
          const n = nearby[Number(b.dataset.i)];
          setPoint(n.lat, n.lng, n.name);
          if (pickerMap) pickerMap.setView([n.lat, n.lng], Math.max(pickerMap.getZoom(), 15));
        });
      });
    } else {
      nb.hidden = true;
      nb.innerHTML = '';
    }
    st.textContent = `坐标 ${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  } catch {
    $('#loc-nearby').hidden = true;
    st.textContent = `坐标 ${lat.toFixed(5)}, ${lng.toFixed(5)}(反查失败,可直接确认)`;
  }
}

/* 高德客户端反查(Geocoder + 周边 POI),返回 true 表示已处理 */
async function amapReverse(lat, lng) {
  const ready = await ensureAmap();
  if (!ready) return false;
  try {
    const geocoder = new AMap.Geocoder({ extensions: 'all' });
    const rev = await new Promise((resolve) => {
      geocoder.getAddress([lng, lat], (st, res) => {
        resolve(st === 'complete' && res && res.regeocode ? res.regeocode : null);
      });
    });
    if (!rev) return false;
    const pois = (rev.pois || []).filter((p) => p && p.name);
    const name = pois[0] ? pois[0].name : (rev.formattedAddress || '自定义位置');
    $('#loc-confirm-name').textContent = name;
    const seen = new Set();
    const nearby = pois.slice(1)
      .map((p) => ({ name: p.name, lat: p.location && p.location.lat, lng: p.location && p.location.lng }))
      .filter((n) => n.lat != null && !seen.has(n.name) && seen.add(n.name));
    if (nearby.length < 6) {
      try {
        const ps = new AMap.PlaceSearch({ pageSize: 6 });
        const around = await new Promise((resolve) => {
          ps.searchAround([lng, lat], 400, (st, res) => {
            resolve(st === 'complete' && res && res.poiList ? res.poiList.pois : []);
          });
        });
        for (const p of around) {
          if (!p || !p.name || seen.has(p.name)) continue;
          nearby.push({ name: p.name, lat: p.location && p.location.lat, lng: p.location && p.location.lng });
          seen.add(p.name);
          if (nearby.length >= 6) break;
        }
      } catch { /* 忽略 */ }
    }
    renderNearbyChips(nearby.filter((n) => n.lat != null));
    return true;
  } catch { return false; }
}

function renderNearbyChips(arr) {
  const box = $('#loc-nearby');
  if (!arr.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<div class="loc-nearby-title">附近:点一个用它的名字</div>' +
    arr.map((n, i) => `<button type="button" class="loc-nearby-chip" data-i="${i}">${esc(n.name)}</button>`).join('');
  [...box.querySelectorAll('.loc-nearby-chip')].forEach((b) => {
    b.addEventListener('click', () => {
      const n = arr[Number(b.dataset.i)];
      placeMarker(n.lat, n.lng);
      if (pickerMap) pickerMap.setView([n.lat, n.lng], Math.max(pickerMap.getZoom(), 15));
      $('#loc-confirm-name').textContent = n.name;
      $('#loc-status').textContent = `坐标 ${n.lat.toFixed(5)}, ${n.lng.toFixed(5)}`;
    });
  });
}

/* 搜索:输入即搜(300ms 防抖);高德 PlaceSearch 优先,失败回退服务端 */
let searchTimer = null;
async function serverSearch(q) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    // 限定城市(lpCityCache 来自 IP 定位),避免同名店铺搜到外地
    const cityQ = lpCityCache ? `&city=${encodeURIComponent(lpCityCache)}` : '';
    const res = await (await fetch(`/api/geocode?q=${encodeURIComponent(q)}${cityQ}`, { signal: ctrl.signal })).json();
    clearTimeout(timer);
    const results = (res.results || []).map((r) => {
      // crs:'gcj'=高德结果已是 GCJ-02 勿转;无 crs=Nominatim(WGS-84)需转,否则偏 1.4km
      const g = r.crs === 'gcj' ? { lat: r.lat, lng: r.lng } : wgs2gcj(r.lat, r.lng);
      return { name: r.name, lat: g.lat, lng: g.lng };
    });
    renderLocResults(results);
  } catch {
    $('#loc-results').innerHTML = '<p class="empty">搜索超时,试试点地图选</p>';
  }
}

function renderLocResults(arr) {
  const box = $('#loc-results');
  box.innerHTML = arr.length
    ? arr.map((r, i) => `<button type="button" class="loc-result" data-i="${i}">📍 ${esc(r.name)}</button>`).join('')
    : '<p class="empty">没搜到,试试直接点地图选</p>';
  [...box.querySelectorAll('.loc-result')].forEach((b) => {
    b.addEventListener('click', () => {
      const r = arr[Number(b.dataset.i)];
      if (pickerMap) {
        placeMarker(r.lat, r.lng);
        pickerMap.setView([r.lat, r.lng], 14);
      }
      picked = { name: r.name, lat: r.lat, lng: r.lng };
      $('#loc-confirm').hidden = false;
      $('#loc-confirm-name').textContent = r.name;
      $('#loc-status').textContent = `坐标 ${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`;
    });
  });
}

/* 定位(用户点「📍 定位」按钮时调用,手势内唯一请求) */
function locateCurrent() {
  const st = $('#loc-status');
  st.textContent = '定位中...';
  const done = (lat, lng) => {
    setPoint(lat, lng, '当前位置');
    if (pickerMap) pickerMap.setView([lat, lng], 14);
    (async () => {
      const ok = await amapReverse(lat, lng);
      if (!ok) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 15000);
          const res = await (await fetch(`/api/geocode?lat=${lat}&lng=${lng}`, { signal: ctrl.signal })).json();
          clearTimeout(timer);
          const r = res.results && res.results[0];
          if (r) $('#loc-confirm-name').textContent = r.name;
          renderNearbyChips(((r && r.nearby) || []).map((n) => {
            const p = n.crs === 'wgs' ? wgs2gcj(n.lat, n.lng) : { lat: n.lat, lng: n.lng };
            return { name: n.name, lat: p.lat, lng: p.lng };
          }));
        } catch { /* 保持当前位置 */ }
      }
    })();
    st.textContent = '已定位,确认后点「确定选这个点」';
  };
  const fail = (err) => {
    if (/MicroMessenger/i.test(navigator.userAgent)) {
      st.textContent = '微信内无法定位:点右上角 ⋯ 选「在浏览器打开」后重试,或直接搜索/点地图选';
      return;
    }
    // 高德+浏览器都失败 → 提示搜索/点图选
    st.textContent = '定位失败:' + (err ? { 1: '(权限被拒)', 2: '(定位服务不可用)', 3: '(定位超时)' }[err.code] || '' : '') + ',或直接搜索/点地图选';
  };

  // 微信内置浏览器:禁用 H5 定位,自动降级 IP 城市级定位
  if (/MicroMessenger/i.test(navigator.userAgent)) {
    st.textContent = '微信内无法精确定位,改用 IP 定位(城市级)…';
    lpIpLocate().then((ip) => {
      if (ip) {
        done(ip.lat, ip.lng);
        st.textContent = 'IP 定位(城市级),点下方附近店铺可快速选精确位置';
      } else {
        st.textContent = '微信内无法定位:点右上角 ⋯ 选「在浏览器打开」后重试,或直接搜索/点地图选';
      }
    });
    return;
  }
  // 串行降级(浏览器 → 高德 → IP):不并发,避免抢手势被拒
  let settled = false;
  const settle = (lat, lng) => { if (settled) return; settled = true; done(lat, lng); };
  const failOnce = (err) => { if (settled) return; settled = true; fail(err); };
  // ① 浏览器原生定位:同步启动,手势激活期内 Chrome 才会弹权限框
  if (!navigator.geolocation) {
    failOnce();
  } else {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // ⚠️ accuracy>300m 视为低精度(国产浏览器常返回网络估位)→ 走高德
        if (pos.coords.accuracy != null && pos.coords.accuracy > 300) {
          st.textContent = '浏览器定位精度低,改用高德精确定位…';
          tryAmap();
          return;
        }
        const g = wgs2gcj(pos.coords.latitude, pos.coords.longitude);
        settle(g.lat, g.lng);
      },
      (err) => tryAmap(),
      // enableHighAccuracy:true = GPS 精确定位;false 网络定位飘几个街区
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  }

  // ② 高德定位(国内更准);低精度才降级 IP
  function tryAmap() {
    st.textContent = '改用高德定位…';
    lpAmapLocate().then((g) => {
      if (g) {
        if (g.accuracy != null && g.accuracy > 300) {
          st.textContent = '高德定位精度低,改用 IP 定位…';
          tryIp();
          return;
        }
        settle(g.lat, g.lng);
        return;
      }
      tryIp();
    });
  }

  // ③ IP 定位(城市级兜底)
  function tryIp() {
    st.textContent = '改用 IP 定位(城市级)…';
    lpIpLocate().then((ip) => {
      if (ip) {
        settle(ip.lat, ip.lng);
      } else {
        failOnce();
      }
    });
  }
}

/* ---------- 打开 / 关闭 ---------- */
function lpOpenPicker(initLat, initLng) {
  $('#loc-overlay').hidden = false;
  $('#loc-results').innerHTML = '';
  $('#loc-nearby').hidden = true;
  $('#loc-confirm').hidden = true;
  $('#loc-status').textContent = '';
  setTimeout(() => $('#loc-search').focus(), 50);
  // 缓存城市(搜索限定时用);无则异步拉一次 IP 定位(不阻塞打开)
  if (!lpCityCache) lpIpLocate().then(() => {});
  (async () => {
    try {
      await loadLeaflet();
      if (!pickerMap) initPickerMap();
      setTimeout(() => pickerMap.invalidateSize(), 120);
      if (initLat != null && initLng != null) {
        pickerMap.setView([initLat, initLng], 14);
        setPoint(initLat, initLng, '');
      } else {
        pickerMap.setView([35, 105], 5);
      }
    } catch {
      $('#loc-status').textContent = '地图加载失败,仍可搜索选点';
    }
  })();
}

function initPickerMap() {
  pickerMap = L.map('loc-map', { scrollWheelZoom: false }).setView([35, 105], 5);
  L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
    maxZoom: 18,
    subdomains: ['1', '2', '3', '4'],
    attribution: '&copy; 高德地图',
  }).addTo(pickerMap);
  pickerMap.on('click', (ev) => {
    const { lat, lng } = ev.latlng;
    setPoint(lat, lng, '');
  });
}

/* 事件绑定(静态元素,只绑一次) */
$('#btn-loc-close').addEventListener('click', () => { $('#loc-overlay').hidden = true; });
$('#loc-overlay').addEventListener('click', (e) => { if (e.target.id === 'loc-overlay') $('#loc-overlay').hidden = true; });
$('#btn-loc-current').addEventListener('click', locateCurrent);
$('#btn-loc-done').addEventListener('click', () => {
  if (!picked) return $('#loc-status').textContent = '先在搜索列表选一条,或点一下地图';
  const cb = window.__locOnPick;
  $('#loc-overlay').hidden = true;
  if (cb) cb(picked.name || $('#loc-confirm-name').textContent || '自定义位置', picked.lat, picked.lng);
});
$('#loc-search').addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = $('#loc-search').value.trim();
  if (!q) { $('#loc-results').innerHTML = ''; return; }
  searchTimer = setTimeout(async () => {
    const ready = await ensureAmap();
    if (ready) {
      try {
        const ps = new AMap.PlaceSearch({ pageSize: 5 });
        ps.search(q, (status, result) => {
          const pois = status === 'complete' && result && result.poiList ? result.poiList.pois : [];
          if (pois.length) {
            renderLocResults(pois.map((p) => ({ name: p.name, lat: p.location && p.location.lat, lng: p.location && p.location.lng })).filter((n) => n.lat != null));
            return;
          }
          serverSearch(q);
        });
        return;
      } catch { /* 回退 */ }
    }
    serverSearch(q);
  }, 300);
});

/* ---------- 公共 API ---------- */
window.LocPicker = {
  open(opts) {
    window.__locOnPick = (opts && opts.onPick) || null;
    lpOpenPicker(opts && opts.lat, opts && opts.lng);
  },
  lpAmapLocate, // 高德定位兜底(打卡/写日记定位失败时复用)
  lpIpLocate,   // IP 定位城市级兜底(精确定位失败后,选点器从城市中心开始)
};
