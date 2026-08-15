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

/* ---------- 选点器核心 ---------- */
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
    const res = await (await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })).json();
    clearTimeout(timer);
    const results = (res.results || []).map((r) => {
      const g = wgs2gcj(r.lat, r.lng); // Nominatim = WGS-84,转 GCJ-02
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
    let detail = '';
    if (err) {
      const map = { 1: '(权限被拒)', 2: '(定位服务不可用)', 3: '(定位超时)' };
      detail = ' ' + (map[err.code] || '(错误' + err.code + ')');
    }
    st.textContent = (/MicroMessenger/i.test(navigator.userAgent)
      ? '微信内无法定位:点右上角 ⋯ 选「在浏览器打开」后重试,或直接搜索/点地图选'
      : '定位失败:' + (detail || '检查位置权限/系统定位后重试') + ',或直接搜索/点地图选');
  };

  // 微信内置浏览器直接提示(微信禁 H5 定位,getCurrentPosition 挂起不回调,不等超时)
  if (/MicroMessenger/i.test(navigator.userAgent)) {
    st.textContent = '微信内无法定位:点右上角 ⋯ 选「在浏览器打开」后重试,或直接搜索/点地图选';
    return;
  }
  // 手势内唯一请求(不并行高德,避免并发被拒)
  let settled = false;
  const settle = (lat, lng) => { if (settled) return; settled = true; done(lat, lng); };
  const failOnce = (err) => { if (settled) return; settled = true; fail(err); };
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const g = wgs2gcj(pos.coords.latitude, pos.coords.longitude);
        settle(g.lat, g.lng);
      },
      (err) => failOnce(err),
      // enableHighAccuracy:false = 网络定位(基站/WiFi)1-3s 出结果;true 强制 GPS 室内常超时
      { enableHighAccuracy: false, timeout: 12000, maximumAge: 60000 }
    );
  } else {
    failOnce();
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
};
