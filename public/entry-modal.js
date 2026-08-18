/* 咕咕嘎嘎 - 日记弹窗(新建/编辑普通条目;打卡弹窗同款样式)
 * 首页(index.html)与管理页(write.html)共用;入口:EntryModal.open({date, entry, onSaved})
 *   date    : 新建时默认日期(YYYY-MM-DD);编辑时忽略
 *   entry   : 编辑时条目对象(含 date/ts/title/text/album/visibility/location/photos)
 *   onSaved : 保存成功回调(调用方刷新列表/日历)
 * 保存:新建 → POST /api/upload(photo_full/photo_thumb 压缩后);编辑 → POST /api/update(photos_to_remove)
 * 写日记页 /edit 保留:长内容/正式记录用。
 */
'use strict';

var $ = (s) => document.querySelector(s);

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function emThumbUrl(p) { return p.replace(/\.(jpg|jpeg|png)$/i, '-thumb.$1'); }

/* 图片压缩(与写日记页同款:canvas 等比缩放 + JPEG) */
function emCompressImage(file, maxLen, quality) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxLen / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
    img.src = url;
  });
}

/* 弹窗状态 */
let emState = { entry: null, removedPaths: [], lat: null, lng: null, files: [] };

function emSetStatus(msg, isErr) {
  const el = $('#em-status');
  if (!el) return;
  el.textContent = msg;
  el.className = 'form-status' + (isErr ? ' error' : '');
}

/* 专辑下拉(与打卡弹窗同款:已有专辑 + 新建;编辑时保留已选) */
async function emLoadAlbums() {
  const sel = $('#em-album');
  if (!sel) return;
  const prev = sel.value;
  try {
    const data = await (await fetch('/api/entries')).json();
    const albums = [...new Set((data.entries || []).map((e) => e.album).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">不设专辑</option>'
      + albums.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('')
      + '<option value="__new__">➕ 新建专辑…</option>';
  } catch { /* 保持默认 */ }
  if (prev) sel.value = prev;
}

function emClose() {
  const modal = $('#entry-modal');
  if (modal) modal.hidden = true;
}

function emOpen(opts) {
  const modal = $('#entry-modal');
  if (!modal) return;
  opts = opts || {};
  const entry = opts.entry || null;
  emState = { entry, removedPaths: [], lat: null, lng: null, files: [] };

  // 标题/日期
  $('#em-title').textContent = entry ? '编辑日记' : '写日记';
  $('#em-save').textContent = entry ? '保存修改' : '发布';
  $('#em-title-input').value = entry ? (entry.title || '') : '';
  $('#em-date').value = entry ? entry.date : (opts.date || new Date().toISOString().slice(0, 10));
  $('#em-date').disabled = !!entry; // 日期是主键,编辑不改
  $('#em-text').value = entry ? (entry.text || '') : '';
  $('#em-vis').value = entry && entry.visibility === 'private' ? 'private' : 'public';

  // 专辑(先填充再回填,勿用固定延时)
  emLoadAlbums().then(() => {
    if (entry && entry.album) {
      const exists = [...$('#em-album').options].some((o) => o.value === entry.album);
      if (!exists) {
        const o = document.createElement('option');
        o.value = entry.album;
        o.textContent = entry.album;
        $('#em-album').insertBefore(o, $('#em-album').lastChild);
      }
      $('#em-album').value = entry.album;
    } else {
      $('#em-album').value = '';
    }
  });

  // 地点 + 坐标
  const loc = (entry && entry.location) || {};
  $('#em-loc').value = loc.name || '';
  emState.lat = loc.lat != null && Number.isFinite(Number(loc.lat)) ? Number(loc.lat) : null;
  emState.lng = loc.lng != null && Number.isFinite(Number(loc.lng)) ? Number(loc.lng) : null;

  // 照片
  const existingBox = $('#em-existing');
  const newPrev = $('#em-new-preview');
  $('#em-files').value = '';
  newPrev.hidden = true;
  newPrev.innerHTML = '';
  if (entry && (entry.photos || []).length) {
    existingBox.hidden = false;
    existingBox.innerHTML = (entry.photos || []).map((p) => `
      <div class="ckin-old${emState.removedPaths.includes(p) ? ' removed' : ''}">
        <img src="${emThumbUrl(p)}" data-full="${esc(p)}" alt="现有照片">
        <button type="button" class="ckin-old-x" data-p="${esc(p)}" title="移除">✕</button>
        ${emState.removedPaths.includes(p) ? '<span class="em-mark">待移除</span>' : ''}
      </div>`).join('');
    existingBox.querySelectorAll('.ckin-old-x').forEach((b) => {
      b.addEventListener('click', () => {
        const p = b.dataset.p;
        if (emState.removedPaths.includes(p)) emState.removedPaths = emState.removedPaths.filter((x) => x !== p);
        else emState.removedPaths.push(p);
        const wrap = b.closest('.ckin-old');
        wrap.classList.toggle('removed', emState.removedPaths.includes(p));
        const mark = wrap.querySelector('.em-mark');
        if (emState.removedPaths.includes(p)) {
          if (!mark) {
            const m = document.createElement('span');
            m.className = 'em-mark';
            m.textContent = '待移除';
            wrap.appendChild(m);
          }
        } else if (mark) mark.remove();
      });
    });
  } else {
    existingBox.hidden = true;
    existingBox.innerHTML = '';
  }

  emSetStatus('');
  modal.hidden = false;
}

/* 📍 定位:浏览器定位(手势同步栈内唯一请求)→ 校准 → 反查地名(与写日记页同链路) */
function emLocate() {
  const st = $('#em-status');
  st.textContent = '定位中...';
  if (!navigator.geolocation) {
    st.textContent = '浏览器不支持定位,用 🗺️ 地图选点';
    return;
  }
  navigator.geolocation.getCurrentPosition(async (pos) => {
    try {
      const g = await LocPicker.lpCalibrate(pos.coords.latitude, pos.coords.longitude);
      emState.lat = g.lat;
      emState.lng = g.lng;
      const input = $('#em-loc');
      input.value = `${g.lat.toFixed(5)},${g.lng.toFixed(5)}`;
      try {
        const r = await (await fetch(`/api/geocode?lat=${g.lat}&lng=${g.lng}`)).json();
        const res = r.results && r.results[0];
        if (res && res.name) input.value = res.name.slice(0, 80);
      } catch { /* 保留坐标串 */ }
      st.textContent = '';
    } catch { st.textContent = '定位失败,用 🗺️ 地图选点'; }
  }, (err) => {
    if (err.code === 1) st.textContent = '定位被拒绝:点地址栏左侧图标 → 网站设置 → 允许位置';
    else st.textContent = '定位失败,用 🗺️ 地图选点';
  }, { enableHighAccuracy: true, timeout: 12000 });
}

/* 🗺️ 地图选点(共享 loc-picker.js;有坐标时从该点开始) */
function emOpenMap() {
  LocPicker.open({
    lat: emState.lat != null ? emState.lat : undefined,
    lng: emState.lng != null ? emState.lng : undefined,
    onPick: (name, lat, lng) => {
      $('#em-loc').value = name;
      emState.lat = lat;
      emState.lng = lng;
    },
  });
}

/* 新照片预览(打卡同款虚线框 + 方形缩略图) */
function emRenderNewPhotos() {
  const box = $('#em-new-preview');
  const files = [...$('#em-files').files];
  if (!files.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = files
    .map((f, i) => `<div class="preview-item"><img src="${URL.createObjectURL(f)}" alt="预览 ${i + 1}"></div>`)
    .join('');
}

/* 保存:新建 → /api/upload;编辑 → /api/update */
async function emSave() {
  const btn = $('#em-save');
  if (btn.disabled) return;
  const date = $('#em-date').value;
  const title = $('#em-title-input').value.trim();
  const text = $('#em-text').value.trim();
  const albumRaw = $('#em-album').value;
  const vis = $('#em-vis').value;
  const location = $('#em-loc').value.trim() || null;
  const files = [...$('#em-files').files];

  if (!date) return emSetStatus('请选择日期', true);

  // 专辑:选中「➕ 新建专辑…」→ prompt 输入
  let album = albumRaw;
  if (albumRaw === '__new__') {
    album = prompt('新专辑名字:');
    if (!album) return emSetStatus('专辑名不能为空', true);
    album = album.trim().slice(0, 50);
    if (!album) return emSetStatus('专辑名不能为空', true);
  }

  const fd = new FormData();
  fd.append('date', date);
  if (emState.entry) {
    fd.append('ts', emState.entry.ts);
    fd.append('title', title);
    fd.append('text', text);
    fd.append('album', album || '');
    fd.append('visibility', vis);
    fd.append('location', location || '');
    if (emState.lat != null && emState.lng != null) {
      fd.append('lat', emState.lat);
      fd.append('lng', emState.lng);
    }
    fd.append('photos_to_remove', JSON.stringify(emState.removedPaths));
  } else {
    fd.append('title', title);
    fd.append('text', text);
    fd.append('visibility', vis);
    fd.append('album', album || '');
    fd.append('location', location || '');
    if (emState.lat != null && emState.lng != null) {
      fd.append('lat', emState.lat);
      fd.append('lng', emState.lng);
    }
  }

  btn.disabled = true;
  btn.textContent = emState.entry ? '保存中...' : '发布中...';
  try {
    // 新照片压缩(≤20 张,单文件 ≤10MB 由服务端校验)
    for (let i = 0; i < files.length; i++) {
      emSetStatus(`压缩照片 ${i + 1}/${files.length}...`);
      const full = await emCompressImage(files[i], 1600, 0.85);
      const thumb = await emCompressImage(files[i], 480, 0.75);
      fd.append('photo_full', full, files[i].name);
      fd.append('photo_thumb', thumb, files[i].name);
    }
    emSetStatus(emState.entry ? '保存中...' : '发布中...');
    const url = emState.entry ? '/api/update' : '/api/upload';
    const res = await fetch(url, { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) { emClose(); if (typeof bounceOn401 === 'function') bounceOn401(res); }
      return emSetStatus(data.error || `失败(HTTP ${res.status})`, true);
    }
    emClose();
    if (emState.__onSaved) emState.__onSaved();
    emSetStatus('');
  } catch (e) {
    emSetStatus(e.message || '网络异常,请重试', true);
  } finally {
    btn.disabled = false;
    btn.textContent = emState.entry ? '保存修改' : '发布';
  }
}

/* 初始化绑定 */
function emInit() {
  const modal = $('#entry-modal');
  if (!modal) return;
  const closeBtn = $('#em-close');
  if (closeBtn) closeBtn.addEventListener('click', emClose);
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) emClose(); });
  const locate = $('#em-locate');
  if (locate) locate.addEventListener('click', emLocate);
  const mapBtn = $('#em-map');
  if (mapBtn) mapBtn.addEventListener('click', emOpenMap);
  const files = $('#em-files');
  if (files) files.addEventListener('change', emRenderNewPhotos);
  const save = $('#em-save');
  if (save) save.addEventListener('click', emSave);
}

/* 公共 API(调用方在 open 时传 onSaved) */
window.EntryModal = {
  open(opts) {
    emState.__onSaved = (opts && opts.onSaved) || null;
    emOpen(opts || {});
  },
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', emInit);
else emInit();
