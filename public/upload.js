/* 咕咕嘎嘎 - 写日记(前端压缩 + 上传) */
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

async function doUpload() {
  const date = $('#f-date').value;
  const title = $('#f-title').value.trim();
  const text = $('#f-text').value.trim();
  const album = $('#f-album').value.trim() || null;
  const author = $('#f-author').value || '球';
  const location = $('#f-location').value.trim() || null;
  const pass = $('#f-pass').value.trim();
  const files = [...$('#f-photos').files];

  if (!date) return setStatus('请选择日期', true);
  if (!pass) return setStatus('请输入口令', true);
  if (!title && !text && files.length === 0) return setStatus('至少填标题/文字/照片之一', true);

  const fd = new FormData();
  fd.append('date', date);
  fd.append('pass', pass);
  fd.append('author', author);
  if (location) fd.append('location', location);
  if (title) fd.append('title', title);
  if (text) fd.append('text', text);
  if (album) fd.append('album', album);

  for (let i = 0; i < files.length; i++) {
    setStatus(`压缩照片 ${i + 1}/${files.length}...`);
    try {
      const full = await compressImage(files[i], 1600, 0.85);
      const thumb = await compressImage(files[i], 480, 0.75);
      fd.append('photo_full', full, files[i].name);
      fd.append('photo_thumb', thumb, files[i].name);
    } catch (e) {
      return setStatus(e.message, true);
    }
  }

  setStatus('上传中...');
  const res = await fetch('/api/upload', { method: 'POST', body: fd });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return setStatus(data.error || `上传失败(HTTP ${res.status})`, true);

  location.href = `/?date=${date}`;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  doUpload();
});
$('#f-photos').addEventListener('change', renderPreview);

/* 默认日期 = 今天 */
$('#f-date').value = new Date().toISOString().slice(0, 10);
loadAlbums();
