/* 咕咕嘎嘎 - 写日记(前端压缩 + 地图选点 + 上传 + 删除管理) */
'use strict';

const $ = (s) => document.querySelector(s);
const form = $('#diary-form');

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

/* ---------- 选点器(搜索优先,微信/高德式全屏) ---------- */
let pickerMap = null;
let picked = null; // { name, lat, lng }
let amapKey = '';  // 高德 JS key(经 /api/config 下发;空=纯浏览器定位)

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

function loadAmap(key) {
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
    document.head.appendChild(s);
  });
}

async function fetchConfig() {
  try {
    const res = await (await fetch('/api/config')).json();
    amapKey = res.amap_key || '';
  } catch { amapKey = ''; }
}

let amapReadyPromise = null; // 高德 SDK+插件就绪(含等待,避免首次加载抢跑)
function ensureAmap() {
  if (window.AMap && window.AMap.Geocoder && window.AMap.PlaceSearch) return Promise.resolve(true);
  if (!amapKey) return Promise.resolve(false);
  if (!amapReadyPromise) {
    amapReadyPromise = loadAmap(amapKey)
      .then(() => !!(window.AMap && window.AMap.Geocoder && window.AMap.PlaceSearch))
      .catch(() => false);
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
  // 预载高德 SDK(key 已配置时),让搜索/反查直接用高德(快+准)
  try {
    await fetchConfig();
    if (amapKey) await loadAmap(amapKey);
  } catch { /* 高德不可用则走服务端回退 */ }
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
          renderNearby((r && r.nearby) || [], lat, lng);
        }
      } catch { /* 反查失败保持自定义位置 */ }
    }
  });
}

function placeMarker(lat, lng) {
  if (!pickerMap) return;
  if (pickerMap._marker) pickerMap.removeLayer(pickerMap._marker);
  pickerMap._marker = L.marker([lat, lng], { icon: L.divIcon({ className: 'gg-marker', html: '📍', iconSize: [24, 24], iconAnchor: [12, 24] }) }).addTo(pickerMap);
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
    renderLocResults(res.results || []);
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
    (pos) => done(pos.coords.latitude, pos.coords.longitude),
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
  const author = $('#f-author').value || '球';
  const location = $('#f-location').value.trim() || null;
  const lat = $('#f-lat').value;
  const lng = $('#f-lng').value;
  const files = [...$('#f-photos').files];

  if (!date) return setStatus('请选择日期', true);
  if (!title && !text && files.length === 0) return setStatus('至少填标题/文字/照片之一', true);

  const fd = new FormData();
  fd.append('date', date);
  fd.append('author', author);
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
    if (!res.ok) return setStatus(data.error || `上传失败(HTTP ${res.status})`, true);

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

function entryCardHtml(e) {
  const authorTag = e.author ? `<span class="author-tag${e.author === '小红' ? ' rose' : ''}">${esc(e.author)}</span>` : '';
  const locTag = e.location && e.location.name ? `<span class="loc-tag">📍 ${esc(e.location.name)}</span>` : '';
  const photos = (e.photos || []).map((p) => `<img src="${thumbUrl(p)}" data-full="${p}" alt="照片" loading="lazy" onerror="if(this.src!==this.dataset.full){this.src=this.dataset.full}else{this.style.display='none'}">`).join('');
  return `<article class="entry preview-entry">
    <div class="entry-meta">${authorTag}${e.album ? `<span class="album-tag">${esc(e.album)}</span>` : ''}${locTag}</div>
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
          <span class="recent-info">${esc(e.date)} ${esc(e.title || '')} · ${esc(e.author || '')}</span>
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
  $('#f-author').value = e.author || '球';
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
  const pin = window.prompt('保存修改需要口令(4 位 PIN):');
  if (pin === null) return;
  const date = editing.date;
  const title = $('#f-title').value.trim();
  const text = $('#f-text').value.trim();
  const album = $('#f-album').value.trim() || null;
  const author = $('#f-author').value || '球';
  const location = $('#f-location').value.trim() || null;
  const lat = $('#f-lat').value;
  const lng = $('#f-lng').value;
  const files = [...$('#f-photos').files];

  const fd = new FormData();
  fd.append('pin', pin.trim());
  fd.append('date', date);
  fd.append('ts', editing.ts);
  fd.append('author', author);
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
    if (!res.ok) return setStatus(data.error || `保存失败(HTTP ${res.status})`, true);
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

/* ---- 删除(需 PIN) ---- */
function askDelete(btn) {
  const { date, ts } = btn.dataset;
  const pin = window.prompt(`删除 ${date} 的这条?输入删除口令(4 位 PIN):`);
  if (pin === null) return;
  doDelete(date, ts, pin.trim());
}

async function doDelete(date, ts, pin) {
  const fd = new FormData();
  fd.append('date', date);
  fd.append('ts', ts);
  fd.append('pin', pin);
  const res = await fetch('/api/delete', { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return alert(data.error || `删除失败(HTTP ${res.status})`);
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
const LS_AUTHOR = 'gg_author';
const LS_ALBUM = 'gg_album';
const LS_LOC_NAME = 'gg_loc_name';
const LS_LOC_LAT = 'gg_loc_lat';
const LS_LOC_LNG = 'gg_loc_lng';

function applyDefaults() {
  $('#f-author').value = localStorage.getItem(LS_AUTHOR) || '球';
  $('#f-album').value = localStorage.getItem(LS_ALBUM) || '';
  const loc = localStorage.getItem(LS_LOC_NAME);
  if (loc) {
    $('#f-location').value = loc;
    $('#f-lat').value = localStorage.getItem(LS_LOC_LAT) || '';
    $('#f-lng').value = localStorage.getItem(LS_LOC_LNG) || '';
  }
}

function rememberDefaults() {
  localStorage.setItem(LS_AUTHOR, $('#f-author').value || '球');
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

/* 默认日期 = 今天 */
$('#f-date').value = new Date().toISOString().slice(0, 10);
applyDefaults();
loadAlbums();
renderRecent();
