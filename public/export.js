/* 咕咕嘎嘎 - 行程导出分享页(?from=YYYY-MM-DD&to=YYYY-MM-DD&token=xxx 可更新快照)
 * 通用函数(esc/shortLoc/thumbUrl/fmtTime/ggPinSvg/loadLeaflet/photoGridHtml/entryCard/
 *  bindPhotoGridFallback/openEntryCard/renderCheckinMap)走 map-common.js,本文件不再重复 */
'use strict';

var $ = (s) => document.querySelector(s);

function fmt(d) {
  const [y, m, day] = d.split('-');
  return `${y} 年 ${Number(m)} 月 ${Number(day)} 日`;
}

/* 条目/待办唯一 key,与后端 inc/inc_todo 一致 */
function entryKey(e) { return `${e.date}|${e.ts}`; }
function todoKey(t) { return `${t.date}|${t.sort_order}|${t.id}`; }

/* 坐标系统:存储=GCJ-02(高德瓦片系),OSRM 要 WGS-84,互转(给定位选址用) */
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

/* 导出的数据与勾选状态(登录后加载) */
let exFrom = '';
let exTo = '';
let exAlbum = ''; // 专辑导出模式(可单独或与日期叠加)
let exToken = ''; // 更新模式:?token=xxx
let exAllEntries = [];
let exAllTodos = [];
let exSel = new Map(); // 条目 key(date|ts) → 是否导出(默认 true)
let exTodoSel = new Map(); // 待办 key(date|sort|id) → 是否导出

async function init() {
  const params = new URLSearchParams(location.search);
  exFrom = params.get('from') || '';
  exTo = params.get('to') || '';
  exAlbum = params.get('album') || '';
  exToken = params.get('token') || '';
  const valid = /^\d{4}-\d{2}-\d{2}$/;
  const box = $('#ex-overview');
  const mapBox = $('#ex-map');

  // 登录门:导出含私有内容,未登录引导去登录(不渲染任何内容)
  const auth = await (await fetch('/api/auth')).json();
  if (!auth.user) {
    $('#ex-login').hidden = false;
    $('#ex-controls').hidden = true;
    box.innerHTML = '';
    mapBox.style.display = 'none';
    return;
  }
  $('#ex-login').hidden = true;
  $('#ex-controls').hidden = false;
  $('#btn-share').hidden = false; // 生成分享快照按钮仅登录可见
  $('#btn-export-html').hidden = false; // 导出 HTML 同样仅登录可见

  // 更新模式:读快照条件与已导出内容,预填勾选
  let incFromSnap = null;
  let incTodoFromSnap = null;
  if (exToken) {
    const sr = await fetch(`/api/share?token=${encodeURIComponent(exToken)}`).catch(() => null);
    if (!sr || !sr.ok) {
      $('#ex-title').textContent = '快照不存在或已删除';
      box.innerHTML = '<p class="empty">无法读取该快照,请回到管理页重新生成。</p>';
      mapBox.style.display = 'none';
      return;
    }
    const snap = await sr.json();
    if (snap.album) exAlbum = snap.album;
    if (snap.from) exFrom = snap.from;
    if (snap.to) exTo = snap.to;
    incFromSnap = new Set((snap.entries || []).map(entryKey));
    incTodoFromSnap = new Set((snap.todos || []).map(todoKey));
  }

  // 模式:①专辑 ②起止日期 ③叠加;至少一个有效
  const fromOk = valid.test(exFrom);
  const toOk = valid.test(exTo);
  const rangeOk = fromOk && toOk && exFrom <= exTo;
  if (!exAlbum && !rangeOk) {
    $('#ex-title').textContent = '参数不对';
    box.innerHTML = '<p class="empty">请在写日记页「导出行程」选择专辑或日期区间,或检查链接 ?album=&from=&to=</p>';
    mapBox.style.display = 'none';
    return;
  }
  if ((exFrom || exTo) && !rangeOk) {
    $('#ex-title').textContent = '日期区间不对';
    box.innerHTML = '<p class="empty">起始/结束日期需成对且起始不晚于结束</p>';
    mapBox.style.display = 'none';
    return;
  }

  // 副标题:专辑名 / 区间 / 组合
  const rangeText = rangeOk ? `${fmt(exFrom)} ~ ${fmt(exTo)}` : '';
  $('#ex-subtitle').textContent = [exAlbum && `专辑 · ${exAlbum}`, rangeText, exToken && '正在更新快照'].filter(Boolean).join('  ');
  document.title = `${exToken ? '更新快照' : '行程总览'} ${[exAlbum, rangeText].filter(Boolean).join(' ')} · 咕咕嘎嘎`;
  $('#btn-share').textContent = exToken ? '保存更新' : '生成分享快照';

  const [entriesData, todosData] = await Promise.all([
    fetch('/api/entries').then((r) => r.json()),
    fetch('/api/todos').then((r) => r.json()).catch(() => ({ todos: [] })),
  ]);
  let list = entriesData.entries || [];
  if (exAlbum) list = list.filter((e) => e.album === exAlbum);
  if (rangeOk) list = list.filter((e) => e.date >= exFrom && e.date <= exTo);
  exAllEntries = list;
  // 待办仅日期区间时参与;纯专辑模式待办不参与(待办无专辑概念)
  exAllTodos = rangeOk ? (todosData.todos || []).filter((t) => t.date >= exFrom && t.date <= exTo) : [];

  // 勾选初始:更新模式按快照已包含内容;新建默认全勾
  exSel = new Map(exAllEntries.map((e) => [entryKey(e), incFromSnap ? incFromSnap.has(entryKey(e)) : true]));
  exTodoSel = new Map(exAllTodos.map((t) => [todoKey(t), incTodoFromSnap ? incTodoFromSnap.has(todoKey(t)) : true]));

  renderExport();
}

/* 当前勾选集合:逗号分隔 key,空串 = 一个都不导出 */
function collectSelection() {
  const inc = exAllEntries.filter((e) => exSel.get(entryKey(e))).map(entryKey).join(',');
  const incTodo = exAllTodos.filter((t) => exTodoSel.get(todoKey(t))).map(todoKey).join(',');
  return { inc, incTodo };
}

async function renderExport() {
  const box = $('#ex-overview');
  const mapBox = $('#ex-map');
  const sortedEntries = exAllEntries.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.ts || 0) - (b.ts || 0)));
  const sortedTodos = exAllTodos.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.sort_order || 0) - (b.sort_order || 0) || (a.id || 0) - (b.id || 0)));

  if (!sortedEntries.length && !sortedTodos.length) {
    $('#ex-title').textContent = '这段时间还没有内容';
    box.innerHTML = '<p class="empty">所选区间内没有内容,换个日期或专辑试试</p>';
    mapBox.style.display = 'none';
    return;
  }
  $('#ex-title').textContent = exToken ? '更新快照 · 重新选择导出内容' : '行程总览';

  // 地图与导出只含勾选条目
  const exportEntries = sortedEntries.filter((e) => exSel.get(entryKey(e)));
  const exportTodos = sortedTodos.filter((t) => exTodoSel.get(todoKey(t)));

  // 按日期分组展示全部候选(未勾选置灰)
  const days = new Map();
  for (const e of sortedEntries) {
    if (!days.has(e.date)) days.set(e.date, { entries: [], todos: [] });
    days.get(e.date).entries.push(e);
  }
  for (const t of sortedTodos) {
    if (!days.has(t.date)) days.set(t.date, { entries: [], todos: [] });
    days.get(t.date).todos.push(t);
  }

  box.innerHTML = [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, { entries, todos }]) => {
      const todoHtml = todos.length
        ? `<div class="ex-todos"><div class="ex-todos-title">待办</div>${todos
            .map((t) => {
              const key = todoKey(t);
              const on = exTodoSel.get(key);
              return `<div class="ex-todo${t.done ? ' done' : ''}${on ? '' : ' ex-off'}">
              <span class="todo-check">${t.done ? '✅' : '○'}</span>${esc(t.text)}
              <label class="ex-toggle"><input type="checkbox" class="ex-todo-chk" data-key="${esc(key)}" ${on ? 'checked' : ''}> 导出</label>
            </div>`;
            })
            .join('')}</div>`
        : '';
      const entryHtml = entries
        .map((e) => {
          const key = entryKey(e);
          const on = exSel.get(key);
          return `<article class="entry${on ? '' : ' ex-off'}">
    <div class="entry-meta">
      <label class="ex-toggle"><input type="checkbox" class="ex-chk" data-key="${esc(key)}" ${on ? 'checked' : ''}> 导出</label>
      <span class="stream-date">${esc(e.date)}</span>
      ${e.ts ? `<span class="time-tag">${fmtTime(e.ts)}</span>` : ''}
      ${e.author ? `<span class="author-tag${e.author === '小红' ? ' rose' : ''}">${esc(e.author)}</span>` : ''}
      ${e.visibility === 'private' ? '<span class="vis-tag">私有</span>' : ''}
      ${e.album ? `<span class="album-tag">${esc(e.album)}</span>` : ''}
      ${e.location && e.location.name ? `<span class="loc-tag">📍 ${esc(shortLoc(e.location.name))}</span>` : ''}
    </div>
    ${e.title ? `<h3 class="entry-title">${esc(e.title)}</h3>` : ''}
    ${e.text ? `<div class="entry-text">${esc(e.text).replace(/\n/g, '<br>')}</div>` : ''}
    ${(e.photos || []).length ? `<div class="photo-grid">${e.photos.map((p) => `<img src="${thumbUrl(p)}" data-full="${p}" alt="照片" loading="lazy">`).join('')}</div>` : ''}
  </article>`;
        })
        .join('');
      return `<div class="ex-day">${todoHtml}${entryHtml}</div>`;
    })
    .join('');

  // 勾选变化 → 更新状态并重渲染(地图同步)
  box.querySelectorAll('.ex-chk').forEach((el) => {
    el.addEventListener('change', () => {
      exSel.set(el.dataset.key, el.checked);
      renderExport();
    });
  });
  box.querySelectorAll('.ex-todo-chk').forEach((el) => {
    el.addEventListener('change', () => {
      exTodoSel.set(el.dataset.key, el.checked);
      renderExport();
    });
  });

  // 照片兜底:缩略图 404 → 回退全图;全图也挂 → 隐藏(CSP 禁内联 onerror,必须 addEventListener)
  box.querySelectorAll('.photo-grid img').forEach((img) => {
    const fb = () => {
      if (img.src !== img.dataset.full) img.src = img.dataset.full;
      else img.style.display = 'none';
    };
    img.addEventListener('error', fb);
    if (img.complete && img.naturalWidth === 0) fb();
    // 横图(宽>高)加 landscape 类 → 单列占满整行(竖图保持双列)
    // 自动排列:横图移到「第一个竖图之前」(竖图两两成对在后,避免一行只有一张竖图)
    const mark = () => {
      if (img.naturalWidth > img.naturalHeight) {
        img.classList.add('landscape');
        const grid = img.closest('.photo-grid');
        if (grid) {
          const firstPortrait = grid.querySelector('img:not(.landscape)');
          if (firstPortrait) firstPortrait.before(img);
          else grid.appendChild(img);
        }
      }
    };
    if (img.complete) mark();
    else img.addEventListener('load', mark);
  });

  // 照片点击:有 #lightbox 走 lightbox(由 map-common 的 openEntryCard 在弹层里处理),无则回退新窗口
  const hasLb = !!document.getElementById('lightbox');
  if (!hasLb) {
    box.querySelectorAll('.photo-grid img').forEach((img) => {
      img.addEventListener('click', () => window.open(img.dataset.full || img.src, '_blank'));
    });
  }

  // 地图:打卡点点击 → 详情弹层(文字+图片,复用 map-common)
  await MapCommon.renderCheckinMap(mapBox, exportEntries, {
    containerId: 'ex-map',
    onMarkerClick: (e) => MapCommon.openEntryCard(e),
    scrollWheelZoom: false,
  });
}

/* ---------- 生成分享快照(替代 PDF 导出) ---------- */
let shareQrLoaded = null;
let shareQrCanvas = null;
function loadQrLib() {
  if (!shareQrLoaded) {
    shareQrLoaded = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/qrious@4.0.2/dist/qrious.min.js';
      s.onload = resolve;
      s.onerror = () => reject(new Error('二维码库加载失败'));
      document.head.appendChild(s);
    });
  }
  return shareQrLoaded;
}

/* 保存二维码为 PNG 下载 */
function saveQrCanvas() {
  if (!shareQrCanvas) return;
  const a = document.createElement('a');
  a.href = shareQrCanvas.toDataURL('image/png');
  a.download = 'gugugaga-share-qr.png';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function showShareModal(data) {
  const url = window.SITE_ORIGIN + data.url;
  $('#share-url').value = url;
  $('#share-status').textContent = '';
  $('#share-modal-title').textContent = exToken ? '快照已更新' : '分享快照已生成';
  $('#share-modal-hint').textContent = exToken
    ? '链接和二维码不变;如需再调整内容,可再次点「更新」重新选择。'
    : '链接永久有效,内容固定;想调整内容可在下方「已分享的快照」点「更新」重新选择。';
  $('#share-modal').hidden = false;
  const qrBox = $('#share-qr');
  qrBox.innerHTML = '';
  loadQrLib().then(() => {
    const canvas = document.createElement('canvas');
    new QRious({ element: canvas, value: url, size: 180 });
    shareQrCanvas = canvas;
    qrBox.appendChild(canvas);
  }).catch(() => {
    shareQrCanvas = null;
    qrBox.innerHTML = '<p class="empty">二维码生成失败,直接复制链接分享</p>';
  });
}

/* 导出 HTML:同条件 POST /api/export-html,隐藏表单提交让浏览器直接下载(文件名由服务端 Content-Disposition 决定) */
$('#btn-export-html').addEventListener('click', () => {
  const errEl = $('#share-err');
  errEl.className = 'form-status';
  errEl.textContent = '';
  const rangeOk = /^\d{4}-\d{2}-\d{2}$/.test(exFrom) && /^\d{4}-\d{2}-\d{2}$/.test(exTo) && exFrom <= exTo;
  if (!exAlbum && !rangeOk) {
    errEl.className = 'form-status error';
    errEl.textContent = '请选择专辑,或选择起止日期(可都选叠加)';
    return;
  }
  const { inc, incTodo } = collectSelection();
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = '/api/export-html';
  form.style.display = 'none';
  const add = (n, v) => {
    const i = document.createElement('input');
    i.name = n;
    i.value = v;
    form.appendChild(i);
  };
  if (exAlbum) add('album', exAlbum);
  if (exFrom) add('from', exFrom);
  if (exTo) add('to', exTo);
  add('inc', inc);
  add('inc_todo', incTodo);
  document.body.appendChild(form);
  form.submit();
});

$('#btn-share').addEventListener('click', async () => {
  const errEl = $('#share-err');
  errEl.className = 'form-status';
  errEl.textContent = '';
  const rangeOk = /^\d{4}-\d{2}-\d{2}$/.test(exFrom) && /^\d{4}-\d{2}-\d{2}$/.test(exTo) && exFrom <= exTo;
  if (!exAlbum && !rangeOk) {
    errEl.className = 'form-status error';
    errEl.textContent = '请选择专辑,或选择起止日期(可都选叠加)';
    return;
  }
  const { inc, incTodo } = collectSelection();
  const fd = new FormData();
  if (exAlbum) fd.append('album', exAlbum);
  if (exFrom) fd.append('from', exFrom);
  if (exTo) fd.append('to', exTo);
  fd.append('inc', inc);
  fd.append('inc_todo', incTodo);
  const url = exToken ? `/api/share?token=${encodeURIComponent(exToken)}` : '/api/share';
  const btn = $('#btn-share');
  btn.disabled = true; // 防连点重复生成
  try {
    const res = await fetch(url, { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      errEl.className = 'form-status error';
      errEl.textContent = data.error || `生成失败(HTTP ${res.status})`;
      return;
    }
    showShareModal(data);
  } catch {
    errEl.className = 'form-status error';
    errEl.textContent = '网络错误,请重试';
  } finally {
    btn.disabled = false;
  }
});

$('#btn-share-copy').addEventListener('click', async () => {
  const input = $('#share-url');
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    input.select();
    document.execCommand('copy');
  }
  $('#share-status').textContent = '已复制 ✅';
});

$('#btn-share-open').addEventListener('click', () => {
  window.open($('#share-url').value, '_blank');
});

$('#btn-qr-save').addEventListener('click', () => {
  if (shareQrCanvas) {
    saveQrCanvas();
    $('#share-status').textContent = '二维码已保存 ✅';
  } else {
    $('#share-status').textContent = '二维码还没生成,请稍等';
  }
});

$('#btn-share-close').addEventListener('click', () => { $('#share-modal').hidden = true; });
$('#share-modal').addEventListener('click', (e) => { if (e.target.id === 'share-modal') $('#share-modal').hidden = true; });

init().catch((err) => {
  console.error(err);
  $('#ex-overview').innerHTML = `<p class="empty">加载失败:${MapCommon.esc(err.message)}</p>`;
});
MapCommon.bindPreviewModal();
