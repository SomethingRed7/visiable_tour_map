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
  if (user) {
    $('#current-user').textContent = user;
    // ⚠️ 不做自动定位:页面加载/登录时发起 geolocation 属非手势请求,
    // Chrome 会拒绝并污染权限状态,导致用户手动点击定位也失败(2026-08-15 用户反馈换浏览器都定不上)
  } else showLoginPanel();
}

/* ---------- 进入界面自动定位(后台,不打扰;失败静默,不覆盖已有值) ---------- */
let autoFilled = false;
async function autoFillLocation() {
  if (autoFilled) return;
  autoFilled = true;
  if ($('#f-location').value) return; // 编辑预填/已有地点不覆盖
  // 并行定位:高德 + 浏览器竞争(高德 SDK 加载卡住也不阻塞浏览器源)
  const pos = await getPositionWithFallback();
  if (!pos) return; // 定位失败静默,留空让用户手动选
  const lat = pos.lat, lng = pos.lng;
  // 反查地名:高德客户端优先,失败回退服务端(同样带超时)
  let name = '';
  const amapReady2 = await Promise.race([
    ensureAmap(),
    new Promise((resolve) => setTimeout(() => resolve(false), 6000)),
  ]);
  if (amapReady2) {
    try {
      const gc = new AMap.Geocoder({ extensions: 'all' });
      const rev = await new Promise((resolve) => gc.getAddress([lng, lat], (st, r) => {
        resolve(st === 'complete' && r && r.regeocode ? r.regeocode : null);
      }));
      if (rev) {
        const pois = (rev.pois || []).filter((p) => p && p.name);
        name = pois[0] ? pois[0].name : (rev.formattedAddress || '');
      }
    } catch { /* 回退 */ }
  }
  if (!name) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 12000);
      const res = await (await fetch(`/api/geocode?lat=${lat}&lng=${lng}`, { signal: ctrl.signal })).json();
      clearTimeout(timer);
      const r = res.results && res.results[0];
      if (r) name = r.name;
    } catch { /* 保持空 */ }
  }
  if (!name || $('#f-location').value) return; // 反查失败/用户已手动填 → 不打扰
  selectPoint(name, lat, lng);
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

/* 相册 select(原生下拉,移动端兼容;datalist 在微信/安卓 WebView 表现差已弃用) */
async function loadAlbums() {
  try {
    const data = await (await fetch('/api/entries')).json();
    const albums = [...new Set((data.entries || []).map((e) => e.album).filter(Boolean))];
    const sel = $('#f-album');
    // 记住上次选择(applyDefaults 在 select 填充前赋值会失败,这里兜底读 localStorage)
    const current = sel.value || localStorage.getItem(LS_ALBUM) || '';
    sel.innerHTML = '<option value="">不设专辑</option>' +
      albums.map((a) => `<option value="${a.replace(/"/g, '&quot;')}">${a.replace(/"/g, '&quot;')}</option>`).join('') +
      '<option value="__new__">➕ 新建专辑…</option>';
    // 恢复之前的值(编辑回填/记住上次选择)
    if (current) {
      const exists = [...sel.options].some((o) => o.value === current);
      if (exists) sel.value = current;
      else if (current !== '__new__') {
        // 当前值不在列表(如老条目专辑):补一个选项并选中
        const o = document.createElement('option');
        o.value = current;
        o.textContent = current;
        sel.insertBefore(o, sel.lastChild);
        sel.value = current;
      }
    }
  } catch { /* 忽略,保留默认选项 */ }
  window.__albumsLoaded = true; // 供 URL 参数编辑态等待 select 就绪
}

$('#f-album').addEventListener('change', () => {
  const sel = $('#f-album');
  if (sel.value !== '__new__') return;
  const name = prompt('新专辑名字:');
  if (name && name.trim()) {
    const v = name.trim();
    const exists = [...sel.options].some((o) => o.value === v);
    if (!exists) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = v;
      sel.insertBefore(o, sel.lastChild);
    }
    sel.value = v;
  } else {
    sel.value = ''; // 取消 → 回到「不设专辑」
  }
});

/* 照片预览(与打卡弹窗一致:方形缩略图,无文件名) */
function renderPreview() {
  const files = [...$('#f-photos').files];
  $('#photo-preview').innerHTML = files
    .map((f, i) => `<div class="preview-item"><img src="${URL.createObjectURL(f)}" alt="预览 ${i + 1}"></div>`)
    .join('');
}

/* ---------- 坐标系统转换 ----------
 * 高德瓦片/高德 API 用 GCJ-02(火星坐标);Nominatim/Overpass/浏览器定位是 WGS-84。
 * 在 WGS-84 来源的数据进入存储前统一转 GCJ-02,否则图钉画在高德瓦片上偏几百米。
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
  // ⚠️ 不做自动定位:setTimeout 后已无用户手势,geolocation 会被 Chrome 拒绝
  // 用户明确点「📍 定位」按钮(locateCurrent)时才请求
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

// 定位:高德 + 浏览器并行竞争,谁先成功用谁(此前高德失败即 fail,从不降级浏览器 → 定位经常失败)
// 返回 { lat, lng }(GCJ-02)或 null;高德定位结果即 GCJ-02,浏览器 WGS-84 需转换
async function getPositionWithFallback() {
  let amapReady = false;
  try { await fetchConfig(); } catch { amapKey = ''; }
  amapReady = await Promise.race([ensureAmap(), new Promise((r) => setTimeout(() => r(false), 6000))]);

  const amapP = amapReady
    ? new Promise((resolve) => {
        try {
          const gl = new AMap.Geolocation({ enableHighAccuracy: true, timeout: 10000 });
          gl.getCurrentPosition((status, result) => {
            if (status === 'complete' && result && result.position) {
              resolve({ lat: result.position.getLat(), lng: result.position.getLng() });
            } else resolve(null);
          });
        } catch { resolve(null); }
      })
    : Promise.resolve(null);

  const browserP = navigator.geolocation
    ? new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(
          // 浏览器定位 = WGS-84,转 GCJ-02 再落点(否则图钉偏几百米)
          (pos) => resolve(wgs2gcj(pos.coords.latitude, pos.coords.longitude)),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      })
    : Promise.resolve(null);

  // 两个源同时跑,谁先返回非 null 用谁(不等最慢的;一个失败不阻塞另一个)
  return firstSuccess([amapP, browserP]);
}

// 竞争取第一个非 null 结果(全部失败返回 null)
async function firstSuccess(promises) {
  const wrappers = promises.map((p, i) => p.then((v) => ({ i, v })));
  const done = new Set();
  while (done.size < wrappers.length) {
    const remaining = wrappers.filter((_, i) => !done.has(i));
    const { i, v } = await Promise.race(remaining);
    done.add(i);
    if (v) return v;
  }
  return null;
}

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
  const fail = (err) => {
    // 显示具体错误码:1=权限被拒 2=位置不可用(系统定位关/无GPS) 3=超时
    let detail = '';
    if (err) {
      const map = { 1: '(权限被拒)', 2: '(定位服务不可用)', 3: '(定位超时)' };
      detail = ' ' + (map[err.code] || '(错误' + err.code + ')');
    }
    st.textContent = (/MicroMessenger/i.test(navigator.userAgent)
      ? '微信内无法定位,请点右上角 ⋯ 选「在浏览器打开」后重试,或直接搜索/点地图选'
      : '定位失败:' + (detail || '检查位置权限/系统定位后重试') + ',或直接搜索/点地图选');
  };

  // 微信内置浏览器直接提示(微信禁 H5 定位,getCurrentPosition 会挂起不回调,不等超时浪费体验)
  if (/MicroMessenger/i.test(navigator.userAgent)) {
    st.textContent = '微信内无法定位:点右上角 ⋯ 选「在浏览器打开」后重试,或直接搜索/点地图选';
    return;
  }
  // 关键时序:Chrome 要求 getCurrentPosition 在用户手势激活期内同步调用,
  // 先 await 高德会过期手势 → 直接拒绝不弹权限框。所以浏览器定位立即启动。
  // ⚠️ 不再并行 getPositionWithFallback:它会再发一个浏览器请求(某些浏览器拒绝并发,
  // 还会抢走手势激活窗口)→ 这里只保留唯一一个浏览器定位请求。
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
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
    );
  } else {
    failOnce();
  }
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
  fd.append('visibility', $('#f-visibility').value === 'private' ? 'private' : 'public');
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
    if (typeof renderRecent === 'function') renderRecent();
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

/* 地点名截短:只显示第一段短名(如「杭州东站」,忽略完整地址逗号串) */
function shortLoc(name) {
  const s = String(name || '').split(/[,，]/)[0].trim();
  return (s || String(name || '')).slice(0, 30);
}
function entryCardHtml(e) {
  const authorTag = e.author ? `<span class="author-tag${e.author === '小红' ? ' rose' : ''}">${esc(e.author)}</span>` : '';
  const locTag = e.location && e.location.name ? `<span class="loc-tag">📍 ${esc(shortLoc(e.location.name))}</span>` : '';
  const timeTag = entryTs(e) ? `<span class="time-tag">${fmtTime(entryTs(e))}</span>` : '';
  const visTag = e.visibility === 'private' ? '<span class="vis-tag">私有</span>' : '';
  const photos = (e.photos || []).map((p) => `<img src="${thumbUrl(p)}" data-full="${p}" alt="照片" loading="lazy">`).join('');
  return `<article class="entry preview-entry">
    <div class="entry-meta">${timeTag}${authorTag}${visTag}${e.album ? `<span class="album-tag">${esc(e.album)}</span>` : ''}${locTag}</div>
    ${e.title ? `<h3 class="entry-title">${esc(e.title)}</h3>` : ''}
    ${e.text ? `<div class="entry-text">${esc(e.text).replace(/\n/g, '<br>')}</div>` : ''}
    ${photos ? `<div class="photo-grid">${photos}</div>` : ''}
  </article>`;
}
// 照片兜底:缩略图 404 → 回退全图;全图也挂 → 隐藏(CSP 禁内联 onerror,必须 addEventListener)
function bindPhotoGridFallback(container) {
  container.querySelectorAll('.photo-grid img').forEach((img) => {
    const fb = () => {
      if (img.src !== img.dataset.full) img.src = img.dataset.full;
      else img.style.display = 'none';
    };
    img.addEventListener('error', fb);
    if (img.complete && img.naturalWidth === 0) fb();
    // 横图(宽>高)加 landscape 类 → 单列占满整行(竖图保持双列)
    const mark = () => { if (img.naturalWidth > img.naturalHeight) img.classList.add('landscape'); };
    if (img.complete) mark();
    else img.addEventListener('load', mark);
  });
}
/* ---- 编辑 ---- */
let editing = null;    // { date, ts, photos }
let removedPaths = []; // 编辑中要删除的照片路径

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
  // select 回填:专辑不在选项列表(老条目)时先补一个选项再选中
  const albumSel = $('#f-album');
  if (e.album) {
    const exists = [...albumSel.options].some((o) => o.value === e.album);
    if (!exists) {
      const o = document.createElement('option');
      o.value = e.album;
      o.textContent = e.album;
      albumSel.insertBefore(o, albumSel.lastChild);
    }
  }
  albumSel.value = e.album || '';
  $('#f-visibility').value = e.visibility === 'private' ? 'private' : 'public'; // 仅展示,保存走 doUpdate(不提交可见性)
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
    if (typeof renderRecent === 'function') renderRecent();
  } catch (e) {
    setStatus(e.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = editing ? '保存修改' : '发布';
  }
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
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/* ---------- 记住上次选择(仅专辑;地点不再自动恢复,避免自动定位失败时残留旧地点误导) ---------- */
const LS_ALBUM = 'gg_album';
// 地点不再记住/恢复:进入界面一律走自动定位,失败留空由用户手动选(2026-08-14 用户反馈)

function applyDefaults() {
  $('#f-album').value = localStorage.getItem(LS_ALBUM) || '';
}

function rememberDefaults() {
  localStorage.setItem(LS_ALBUM, $('#f-album').value.trim() || '');
  // 旧版残留的地点键清掉,防历史数据回灌
  localStorage.removeItem('gg_loc_name');
  localStorage.removeItem('gg_loc_lat');
  localStorage.removeItem('gg_loc_lng');
}
/* ---------- 日期选择弹层(替代原生 date input,跨端观感统一) ---------- */
const dp = {
  viewY: 0, viewM: 0, // 当前翻页所在的年月
};
function renderDatePicker() {
  const grid = $('#dp-grid');
  const first = new Date(dp.viewY, dp.viewM, 1);
  const startWeekday = first.getDay(); // 0=周日
  const daysInMonth = new Date(dp.viewY, dp.viewM + 1, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);
  const cur = $('#f-date').value;
  $('#dp-title').textContent = `${dp.viewY}年${dp.viewM + 1}月`;
  let html = '';
  for (let i = 0; i < startWeekday; i++) html += '<span></span>';
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${dp.viewY}-${String(dp.viewM + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const cls = ['dp-day', ds === todayStr ? 'today' : '', ds === cur ? 'selected' : ''].filter(Boolean).join(' ');
    html += `<button type="button" class="${cls}" data-ds="${ds}">${d}</button>`;
  }
  grid.innerHTML = html;
}
function openDatePicker() {
  if ($('#f-date').disabled) return; // 编辑态日期锁定,不弹
  const cur = $('#f-date').value;
  if (cur) {
    const [y, m] = cur.split('-').map(Number);
    dp.viewY = y; dp.viewM = m - 1;
  } else {
    const t = new Date();
    dp.viewY = t.getFullYear(); dp.viewM = t.getMonth();
  }
  renderDatePicker();
  $('#date-picker').hidden = false;
}
$('#f-date').addEventListener('click', openDatePicker);
$('#dp-prev').addEventListener('click', (e) => { e.stopPropagation(); dp.viewM--; if (dp.viewM < 0) { dp.viewM = 11; dp.viewY--; } renderDatePicker(); });
$('#dp-next').addEventListener('click', (e) => { e.stopPropagation(); dp.viewM++; if (dp.viewM > 11) { dp.viewM = 0; dp.viewY++; } renderDatePicker(); });
$('#dp-grid').addEventListener('click', (e) => {
  const b = e.target.closest('.dp-day');
  if (!b) return;
  $('#f-date').value = b.dataset.ds;
  $('#date-picker').hidden = true;
});
document.addEventListener('click', (e) => {
  const picker = $('#date-picker');
  if (picker.hidden) return;
  if (!picker.contains(e.target) && e.target.id !== 'f-date') picker.hidden = true;
});
/* 默认日期 = 今天;先探测登录态,再初始化编辑器数据 */
$('#f-date').value = new Date().toISOString().slice(0, 10);
applyDefaults();
initAuth();
loadAlbums();

/* 从管理页跳转进入编辑态:?date=X&ts=Y */
(function () {
  const p = new URLSearchParams(location.search);
  const d = p.get('date');
  const t = p.get('ts');
  if (d && t) {
    // 等登录态 + 专辑 select 填充完成后回填(enterEdit 需要 f-album 选项就绪)
    const tryEdit = () => {
      if (!document.querySelector('#login-panel').hidden) return setTimeout(tryEdit, 300); // 未登录,等登录
      if (!window.__albumsLoaded) return setTimeout(tryEdit, 200);
      setTimeout(() => enterEdit(d, t), 50);
    };
    tryEdit();
  }
})();
