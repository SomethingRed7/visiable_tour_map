/* 咕咕嘎嘎 - 写日记(前端压缩 + 地图选点 + 上传 + 删除管理) */
'use strict';

const $ = (s) => document.querySelector(s);
const form = $('#diary-form');

/* ---------- 登录 / 会话 ---------- */
let pendingUser = ''; // 第二步(密码)所属的已确认用户名
let whitelist = [];   // 公开白名单(来自 /api/config,供「你是?」本地校验)

function showLoginPanel() {
  $('#who-form').hidden = false;
  $('#login-form').hidden = true;
  $('#setup-form').hidden = true;
}

function setAuthed(user) {
  const loggedIn = !!user;
  $('#login-panel').hidden = loggedIn;
  $('#editor-area').hidden = !loggedIn;
  $('#user-area').hidden = !loggedIn;
  if (user) $('#current-user').textContent = user;
  else showLoginPanel();
}

async function initAuth() {
  try {
    const [auth, cfg] = await Promise.all([
      fetch('/api/auth').then((r) => r.json()),
      fetch('/api/config').then((r) => r.json()),
    ]);
    whitelist = cfg.users || [];
    setAuthed(auth.user || null);
  } catch {
    whitelist = [];
    setAuthed(null);
  }
}

// 第一步「你是?」:白名单内 → 密码步骤;否则「不认识」
$('#who-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const st = $('#who-status');
  st.className = 'form-status';
  const name = $('#who-user').value.trim();
  if (!name) {
    st.className = 'form-status error';
    st.textContent = '请输入你的名字';
    return;
  }
  if (!whitelist.includes(name)) {
    st.className = 'form-status error';
    st.textContent = `不认识 "${name}"`;
    return;
  }
  pendingUser = name;
  $('#lg-echo').textContent = name;
  $('#lg-pass').value = '';
  $('#login-status').className = 'form-status';
  $('#login-status').textContent = '';
  $('#who-form').hidden = true;
  $('#login-form').hidden = false;
  $('#lg-pass').focus();
});

$('#lg-change').addEventListener('click', (e) => {
  e.preventDefault();
  pendingUser = '';
  $('#login-form').hidden = true;
  $('#who-form').hidden = false;
  $('#who-status').className = 'form-status';
  $('#who-status').textContent = '';
  $('#who-user').focus();
});

// 写接口 401(会话过期)→ 弹回登录框
function bounceOn401(res) {
  if (res.status === 401) setAuthed(null);
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!pendingUser) { showLoginPanel(); return; } // 防御:未经过第一步
  const st = $('#login-status');
  st.className = 'form-status';
  st.textContent = '登录中...';
  try {
    const fd = new FormData();
    fd.append('username', pendingUser);
    fd.append('password', $('#lg-pass').value);
    const res = await fetch('/api/login', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      st.className = 'form-status error';
      st.textContent = data.error || `登录失败(HTTP ${res.status})`;
      return;
    }
    setAuthed(data.user);
    st.textContent = '';
  } catch {
    st.className = 'form-status error';
    st.textContent = '网络错误,请重试';
  }
});

$('#setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const st = $('#setup-status');
  st.className = 'form-status';
  const pass = $('#st-pass').value;
  if (pass.length < 8) {
    st.className = 'form-status error';
    st.textContent = '密码至少 8 位';
    return;
  }
  if (pass !== $('#st-pass2').value) {
    st.className = 'form-status error';
    st.textContent = '两次输入的密码不一致';
    return;
  }
  st.textContent = '设置中...';
  try {
    const fd = new FormData();
    fd.append('username', $('#st-user').value.trim());
    fd.append('code', $('#st-code').value.trim());
    fd.append('new_password', pass);
    const res = await fetch('/api/login', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      st.className = 'form-status error';
      st.textContent = data.error || `设置失败(HTTP ${res.status})`;
      return;
    }
    setAuthed(data.user);
    st.textContent = '';
  } catch {
    st.className = 'form-status error';
    st.textContent = '网络错误,请重试';
  }
});

$('#lg-back').addEventListener('click', (e) => {
  e.preventDefault();
  $('#setup-form').hidden = true;
  $('#login-form').hidden = false;
  $('#setup-status').className = 'form-status';
  $('#setup-status').textContent = '';
});

// 「初次使用?」显式入口:切到首次设置,用户名带过来(唯一入口,登录不自动跳转)
$('#lg-to-setup').addEventListener('click', (e) => {
  e.preventDefault();
  $('#st-user').value = pendingUser || $('#who-user').value;
  $('#login-form').hidden = true;
  $('#setup-form').hidden = false;
  $('#setup-status').className = 'form-status';
  $('#setup-status').textContent = '输入管理员发给你的一次性设置码,设置你的密码';
  $('#st-code').focus();
});

$('#btn-logout').addEventListener('click', async () => {
  try { await fetch('/api/logout', { method: 'POST' }); } catch { /* 忽略 */ }
  setAuthed(null);
  $('#lg-pass').value = '';
});

function setStatus(msg, isErr) {
  const el = $('#form-status');
  el.textContent = msg;
  el.className = 'form-status' + (isErr ? ' error' : '');
}

/* 浏览器端压缩:Image + objectURL(兼容微信内置浏览器;现代浏览器自动处理 EXIF 方向) */
function compressImage(file, maxLen, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxLen / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
      } catch (e) {
        URL.revokeObjectURL(url);
        reject(e);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error(`图片无法解码:${file.name}(HEIC 请用 iPhone Safari 打开)`));
    };
    img.src = url;
  });
}

/* 相册 datalist */
async function loadAlbums() {
  try {
    const data = await (await fetch('/api/entries')).json();
    const albums = [...new Set((data.entries || []).map((e) => e.album).filter(Boolean))];
    $('#album-list').innerHTML = albums.map((a) => `<option value="${a.replace(/"/g, '&quot;')}">`).join('');
  } catch { /* 忽略,手动输入即可 */ }
}

/* 照片预览 */
function renderPreview() {
  const files = [...$('#f-photos').files];
  $('#photo-preview').innerHTML = files
    .map((f, i) => `<div class="preview-item"><img src="${URL.createObjectURL(f)}" alt="预览 ${i + 1}"><span>${f.name}</span></div>`)
    .join('');
}

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

/* ---------- 选点器(搜索优先,微信/高德式全屏) ---------- */
let pickerMap = null;
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
        // v2.0 插件经 AMap.plugin 加载;反查/搜索/定位三个都要
        window.AMap.plugin(['AMap.Geolocation', 'AMap.Geocoder', 'AMap.PlaceSearch'], resolve);
      } else resolve();
    };
    s.onerror = reject;
    // 2021 后必须的安全密钥(缺了服务报 INVALID_USER_SCODE);须在加载脚本前设置
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

let amapReadyPromise = null; // 高德 SDK+插件就绪(含等待,避免首次加载抢跑)
function ensureAmap() {
  if (window.AMap && window.AMap.Geocoder && window.AMap.PlaceSearch) return Promise.resolve(true);
  if (!amapKey) return Promise.resolve(false);
  if (!amapReadyPromise) {
    amapReadyPromise = loadAmap(amapKey, amapSecurity)
      .then(() => !!(window.AMap && window.AMap.Geocoder && window.AMap.PlaceSearch))
      .catch(() => {
        amapReadyPromise = null; // 首载失败允许下次重试(网络抖动)
        return false;
      });
  }
  return amapReadyPromise;
}

async function openPicker() {
  $('#loc-overlay').hidden = false;
  $('#loc-results').innerHTML = '';
  $('#loc-confirm').hidden = true;
  $('#loc-status').textContent = '';
  setTimeout(() => $('#loc-search').focus(), 50);
  try {
    await loadLeaflet();
    if (!pickerMap) initPickerMap();
    setTimeout(() => pickerMap.invalidateSize(), 120);
  } catch {
    $('#loc-status').textContent = '地图加载失败,仍可搜索选点';
  }
  // 默认自动定位推荐(减少操作;权限已允许时秒出,失败有引导仍可搜索/点图)
  setTimeout(() => locateCurrent(), 0);
}

function initPickerMap() {
  pickerMap = L.map('loc-map', { scrollWheelZoom: false }).setView([30.57, 104.07], 5);
  L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
    maxZoom: 18,
    subdomains: ['1', '2', '3', '4'],
    attribution: '&copy; 高德地图',
  }).addTo(pickerMap);
  pickerMap.on('click', async (ev) => {
    const { lat, lng } = ev.latlng;
    placeMarker(lat, lng);
    $('#loc-confirm').hidden = false;
    $('#loc-confirm-name').textContent = '查找附近地点…';
    $('#loc-nearby').hidden = true;
    // 优先客户端高德(快+POI 准);失败回退服务端 Nominatim+Overpass
    const ok = await amapReverse(lat, lng);
    if (!ok) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        const res = await (await fetch(`/api/geocode?lat=${lat}&lng=${lng}`, { signal: ctrl.signal })).json();
        clearTimeout(timer);
        const r = res.results && res.results[0];
        if (r) {
          $('#loc-confirm-name').textContent = r.name;
          // 兜底反查的 nearby 来自 Overpass = WGS-84,转 GCJ-02 再渲染(图钉才不会偏)
          const nearby = ((r && r.nearby) || []).map((n) => {
            const g = wgs2gcj(n.lat, n.lng);
            return { name: n.name, lat: g.lat, lng: g.lng };
          });
          renderNearby(nearby, lat, lng);
        }
      } catch { /* 反查失败保持自定义位置 */ }
    }
  });
}

function placeMarker(lat, lng) {
  if (!pickerMap) return;
  if (pickerMap._marker) pickerMap.removeLayer(pickerMap._marker);
  pickerMap._marker = L.marker([lat, lng], { icon: L.divIcon({ className: 'gg-marker', html: ggPinSvg(), iconSize: [28, 28], iconAnchor: [14, 27] }) }).addTo(pickerMap);
}

function selectPoint(name, lat, lng) {
  picked = { name, lat, lng };
  $('#f-location').value = name;
  $('#f-lat').value = lat;
  $('#f-lng').value = lng;
  $('#loc-overlay').hidden = true;
  setStatus(`已选位置:${name}`, false);
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
      selectPoint(r.name, r.lat, r.lng);
    });
  });
}

// 高德客户端反查(Geocoder + 周边 POI),返回 true 表示已处理
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
    // 附近列表:Geocoder 的 pois + 补充 searchAround(带距离的 POI)
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
    renderNearby(nearby.filter((n) => n.lat != null), lat, lng);
    return true;
  } catch { return false; }
}

function renderNearby(arr, lat, lng) {
  const box = $('#loc-nearby');
  if (!arr.length) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<div class="loc-nearby-title">附近:点一个用它的名字</div>` +
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
  $('#loc-status').textContent = `坐标 ${lat.toFixed(5)}, ${lng.toFixed(5)}(地图数据与反查数据源不同,名字不准时点上面的附近)`;
}

// 搜索:输入即搜(300ms 防抖);高德 PlaceSearch 优先(快+中文 POI 准),失败回退服务端
let searchTimer = null;
async function serverSearch(q) {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await (await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })).json();
    clearTimeout(timer);
    // Nominatim = WGS-84,转 GCJ-02 再渲染(否则点选后图钉偏几百米)
    const results = (res.results || []).map((r) => {
      const g = wgs2gcj(r.lat, r.lng);
      return { name: r.name, lat: g.lat, lng: g.lng };
    });
    renderLocResults(results);
  } catch {
    $('#loc-results').innerHTML = '<p class="empty">搜索超时,试试点地图选</p>';
  }
}
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

// 定位:高德(配置了 key 时,国行安卓也能定到)否则纯浏览器定位,失败给明确引导
async function locateCurrent() {
  const st = $('#loc-status');
  st.textContent = '定位中...';
  const done = (lat, lng) => {
    placeMarker(lat, lng);
    if (pickerMap) pickerMap.setView([lat, lng], 14);
    $('#loc-confirm').hidden = false;
    $('#loc-confirm-name').textContent = '当前位置';
    (async () => {
      // 高德客户端反查优先;失败回退服务端
      const ok = await amapReverse(lat, lng);
      if (!ok) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 15000);
          const res = await (await fetch(`/api/geocode?lat=${lat}&lng=${lng}`, { signal: ctrl.signal })).json();
          clearTimeout(timer);
          const r = res.results && res.results[0];
          if (r) $('#loc-confirm-name').textContent = r.name;
          renderNearby((r && r.nearby) || [], lat, lng);
        } catch { /* 保持当前位置 */ }
      }
    })();
    st.textContent = '已定位,确认后点「确定选这个点」';
  };
  const fail = () => st.textContent = '定位失败:检查位置权限/系统定位后重试,或直接搜索/点地图选';

  try { await fetchConfig(); } catch { amapKey = ''; }
  if (await ensureAmap()) {
    try {
      const geolocation = new AMap.Geolocation({ enableHighAccuracy: true, timeout: 10000 });
      geolocation.getCurrentPosition((status, result) => {
        if (status === 'complete' && result && result.position) {
          done(result.position.getLat(), result.position.getLng());
        } else {
          fail();
        }
      });
      return;
    } catch { /* 高德加载失败降级浏览器定位 */ }
  }
  if (!navigator.geolocation) return fail();
  navigator.geolocation.getCurrentPosition(
    // 浏览器定位 = WGS-84,转 GCJ-02 再落点(否则图钉偏几百米)
    (pos) => {
      const g = wgs2gcj(pos.coords.latitude, pos.coords.longitude);
      done(g.lat, g.lng);
    },
    () => fail(),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
  );
}

$('#btn-loc').addEventListener('click', openPicker);
$('#f-location').addEventListener('click', openPicker);
$('#btn-loc-close').addEventListener('click', () => { $('#loc-overlay').hidden = true; });
$('#loc-overlay').addEventListener('click', (e) => { if (e.target.id === 'loc-overlay') $('#loc-overlay').hidden = true; });
$('#btn-loc-done').addEventListener('click', () => {
  const m = pickerMap && pickerMap._marker && pickerMap._marker.getLatLng();
  if (!m) return $('#loc-status').textContent = '先在搜索列表选一条,或点一下地图';
  selectPoint($('#loc-confirm-name').textContent || '自定义位置', m.lat, m.lng);
});
$('#btn-loc-current').addEventListener('click', locateCurrent);

/* ---------- 上传 ---------- */
async function doUpload() {
  const date = $('#f-date').value;
  const title = $('#f-title').value.trim();
  const text = $('#f-text').value.trim();
  const album = $('#f-album').value.trim() || null;
  const location = $('#f-location').value.trim() || null;
  const lat = $('#f-lat').value;
  const lng = $('#f-lng').value;
  const files = [...$('#f-photos').files];

  if (!date) return setStatus('请选择日期', true);
  if (!title && !text && files.length === 0) return setStatus('至少填标题/文字/照片之一', true);

  const fd = new FormData();
  fd.append('date', date);
  if (location) {
    fd.append('location', location);
    if (lat && lng) { fd.append('lat', lat); fd.append('lng', lng); }
  }
  if (title) fd.append('title', title);
  if (text) fd.append('text', text);
  if (album) fd.append('album', album);

  const btn = $('#btn-submit');
  btn.disabled = true;
  btn.textContent = '发布中...';
  try {
    for (let i = 0; i < files.length; i++) {
      setStatus(`压缩照片 ${i + 1}/${files.length}...`);
      const full = await compressImage(files[i], 1600, 0.85);
      const thumb = await compressImage(files[i], 480, 0.75);
      fd.append('photo_full', full, files[i].name);
      fd.append('photo_thumb', thumb, files[i].name);
    }
    setStatus('上传中...');
    const res = await fetch('/api/upload', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      bounceOn401(res);
      return setStatus(data.error || `上传失败(HTTP ${res.status})`, true);
    }

    // 成功:记住本次选择 + 横幅 + 清空表单
    rememberDefaults();
    $('#success-banner').hidden = false;
    $('#btn-view-day').href = `/?date=${date}`;
    setStatus('', false);
    form.reset();
    $('#f-date').value = new Date().toISOString().slice(0, 10);
    $('#f-location').value = $('#f-lat').value = $('#f-lng').value = '';
    picked = null;
    $('#photo-preview').innerHTML = '';
    renderRecent();
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = '发布';
  }
}

$('#btn-again').addEventListener('click', () => {
  $('#success-banner').hidden = true;
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  if (editing) doUpdate();
  else doUpload();
});
$('#f-photos').addEventListener('change', renderPreview);

/* ---------- 最近条目:预览 / 编辑 / 删除 ---------- */
let editing = null;    // { date, ts, photos }
let removedPaths = []; // 编辑中要删除的照片路径

function entryTs(e) {
  if (e.ts) return String(e.ts);
  if (e.photos && e.photos[0]) {
    const m = e.photos[0].match(/(\d{13})-\d+\.jpg$/);
    if (m) return m[1];
  }
  return '';
}

function thumbUrl(p) { return p.replace(/\.(jpg|jpeg|png)$/i, '-thumb.$1'); }

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function entryCardHtml(e) {
  const authorTag = e.author ? `<span class="author-tag${e.author === '小红' ? ' rose' : ''}">${esc(e.author)}</span>` : '';
  const locTag = e.location && e.location.name ? `<span class="loc-tag">📍 ${esc(e.location.name)}</span>` : '';
  const timeTag = entryTs(e) ? `<span class="time-tag">${fmtTime(entryTs(e))}</span>` : '';
  const photos = (e.photos || []).map((p) => `<img src="${thumbUrl(p)}" data-full="${p}" alt="照片" loading="lazy" onerror="if(this.src!==this.dataset.full){this.src=this.dataset.full}else{this.style.display='none'}">`).join('');
  return `<article class="entry preview-entry">
    <div class="entry-meta">${timeTag}${authorTag}${e.album ? `<span class="album-tag">${esc(e.album)}</span>` : ''}${locTag}</div>
    ${e.title ? `<h3 class="entry-title">${esc(e.title)}</h3>` : ''}
    ${e.text ? `<div class="entry-text">${esc(e.text).replace(/\n/g, '<br>')}</div>` : ''}
    ${photos ? `<div class="photo-grid">${photos}</div>` : ''}
  </article>`;
}

async function renderRecent() {
  const box = $('#recent-list');
  try {
    const data = await (await fetch('/api/entries')).json();
    const list = (data.entries || [])
      .sort((a, b) => (a.date === b.date ? (a.created_at || '') > (b.created_at || '') ? -1 : 1 : a.date > b.date ? -1 : 1))
      .slice(0, 20);
    box.innerHTML = list.length
      ? list.map((e) => `<div class="recent-item">
          <span class="recent-info">${esc(e.date)} <span class="time-tag">${fmtTime(entryTs(e))}</span> ${esc(e.title || '')} · ${esc(e.author || '')}</span>
          <span class="recent-actions">
            <button type="button" class="btn-small btn-prev" data-date="${esc(e.date)}" data-ts="${esc(entryTs(e))}">预览</button>
            <button type="button" class="btn-small btn-edit" data-date="${esc(e.date)}" data-ts="${esc(entryTs(e))}">编辑</button>
            <button type="button" class="btn-small btn-del" data-date="${esc(e.date)}" data-ts="${esc(entryTs(e))}">删除</button>
          </span>
        </div>`).join('')
      : '<p class="empty">还没有条目</p>';
    [...box.querySelectorAll('.btn-prev')].forEach((b) => b.addEventListener('click', () => openPreview(b.dataset.date, b.dataset.ts)));
    [...box.querySelectorAll('.btn-edit')].forEach((b) => b.addEventListener('click', () => enterEdit(b.dataset.date, b.dataset.ts)));
    [...box.querySelectorAll('.btn-del')].forEach((b) => b.addEventListener('click', () => askDelete(b)));
  } catch { /* 忽略 */ }
}

/* ---- 预览(只读弹层,portal 同款卡片) ---- */
async function openPreview(date, ts) {
  const data = await (await fetch(`/api/entries?date=${date}`)).json();
  const e = (data.entries || []).find((x) => String(x.ts) === String(ts));
  if (!e) return alert('条目不存在');
  $('#preview-body').innerHTML = `<div class="preview-date">${esc(e.date)}</div>` + entryCardHtml(e);
  $('#preview-modal').hidden = false;
  $('#preview-body').querySelectorAll('.photo-grid img').forEach((img) => {
    img.addEventListener('click', () => window.open(img.dataset.full || img.src, '_blank'));
  });
}

$('#btn-preview-close').addEventListener('click', () => { $('#preview-modal').hidden = true; });
$('#preview-modal').addEventListener('click', (e) => { if (e.target.id === 'preview-modal') $('#preview-modal').hidden = true; });

/* ---- 编辑 ---- */
async function enterEdit(date, ts) {
  const data = await (await fetch(`/api/entries?date=${date}`)).json();
  const e = (data.entries || []).find((x) => String(x.ts) === String(ts));
  if (!e) return alert('条目不存在');

  editing = { date, ts, photos: e.photos || [] };
  removedPaths = [];
  $('#f-date').value = date;
  $('#f-date').disabled = true; // 日期是主键,编辑不改
  $('#f-title').value = e.title || '';
  $('#f-text').value = e.text || '';
  $('#f-album').value = e.album || '';
  $('#f-location').value = (e.location && e.location.name) || '';
  $('#f-lat').value = $('#f-lng').value = '';
  picked = null;
  $('#f-photos').value = '';
  $('#photo-preview').innerHTML = '';
  $('#success-banner').hidden = true;
  setStatus('编辑模式:可改文字/地点,点照片 ✕ 移除,选新照片追加', false);
  renderEditPhotos();
  $('#btn-submit').textContent = '保存修改';
  $('#btn-cancel-edit').hidden = false;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderEditPhotos() {
  const box = $('#edit-photos');
  if (!editing) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = '<div class="edit-photos-title">现有照片(点 ✕ 移除)</div><div class="edit-photos-grid">' +
    editing.photos.map((p) => `<div class="edit-photo${removedPaths.includes(p) ? ' removed' : ''}">
      <img src="${thumbUrl(p)}" alt="现有照片">
      <button type="button" class="edit-photo-x" data-p="${esc(p)}">✕</button>
      ${removedPaths.includes(p) ? '<span class="edit-photo-mark">待移除</span>' : ''}
    </div>`).join('') + '</div>';
  [...box.querySelectorAll('.edit-photo-x')].forEach((b) => {
    b.addEventListener('click', () => {
      const p = b.dataset.p;
      if (removedPaths.includes(p)) removedPaths = removedPaths.filter((x) => x !== p);
      else removedPaths.push(p);
      renderEditPhotos();
    });
  });
}

function cancelEdit() {
  editing = null;
  removedPaths = [];
  $('#f-date').disabled = false;
  $('#edit-photos').hidden = true;
  $('#btn-submit').textContent = '发布';
  $('#btn-cancel-edit').hidden = true;
  setStatus('', false);
  form.reset();
  $('#photo-preview').innerHTML = ''; // form.reset 不清 div,预览残留会误显示为"待上传"
  $('#f-date').value = new Date().toISOString().slice(0, 10);
  $('#f-location').value = $('#f-lat').value = $('#f-lng').value = '';
  picked = null;
  applyDefaults();
}

$('#btn-cancel-edit').addEventListener('click', cancelEdit);

/* ---- 保存修改 ---- */
async function doUpdate() {
  const date = editing.date;
  const title = $('#f-title').value.trim();
  const text = $('#f-text').value.trim();
  const album = $('#f-album').value.trim() || null;
  const location = $('#f-location').value.trim() || null;
  const lat = $('#f-lat').value;
  const lng = $('#f-lng').value;
  const files = [...$('#f-photos').files];

  const fd = new FormData();
  fd.append('date', date);
  fd.append('ts', editing.ts);
  fd.append('title', title);
  fd.append('text', text);
  fd.append('album', album || '');
  fd.append('location', location || '');
  if (lat && lng) { fd.append('lat', lat); fd.append('lng', lng); }
  fd.append('photos_to_remove', JSON.stringify(removedPaths));

  const btn = $('#btn-submit');
  btn.disabled = true;
  btn.textContent = '保存中...';
  try {
    for (let i = 0; i < files.length; i++) {
      setStatus(`压缩照片 ${i + 1}/${files.length}...`);
      const full = await compressImage(files[i], 1600, 0.85);
      const thumb = await compressImage(files[i], 480, 0.75);
      fd.append('photo_full', full, files[i].name);
      fd.append('photo_thumb', thumb, files[i].name);
    }
    setStatus('保存中...');
    const res = await fetch('/api/update', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      bounceOn401(res);
      return setStatus(data.error || `保存失败(HTTP ${res.status})`, true);
    }
    cancelEdit();
    setStatus('已保存 ✅', false);
    renderRecent();
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = editing ? '保存修改' : '发布';
  }
}

/* ---- 删除(确认弹窗,不可恢复) ---- */
function askDelete(btn) {
  const { date, ts } = btn.dataset;
  if (!confirm(`确定删除 ${date} 的这条日记吗?\n照片会一起删除,无法恢复!`)) return;
  doDelete(date, ts);
}

async function doDelete(date, ts) {
  const fd = new FormData();
  fd.append('date', date);
  fd.append('ts', ts);
  const res = await fetch('/api/delete', { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    bounceOn401(res);
    return alert(data.error || `删除失败(HTTP ${res.status})`);
  }
  alert('已删除 ✅');
  renderRecent();
}

/* ---- 导出行程 ---- */
$('#btn-export').addEventListener('click', () => {
  const from = $('#ex-from').value;
  const to = $('#ex-to').value;
  const st = $('#export-status');
  if (!from || !to) { st.textContent = '请选择起始和结束日期'; st.className = 'form-status error'; return; }
  if (from > to) { st.textContent = '起始日期不能晚于结束日期'; st.className = 'form-status error'; return; }
  const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
  if (days > 60) { st.textContent = '区间最多 60 天'; st.className = 'form-status error'; return; }
  location.href = `/export?from=${from}&to=${to}`;
});

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ---------- 记住上次选择(快速打卡) ---------- */
const LS_ALBUM = 'gg_album';
const LS_LOC_NAME = 'gg_loc_name';
const LS_LOC_LAT = 'gg_loc_lat';
const LS_LOC_LNG = 'gg_loc_lng';

function applyDefaults() {
  $('#f-album').value = localStorage.getItem(LS_ALBUM) || '';
  const loc = localStorage.getItem(LS_LOC_NAME);
  if (loc) {
    $('#f-location').value = loc;
    $('#f-lat').value = localStorage.getItem(LS_LOC_LAT) || '';
    $('#f-lng').value = localStorage.getItem(LS_LOC_LNG) || '';
  }
}

function rememberDefaults() {
  localStorage.setItem(LS_ALBUM, $('#f-album').value.trim() || '');
  const loc = $('#f-location').value.trim();
  if (loc) {
    localStorage.setItem(LS_LOC_NAME, loc);
    localStorage.setItem(LS_LOC_LAT, $('#f-lat').value);
    localStorage.setItem(LS_LOC_LNG, $('#f-lng').value);
  } else {
    localStorage.removeItem(LS_LOC_NAME);
    localStorage.removeItem(LS_LOC_LAT);
    localStorage.removeItem(LS_LOC_LNG);
  }
}

/* 默认日期 = 今天;先探测登录态,再初始化编辑器数据 */
$('#f-date').value = new Date().toISOString().slice(0, 10);
applyDefaults();
initAuth();
loadAlbums();
renderRecent();
