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

/* ---------- 地图选点 ---------- */
let pickerMap = null;
let picked = null; // { name, lat, lng }

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

async function openPicker() {
  const panel = $('#loc-panel');
  panel.hidden = false;
  try {
    await loadLeaflet();
  } catch {
    setStatus('地图加载失败,可手动输入地名', true);
    return;
  }
  if (!pickerMap) {
    pickerMap = L.map('loc-map', { scrollWheelZoom: false }).setView([30.57, 104.07], 5);
    L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
      maxZoom: 18,
      subdomains: ['1', '2', '3', '4'],
      attribution: '&copy; 高德地图',
    }).addTo(pickerMap);
    pickerMap.on('click', async (ev) => {
      const { lat, lng } = ev.latlng;
      placeMarker(lat, lng);
      // 先立即落定,反查地名成功后升级
      picked = { name: '自定义位置', lat, lng };
      $('#f-location').value = picked.name;
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const res = await (await fetch(`/api/geocode?lat=${lat}&lng=${lng}`, { signal: ctrl.signal })).json();
        clearTimeout(timer);
        const r = res.results && res.results[0];
        if (r) {
          picked = { name: r.name, lat, lng };
          $('#f-location').value = r.name;
        }
      } catch {
        /* 反查失败保持自定义位置 */
      }
    });
  }
  setTimeout(() => pickerMap.invalidateSize(), 100);
}

function placeMarker(lat, lng) {
  if (!pickerMap) return;
  if (pickerMap._marker) pickerMap.removeLayer(pickerMap._marker);
  pickerMap._marker = L.marker([lat, lng]).addTo(pickerMap);
}

async function pickResult(r) {
  picked = { name: r.name, lat: r.lat, lng: r.lng };
  $('#f-location').value = r.name;
  $('#loc-results').innerHTML = '';
  placeMarker(r.lat, r.lng);
  pickerMap.setView([r.lat, r.lng], 13);
}

$('#btn-loc').addEventListener('click', openPicker);
$('#btn-loc-done').addEventListener('click', () => {
  $('#loc-panel').hidden = true;
  if (picked) {
    $('#f-lat').value = picked.lat;
    $('#f-lng').value = picked.lng;
    setStatus(`已选位置:${picked.name}`, false);
  }
});
$('#btn-loc-search').addEventListener('click', async () => {
  const q = $('#loc-search').value.trim();
  if (!q) return;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const res = await (await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })).json();
    clearTimeout(timer);
    $('#loc-results').innerHTML = (res.results || [])
      .map((r, i) => `<button type="button" class="loc-result" data-i="${i}">${r.name}</button>`)
      .join('');
    [...document.querySelectorAll('.loc-result')].forEach((b, i) => {
      b.addEventListener('click', () => pickResult(res.results[i]));
    });
  } catch {
    setStatus('搜索超时,换个关键词或直接点地图', true);
  }
});
$('#btn-loc-current').addEventListener('click', () => {
  if (!navigator.geolocation) return setStatus('浏览器不支持定位', true);
  setStatus('定位中...');
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const { latitude, longitude } = pos.coords;
    placeMarker(latitude, longitude);
    picked = { name: '当前位置', lat: latitude, lng: longitude };
    $('#f-location').value = picked.name;
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 6000);
      const res = await (await fetch(`/api/geocode?lat=${latitude}&lng=${longitude}`, { signal: ctrl.signal })).json();
      clearTimeout(timer);
      const r = res.results && res.results[0];
      if (r) { picked = { name: r.name, lat: latitude, lng: longitude }; $('#f-location').value = r.name; }
    } catch { /* 保持当前位置 */ }
    if (pickerMap) pickerMap.setView([latitude, longitude], 14);
    setStatus(`已选位置:${picked.name}`, false);
  }, () => setStatus('定位失败(需要浏览器位置权限)', true), { enableHighAccuracy: true });
});

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

    // 成功:横幅 + 清空表单
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
  doUpload();
});
$('#f-photos').addEventListener('change', renderPreview);

/* ---------- 最近条目 + 删除 ---------- */
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
          <button type="button" class="btn-small btn-del" data-date="${esc(e.date)}" data-ts="${esc((e.created_at || '').replace(/\D/g, '').slice(0, 13))}">删除</button>
        </div>`).join('')
      : '<p class="empty">还没有条目</p>';
    [...box.querySelectorAll('.btn-del')].forEach((b) => b.addEventListener('click', () => askDelete(b)));
  } catch { /* 忽略 */ }
}

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

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* 默认日期 = 今天 */
$('#f-date').value = new Date().toISOString().slice(0, 10);
loadAlbums();
renderRecent();
