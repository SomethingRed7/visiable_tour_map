/* 咕咕嘎嘎 - 行程分享快照只读页(公开,免登录;由 /s/<token> 注入快照 JSON)
 * 地图/条目预览/照片兜底 全部复用 map-common.js(主页专辑地图、导出页地图共用同款)。
 * 旧分享页 HTML 无 #preview-modal 时,openEntryCard 自动回退到新窗口打开照片。 */
'use strict';

var $ = (s) => document.querySelector(s);

function fmt(d) {
  const [y, m, day] = d.split('-');
  return `${y} 年 ${Number(m)} 月 ${Number(day)} 日`;
}

function todoKey(t) { return `${t.date}|${t.sort_order}|${t.id}`; }

/* 旧分享页无 lightbox 时的照片点击回退(由 map-common 的 openEntryCard 兜底;此处仅在无 preview-modal 时由 share-view 自身管) */
function openPhotoFallback(img) {
  window.open(img.dataset.full || img.src, '_blank');
}

async function render() {
  const snap = JSON.parse(document.getElementById('snapshot-data').textContent);
  const list = snap.entries || [];
  const todos = snap.todos || [];
  const rangeText = (snap.from && snap.to) ? `${fmt(snap.from)} ~ ${fmt(snap.to)}` : '';
  $('#sv-subtitle').textContent = [snap.album && `专辑 · ${snap.album}`, rangeText].filter(Boolean).join('  ');
  $('#sv-meta').textContent = snap.updated_at ? `快照更新于 ${fmtDateTime(snap.updated_at)}` : '';

  const box = $('#sv-overview');
  const days = new Map();
  for (const e of list) {
    if (!days.has(e.date)) days.set(e.date, { entries: [], todos: [] });
    days.get(e.date).entries.push(e);
  }
  for (const t of todos) {
    if (!days.has(t.date)) days.set(t.date, { entries: [], todos: [] });
    days.get(t.date).todos.push(t);
  }
  if (!days.size) {
    box.innerHTML = '<p class="empty">这个分享里还没有内容</p>';
    $('#sv-map').style.display = 'none';
    return;
  }
  box.innerHTML = [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, { entries, todos: dayTodos }]) => {
      const todoHtml = dayTodos.length
        ? `<div class="ex-todos"><div class="ex-todos-title">待办</div>${dayTodos
            .map((t) => `<div class="ex-todo${t.done ? ' done' : ''}"><span class="todo-check">${t.done ? '✅' : '○'}</span>${MapCommon.esc(t.text)}</div>`)
            .join('')}</div>`
        : '';
      const entryHtml = entries
        .map((e) => `<article class="entry">
    <div class="entry-meta">
      <span class="stream-date">${MapCommon.esc(e.date)}</span>
      ${e.ts ? `<span class="time-tag">${MapCommon.fmtTime(e.ts)}</span>` : ''}
      ${e.author ? `<span class="author-tag${e.author === '小红' ? ' rose' : ''}">${MapCommon.esc(e.author)}</span>` : ''}
      ${e.visibility === 'private' ? '<span class="vis-tag">私有</span>' : ''}
      ${e.album ? `<span class="album-tag">${MapCommon.esc(e.album)}</span>` : ''}
      ${e.location && e.location.name ? `<span class="loc-tag">📍 ${MapCommon.esc(MapCommon.shortLoc(e.location.name))}</span>` : ''}
    </div>
    ${e.title ? `<h3 class="entry-title">${MapCommon.esc(e.title)}</h3>` : ''}
    ${e.text ? `<div class="entry-text">${MapCommon.esc(e.text).replace(/\n/g, '<br>')}</div>` : ''}
    ${(e.photos || []).length ? `<div class="photo-grid">${e.photos.map((p) => `<img src="${MapCommon.thumbUrl(p)}" data-full="${p}" alt="照片" loading="lazy">`).join('')}</div>` : ''}
  </article>`)
        .join('');
      return `<div class="ex-day">${todoHtml}${entryHtml}</div>`;
    })
    .join('');

  // 照片兜底(列表里的缩略图)
  MapCommon.bindPhotoGridFallback(box);
  // 照片点击:有 lightbox/preview-modal 走弹层(与主页当日动态一致),否则新窗口
  const hasModal = !!document.getElementById('preview-modal');
  if (!hasModal) {
    box.querySelectorAll('.photo-grid img').forEach((img) => {
      img.addEventListener('click', () => openPhotoFallback(img));
    });
  }
  // 地图:打卡点点击 → 详情弹层(文字+图片,复用 map-common)
  await MapCommon.renderCheckinMap($('#sv-map'), list, {
    containerId: 'sv-map',
    onMarkerClick: (e) => MapCommon.openEntryCard(e),
  });
}

function fmtDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* 大图预览:点缩略图 → 全屏大图;点遮罩 / Esc 关闭(与主页当日动态同款,不跳转新窗口)
 * 旧分享页 HTML 无 #lightbox → 回退新窗口打开 */
function setupLightbox() {
  const lb = document.getElementById('lightbox');
  document.addEventListener('click', (e) => {
    const img = e.target.closest('.photo-grid img');
    if (!img) return;
    if (!lb) { window.open(img.dataset.full || img.src, '_blank'); return; }
    lb.querySelector('img').src = img.dataset.full || img.src;
    lb.classList.add('open');
  });
  if (lb) {
    lb.addEventListener('click', () => lb.classList.remove('open'));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') lb.classList.remove('open');
    });
  }
}

setupLightbox();
MapCommon.bindPreviewModal();

render().catch((err) => {
  console.error(err);
  $('#sv-overview').innerHTML = `<p class="empty">加载失败:${MapCommon.esc(err.message)}</p>`;
});
