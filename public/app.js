/* 咕咕嘎嘎 - 旅行日记 portal */
'use strict';

var $ = (s) => document.querySelector(s);

let allEntries = [];
let currentMonth = null;   // 'YYYY-MM'
let selectedDate = null;
let activeAlbum = null;
let currentUser = null;    // 登录用户;null=未登录(待办完全不可见)
let allTodos = [];         // 私有待办(仅登录后拉取)
// 暂不显示「最近动态」流:默认只保留专辑入口;true = 恢复(含「全部」chip)
const SHOW_RECENT_FEED = false;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function thumbUrl(p) {
  return p.replace(/\.(jpg|jpeg|png)$/i, '-thumb.$1');
}

function photoGridHtml(photos, altPrefix) {
  if (!photos || photos.length === 0) return '';
  const imgs = photos
    .map((p, i) => `<img src="${thumbUrl(p)}" data-full="${p}" alt="${altPrefix} ${i + 1}" loading="lazy">`)
    .join('');
  return `<div class="photo-grid">${imgs}</div>`;
}

// 照片兜底:缩略图 404 → 回退全图;全图也挂 → 隐藏。
// 必须 addEventListener 绑定(CSP script-src 无 unsafe-inline,内联 onerror 会被浏览器拒绝执行)
function bindPhotoGridFallback(container) {
  container.querySelectorAll('.photo-grid img').forEach((img) => {
    const fb = () => {
      if (img.src !== img.dataset.full) img.src = img.dataset.full;
      else img.style.display = 'none';
    };
    img.addEventListener('error', fb);
    if (img.complete && img.naturalWidth === 0) fb(); // 已 404 过(innerHTML 重建后)
    // 横图(宽>高)加 landscape 类 → CSS grid-column 1/-1 单列占满整行(竖图保持双列)
    const mark = () => { if (img.naturalWidth > img.naturalHeight) img.classList.add('landscape'); };
    if (img.complete) mark();
    else img.addEventListener('load', mark);
  });
}

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

function entryCard(e, opts) {
  // 打卡记录不区分用户:标题以「打卡:」开头的条目不显示作者
  const isCkin = (e.title || '').startsWith('打卡:');
  const authorTag = !isCkin && e.author
    ? `<span class="author-tag${e.author === '小红' ? ' rose' : ''}">${esc(e.author)}</span>`
    : '';
  const locTag = e.location && e.location.name
    ? `<span class="loc-tag">📍 ${esc(shortLoc(e.location.name))}</span>`
    : '';
  const timeTag = e.ts ? `<span class="time-tag">${fmtTime(e.ts)}</span>` : '';
  const visTag = e.visibility === 'private' ? '<span class="vis-tag">私有</span>' : '';
  const editBtn = opts && opts.editBtn
    ? `<button type="button" class="entry-edit" data-date="${esc(e.date)}" data-ts="${esc(e.ts)}" title="编辑">✎ 编辑</button>`
    : '';
  return `<article class="entry">
    <div class="entry-meta">${timeTag}${authorTag}${visTag}${e.album ? `<span class="album-tag">${esc(e.album)}</span>` : ''}${locTag}${editBtn}</div>
    ${e.title ? `<h3 class="entry-title">${esc(e.title)}</h3>` : ''}
    ${e.text ? `<div class="entry-text">${esc(e.text).replace(/\n/g, '<br>')}</div>` : ''}
    ${photoGridHtml(e.photos, e.date)}
  </article>`;
}

/* ---------- 日历 ---------- */
function initCalendar() {
  const now = new Date();
  currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  $('#cal-prev').addEventListener('click', () => shiftMonth(-1));
  $('#cal-next').addEventListener('click', () => shiftMonth(1));
  renderCalendar();
}

function shiftMonth(delta) {
  const [y, m] = currentMonth.split('-').map(Number);
  const d0 = new Date(y, m - 1 + delta, 1);
  currentMonth = `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}`;
  renderCalendar();
}

function renderCalendar() {
  const [y, m] = currentMonth.split('-').map(Number);
  $('#cal-title').textContent = `${y} 年 ${m} 月`;
  const startWd = new Date(y, m - 1, 1).getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const entrySet = new Set(allEntries.filter((e) => e.date.startsWith(currentMonth)).map((e) => e.date));
  // 待办橙圈:仅登录用户可见(隐私:未登录日历与以前完全一致)
  // 状态:当天待办全部完成 → 实心(done);有待办未勾完 → 空心
  let todoSet = new Set();
  let todoDoneSet = new Set();
  if (currentUser) {
    const monthTodos = allTodos.filter((t) => t.date.startsWith(currentMonth));
    todoSet = new Set(monthTodos.map((t) => t.date));
    const byDate = {};
    monthTodos.forEach((t) => { (byDate[t.date] = byDate[t.date] || []).push(t.done); });
    Object.keys(byDate).forEach((ds) => {
      if (byDate[ds].every((v) => v === 1)) todoDoneSet.add(ds);
    });
  }

  const grid = $('#cal-grid');
  grid.innerHTML = '';
  for (let i = 0; i < startWd; i++) {
    const b = document.createElement('div');
    b.className = 'cal-blank';
    grid.appendChild(b);
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const ds = `${currentMonth}-${String(d).padStart(2, '0')}`;
    const cell = document.createElement('div');
    cell.className = 'cal-day'
      + (entrySet.has(ds) ? ' has-entry' : '')
      + (todoSet.has(ds) ? ' has-todo' : '')
      + (ds === selectedDate ? ' selected' : '');
    cell.innerHTML = `<span class="cal-num">${d}</span><span class="cal-dots">${entrySet.has(ds) ? '<span class="cal-dot"></span>' : ''}${todoSet.has(ds) ? `<span class="cal-todo-dot${todoDoneSet.has(ds) ? ' done' : ''}"></span>` : ''}</span>`;
    cell.addEventListener('click', () => selectDate(ds));
    grid.appendChild(cell);
  }
}

function selectDate(ds) {
  selectedDate = ds;
  activeAlbum = null;
  renderAlbums();
  renderCalendar();
  renderStream(); // 专辑面板同步回占位态(否则残留上一次的专辑列表/地图)
  renderDayEntries(ds);
  renderDayTodos(ds);
}

// 当天动态渲染(selectDate 与打卡后刷新共用)
/* 已登录:动态/流条目按钮(改公开/预览/编辑/删除,与管理界面一致) */
function bindStreamEditBtns(container) {
  if (!currentUser) return;
  container.querySelectorAll('.btn-vis').forEach((b) => {
    b.addEventListener('click', async () => {
      const fd = new FormData();
      fd.append('date', b.dataset.date);
      fd.append('ts', b.dataset.ts);
      fd.append('visibility', b.dataset.vis === 'private' ? 'public' : 'private');
      try {
        const res = await (await fetch('/api/update', { method: 'POST', body: fd })).json();
        if (res.ok) renderStream();
        else alert(res.error || '切换失败');
      } catch { alert('网络异常,请重试'); }
    });
  });
  container.querySelectorAll('.btn-prev').forEach((b) => {
    b.addEventListener('click', () => openStreamPreview(b.dataset.date, b.dataset.ts));
  });
  container.querySelectorAll('.btn-edit').forEach((b) => {
    b.addEventListener('click', () => {
      const date = b.dataset.date;
      const ts = Number(b.dataset.ts);
      const e = allEntries.find((x) => String(x.ts) === String(ts) && x.date === date);
      if (!e) return alert('条目不存在');
      if ((e.title || '').startsWith('打卡:')) {
        // 打卡条目:找到对应 todo 打开编辑打卡弹窗
        const todo = allTodos.find((t) => t.date === date && `打卡:${t.text}` === e.title && String(t.checkin_ts) === String(ts));
        if (todo) openCheckinModal(todo, date, e);
        else alert('找不到对应的待办,可到管理页编辑');
      } else {
        // 日记条目:跳转写日记页编辑态
        location.href = `/edit?date=${date}&ts=${ts}`;
      }
    });
  });
  container.querySelectorAll('.btn-del').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm(`确定删除 ${b.dataset.date} 的这条日记吗?\n照片会一起删除,无法恢复!`)) return;
      const fd = new FormData();
      fd.append('date', b.dataset.date);
      fd.append('ts', b.dataset.ts);
      try {
        const res = await fetch('/api/delete', { method: 'POST', body: fd });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (res.status === 401) { location.href = '/'; return; }
          return alert(data.error || `删除失败(HTTP ${res.status})`);
        }
        // 本地同步移除
        allEntries = allEntries.filter((x) => !(x.date === b.dataset.date && String(x.ts) === String(b.dataset.ts)));
        renderStream();
        if (selectedDate) renderDayEntries(selectedDate);
        renderCalendar();
        alert('已删除 ✅');
      } catch { alert('网络异常,请重试'); }
    });
  });
}

/* 预览弹层(与管理界面同款) */
async function openStreamPreview(date, ts) {
  const data = await (await fetch(`/api/entries?date=${date}`)).json();
  const e = (data.entries || []).find((x) => String(x.ts) === String(ts));
  if (!e) return alert('条目不存在');
  $('#preview-body').innerHTML = `<div class="preview-date">${esc(e.date)}</div>` + entryCard(e);
  $('#preview-modal').hidden = false;
  bindPhotoGridFallback($('#preview-body'));
  $('#preview-body').querySelectorAll('.photo-grid img').forEach((img) => {
    img.addEventListener('click', () => window.open(img.dataset.full || img.src, '_blank'));
  });
}
$('#btn-preview-close').addEventListener('click', () => { $('#preview-modal').hidden = true; });
$('#preview-modal').addEventListener('click', (e) => { if (e.target.id === 'preview-modal') $('#preview-modal').hidden = true; });

function renderDayEntries(ds) {
  const dayEntries = allEntries
    .filter((e) => e.date === ds)
    .sort((a, b) => ((a.created_at || '') < (b.created_at || '') ? -1 : 1));
  const [y, m, d] = ds.split('-');
  $('#day-title').textContent = `${y} 年 ${Number(m)} 月 ${Number(d)} 日`;
  $('#day-entries').innerHTML = dayEntries.length
    ? dayEntries.map((e) => entryCard(e, currentUser ? { editBtn: true } : null)).join('')
    : '<p class="empty">当日无事发生</p>';
  bindPhotoGridFallback($('#day-entries'));
  bindStreamEditBtns($('#day-entries'));
}

/* ---------- 私有待办(规划打卡;仅登录用户可见) ---------- */
async function initPortalUser() {
  const box = $('#portal-user');
  if (!box) return;
  try {
    const res = await (await fetch('/api/auth')).json();
    currentUser = res.user || null;
  } catch { currentUser = null; }
  if (currentUser) {
    box.hidden = false;
    // 登录态:用户名 + 管理按钮(btn-write 样式,同原「写日记」入口)
    box.innerHTML = `<span class="user-name">${esc(currentUser)}</span><a class="btn-write" href="/write">管理</a>`;
    const albumTab = document.querySelector('#panel-tabs .tab-btn[data-tab="album"]');
    if (albumTab) albumTab.hidden = false; // 专辑 tab 仅登录可见
    try {
      const d = await (await fetch('/api/todos')).json();
      allTodos = d.todos || [];
    } catch { allTodos = []; }
    renderCalendar();
    if (selectedDate) { renderDayTodos(selectedDate); }
    if (selectedDate) renderDayEntries(selectedDate); // 登录后刷新动态(带编辑按钮)
    renderStream(); // 最近动态流同步刷新
  } else {
    box.hidden = false;
    // 未登录:仅一个醒目的「登录」按钮(btn-write 样式)
    box.innerHTML = '<a class="btn-write" href="/write">登录</a>';
    const albumTab = document.querySelector('#panel-tabs .tab-btn[data-tab="album"]');
    if (albumTab) albumTab.hidden = true; // 未登录无专辑
    if (activeTab === 'todos') switchTab('entries'); // 未登录默认动态
  }
}

/* ---------- 面板 Tab 切换(当日待办/当日动态/专辑查看) ---------- */
let activeTab = 'todos'; // 默认当日待办
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('#panel-tabs .tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });
  ['todos', 'entries', 'album'].forEach((t) => {
    const pane = $('#tab-' + t);
    if (pane) pane.hidden = t !== tab;
  });
  if (tab === 'album') {
    // 切到专辑:地图容器刚显示,需校正尺寸
    const box = $('#album-map');
    if (box && albumMap && box.style.display !== 'none') {
      setTimeout(() => albumMap.invalidateSize(), 150);
    }
    // 未选专辑时默认选第一个(专辑 tab 打开即有内容)
    if (activeAlbum === null) {
      const albums = [...new Set(allEntries.map((e) => e.album).filter(Boolean))];
      if (albums.length) { activeAlbum = albums[0]; }
    }
    renderAlbums();
    renderStream();
  }
  if (tab === 'todos' && selectedDate) renderDayTodos(selectedDate);
  if (tab === 'entries' && selectedDate) renderDayEntries(selectedDate);
}

function initTabs() {
  $('#panel-tabs').addEventListener('click', (e) => {
    const b = e.target.closest('.tab-btn');
    if (b && !b.hidden) switchTab(b.dataset.tab);
  });
}

function renderDayTodos(ds) {
  const box = $('#day-todos');
  if (!currentUser) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  const list = allTodos
    .filter((t) => t.date === ds)
    // 已完成默认排最后;未完成按拖拽顺序
    .sort((a, b) => (a.done - b.done) || ((a.sort_order ?? 0) - (b.sort_order ?? 0)) || a.id - b.id);
  const done = list.filter((t) => t.done).length;
  const itemsHtml = list.length
    ? list.map((t) => {
        const ck = t.done && t.checkin_ts
          ? allEntries.find((e) => String(e.ts) === String(t.checkin_ts))
          : null;
        const extra = ck
          ? `<div class="ckin-extra">${
              (ck.photos || []).slice(0, 9).map((p) => `<img src="${thumbUrl(p)}" data-full="${p}" alt="打卡照片" loading="lazy" draggable="false">`).join('')
            }${ck.location && ck.location.name ? `<span class="ckin-loc">📍 ${esc(shortLoc(ck.location.name))}</span>` : ''}</div>`
          : '';
        return `
      <div class="todo-item${t.done ? ' done' : ''}" data-id="${t.id}" draggable="true">
        <span class="todo-check">${t.done ? '✅' : '○'}</span>
        <span class="todo-text">${esc(t.text)}</span>
        ${extra}
        <button type="button" class="todo-edit" data-id="${t.id}" aria-label="编辑" title="编辑"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg></button>
        <button type="button" class="todo-del" data-id="${t.id}" aria-label="删除">✕</button>
      </div>`;
      }).join('')
    : '<p class="todo-empty">这天还没有待办,添加一条开始打卡</p>';
  box.innerHTML = `
    <div class="todo-head"><span>当日待办</span><span class="todo-progress">已勾 ${done}/${list.length}</span></div>
    <form class="todo-add"><input type="text" maxlength="200" placeholder="添加一条待办…" required><button type="submit" class="btn-small">添加</button></form>
    ${itemsHtml}`;
  // 打卡展开区缩略图:横图(宽>高)加 landscape 单列占满行,竖图双列(与 photo-grid 一致)
  box.querySelectorAll('.ckin-extra img').forEach((img) => {
    const mark = () => { if (img.naturalWidth > img.naturalHeight) img.classList.add('landscape'); };
    if (img.complete) mark();
    else img.addEventListener('load', mark);
  });
  box.querySelectorAll('.todo-item').forEach((el) => {
    el.addEventListener('click', (ev) => {
      if (el.classList.contains('editing')) return; // 编辑中:点击不触发勾选/打卡(输入框/保存按钮冒泡到此)
      if (ev.target.closest('.todo-del')) return; // 删除按钮不触发勾选
      if (ckinDragJustDone) { ckinDragJustDone = false; return; } // 拖拽刚结束,吞掉本次点击
      const t = allTodos.find((x) => x.id === Number(el.dataset.id));
      if (!t) return;
      // 点左边 ✓/○ → 勾选切换(保留旧交互:已打卡=取消打卡,未打卡=打卡)
      if (ev.target.closest('.todo-check')) {
        if (!t.done) {
          openCheckinModal(t, ds);
        } else if (t.checkin_ts) {
          if (confirm('取消打卡?已生成的打卡记录(照片)将一并删除。')) toggleTodo(t.id, ds);
        } else if (confirm('取消勾选?')) {
          toggleTodo(t.id, ds);
        }
        return;
      }
      // 点待办其他区域 → 已打卡=编辑,未打卡=打卡
      if (t.done) {
        if (t.checkin_ts) {
          let ck = allEntries.find((e) => String(e.ts) === String(t.checkin_ts));
          if (ck) {
            openCheckinModal(t, ds, ck);
          } else {
            // 本地没找到对应打卡条目 → 重新拉取(打卡记录可能在别人设备/刷新后产生)
            fetch('/api/entries').then((r) => r.json()).then((data) => {
              allEntries = data.entries || [];
              const fresh = allEntries.find((e) => String(e.ts) === String(t.checkin_ts));
              openCheckinModal(t, ds, fresh || null);
            }).catch(() => openCheckinModal(t, ds, null));
          }
        } else if (confirm('取消勾选?')) {
          toggleTodo(t.id, ds);
        }
      } else {
        openCheckinModal(t, ds);
      }
    });
  });
  box.querySelectorAll('.todo-del').forEach((b) => {
    b.addEventListener('click', () => deleteTodo(Number(b.dataset.id), ds));
  });
  box.querySelectorAll('.todo-edit').forEach((b) => {
    b.addEventListener('click', (ev) => {
      ev.stopPropagation(); // 不触发勾选/打卡弹窗
      enterEditTodo(b, Number(b.dataset.id), ds);
    });
  });
  const form = box.querySelector('.todo-add');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const input = form.querySelector('input');
    const text = input.value.trim();
    if (!text) return;
    const fd = new FormData();
    fd.append('date', ds);
    fd.append('text', text);
    try {
      const res = await (await fetch('/api/todos', { method: 'POST', body: fd })).json();
      if (res.ok && res.todo) {
        allTodos.push(res.todo);
        renderDayTodos(ds);
        renderCalendar(); // 日历圈同步(新增待办 → 空心圈)
      } else if (res.error) input.placeholder = res.error;
    } catch { /* 忽略 */ }
  });
  setupTodoDrag(box, ds);
}

async function deleteTodo(id, ds) {
  try {
    const res = await fetch(`/api/todos?id=${id}`, { method: 'DELETE' });
    if (res.ok) {
      allTodos = allTodos.filter((t) => t.id !== id);
      renderDayTodos(ds);
      renderCalendar(); // 日历圈同步(删除可能改变完成态/移除标记)
    }
  } catch { /* 忽略 */ }
}

// 内联编辑待办文本(Enter 保存 / Esc 取消 / 点保存按钮)
function enterEditTodo(btn, id, ds) {
  const item = btn.closest('.todo-item');
  if (!item) return;
  item.classList.add('editing'); // 编辑中:条目点击不触发勾选/打卡
  const textEl = item.querySelector('.todo-text');
  const input = document.createElement('input');
  input.className = 'todo-edit-input';
  input.maxLength = 200;
  input.value = textEl.textContent;
  input.addEventListener('click', (e) => e.stopPropagation()); // 点输入框不触发条目点击
  textEl.replaceWith(input);
  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn-small';
  save.textContent = '保存';
  save.addEventListener('click', async (ev) => {
    ev.stopPropagation(); // 点保存不触发条目点击
    const v = input.value.trim();
    if (!v) return;
    const fd = new FormData();
    fd.append('id', String(id));
    fd.append('text', v);
    try {
      const res = await (await fetch('/api/todos/update', { method: 'POST', body: fd })).json();
      if (res.ok && res.todo) {
        const t = allTodos.find((x) => x.id === id);
        const oldText = t ? t.text : '';
        if (t) t.text = res.todo.text;
        // 已打卡 → 本地同步打卡条目标题(服务端已改,这里保持界面一致)
        if (t && t.checkin_ts) {
          const ck = allEntries.find((e) => String(e.ts) === String(t.checkin_ts) && e.date === t.date);
          if (ck && ck.title === `打卡:${oldText}`) ck.title = `打卡:${res.todo.text}`;
        }
        renderDayTodos(ds);
        renderCalendar();
        if (ds === selectedDate) renderDayEntries(ds);
      } else if (res.error) {
        input.placeholder = res.error;
      }
    } catch { /* 忽略 */ }
  });
  btn.replaceWith(save);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') save.click();
    else if (e.key === 'Escape') renderDayTodos(ds);
  });
  input.addEventListener('blur', () => {
    setTimeout(() => { if (document.contains(input)) renderDayTodos(ds); }, 150);
  });
  input.focus();
  input.select();
}

async function toggleTodo(id, ds, extra = {}) {
  const fd = new FormData();
  fd.append('id', String(id));
  if (extra.note) fd.append('note', extra.note);
  if (extra.album) fd.append('album', extra.album);
  if (extra.vis) fd.append('visibility', extra.vis);
  if (extra.location) fd.append('location', extra.location);
  if (extra.lat != null) fd.append('lat', String(extra.lat));
  if (extra.lng != null) fd.append('lng', String(extra.lng));
  (extra.fulls || []).forEach((f) => fd.append('photo_full', f));
  (extra.thumbs || []).forEach((f) => fd.append('photo_thumb', f));
  try {
    const res = await (await fetch('/api/todos/toggle', { method: 'POST', body: fd })).json();
    if (!res.ok) return { error: res.error };
    const t = allTodos.find((x) => x.id === id);
    if (t) {
      const oldTs = t.checkin_ts;
      t.done = res.todo.done;
      t.checkin_ts = res.todo.checkin_ts;
      if (oldTs && !res.todo.checkin_ts) {
        // 取消打卡:服务端已删条目,本地同步移除(否则当天动态残留)
        allEntries = allEntries.filter((e) => String(e.ts) !== String(oldTs));
      }
    }
    if (res.entry) {
      // 打卡生成的私有条目并入本地数据 → 当天动态/展开区即时可见
      allEntries = allEntries.filter((e) => String(e.ts) !== String(res.entry.ts));
      allEntries.push(res.entry);
    }
    renderDayTodos(ds);
    if (ds === selectedDate) renderDayEntries(ds); // 打卡条目即时出现在当天动态
    renderCalendar(); // 日历圈同步:全部勾完 → 实心
    return { ok: true };
  } catch {
    return { error: '网络错误,请重试' };
  }
}

/* ---------- 打卡弹窗(勾选未完成待办时;照片/定位/备注可选填) ---------- */
let ckinTodo = null;
let ckinDs = null;
let ckinEdit = null; // 编辑态:已有打卡 entry
let ckinRemove = []; // 编辑态:要删除的已有照片路径
let ckinFulls = [];
let ckinThumbs = [];
let ckinLat = null;  // 自动定位得到的坐标(随保存提交,服务端直存不再 geocode)
let ckinLng = null;
let ckinDragJustDone = false; // 触屏拖拽结束后吞掉紧随的 click

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
      reject(new Error('图片无法解码(HEIC 请用 iPhone Safari 打开)'));
    };
    img.src = url;
  });
}

function openCheckinModal(t, ds, editEntry) {
  ckinTodo = t;
  ckinDs = ds;
  ckinEdit = editEntry || null; // 编辑态:已有打卡记录
  ckinFulls = [];
  ckinThumbs = [];
  ckinLat = null;
  ckinLng = null;
  ckinRemove = []; // 编辑态:要删除的已有照片路径
  $('#ckin-todo').textContent = `「${t.text}」`;
  loadCkinAlbums(); // 专辑下拉(已有专辑+新建)
  if (editEntry) {
    // ---- 编辑态:预填已有内容 ----
    $('#ckin-title').textContent = '编辑打卡';
    const ti = $('#ckin-title-input');
    ti.hidden = false;
    ti.value = t.text; // 编辑待办标题;保存后打卡标题同步更新
    $('#ckin-vis').value = editEntry.visibility === 'private' ? 'private' : 'public';
    $('#ckin-note').value = editEntry.text || '';
    $('#ckin-loc').value = (editEntry.location && editEntry.location.name) || '';
    ckinLat = editEntry.location && editEntry.location.lat != null ? editEntry.location.lat : null;
    ckinLng = editEntry.location && editEntry.location.lng != null ? editEntry.location.lng : null;
    $('#ckin-save').textContent = '保存修改';
    $('#ckin-del-record').hidden = false;
    // 专辑预选:等 loadCkinAlbums 完成后设置(不用 setTimeout,手机网络慢时 400ms 不够)
    const sel = $('#ckin-album');
    loadCkinAlbums().then(() => {
      if (editEntry.album && [...sel.options].some((o) => o.value === editEntry.album)) sel.value = editEntry.album;
    });
    // 已有照片预览(可单独删除);photos 可能是字符串(防御 API 序列化差异)
    let existing = editEntry.photos;
    if (typeof existing === 'string') { try { existing = JSON.parse(existing); } catch { existing = []; } }
    if (!Array.isArray(existing)) existing = [];
    const box = $('#ckin-existing');
    if (existing.length) {
      box.hidden = false;
      box.innerHTML = existing.map((p, i) =>
        `<div class="ckin-old"><img src="${thumbUrl(p)}" data-full="${p}" alt="已有照片" loading="lazy"><button type="button" class="ckin-old-x" data-i="${i}" aria-label="删除照片">✕</button></div>`).join('');
      [...box.querySelectorAll('.ckin-old-x')].forEach((b) => b.addEventListener('click', () => {
        const i = Number(b.dataset.i);
        ckinRemove.push(existing[i]);
        b.closest('.ckin-old').remove();
        if (!box.querySelector('.ckin-old')) box.hidden = true;
      }));
    } else box.hidden = true;
  } else {
    // ---- 新建态 ----
    $('#ckin-title').textContent = '打卡';
    const ti = $('#ckin-title-input');
    ti.hidden = true;
    ti.value = '';
    $('#ckin-vis').value = 'public'; // 打卡默认公开,可改私有
    $('#ckin-note').value = '';
    $('#ckin-loc').value = '';
    $('#ckin-save').textContent = '保存打卡';
    $('#ckin-del-record').hidden = true;
    $('#ckin-existing').hidden = true;
    $('#ckin-existing').innerHTML = '';
  }
  $('#ckin-status').textContent = '';
  $('#ckin-photos').innerHTML =
    '<label class="ckin-add" for="ckin-files">+ 照片(可选,≤9 张)</label><input type="file" id="ckin-files" accept="image/*" multiple hidden>';
  $('#ckin-photos').querySelector('#ckin-files').addEventListener('change', handleCkinFiles);
  $('#ckin-modal').hidden = false;
  $('#ckin-note').focus();
}

/* 打卡弹窗专辑下拉:已有专辑 + 新建(选中 __new__ 弹输入,复用 index.html 内 select) */
async function loadCkinAlbums() {
  const sel = $('#ckin-album');
  if (!sel) return;
  const current = sel.value || '';
  try {
    const data = await (await fetch('/api/entries')).json();
    const albums = [...new Set((data.entries || []).map((e) => e.album).filter(Boolean))];
    sel.innerHTML = '<option value="">不设专辑</option>'
      + albums.map((a) => `<option value="${esc(a)}">${esc(a)}</option>`).join('')
      + '<option value="__new__">➕ 新建专辑…</option>';
    // 恢复上次选中(若还在选项里)
    if ([...sel.options].some((o) => o.value === current)) sel.value = current;
  } catch { /* 保持默认 */ }
}
$('#ckin-album').addEventListener('change', () => {
  const sel = $('#ckin-album');
  if (sel.value !== '__new__') return;
  const name = prompt('新专辑名字:');
  if (name && name.trim()) {
    const n = name.trim();
    const existing = [...sel.options].find((o) => o.value === n);
    if (existing) sel.value = n;
    else {
      sel.insertAdjacentHTML('beforeend', `<option value="${esc(n)}">${esc(n)}</option>`);
      sel.value = n;
    }
  } else sel.value = '';
});

function closeCheckinModal() {
  $('#ckin-modal').hidden = true;
  ckinTodo = null;
  ckinDs = null;
}

/* 键盘弹出时打卡框自动上移(visualViewport 高度变化),内容不被键盘遮挡可总览 */
function bindCheckinKeyboard() {
  const vv = window.visualViewport;
  if (!vv) return;
  const modal = $('#ckin-modal');
  const box = $('.ckin-box');
  const apply = () => {
    if (modal.hidden) return;
    const visible = vv.height;
    const layoutH = window.innerHeight;
    const kb = layoutH - visible; // 键盘占用高度
    if (kb > 80) {
      // 键盘弹出:弹窗贴顶,高度=可视区-上下边距,内容可滚动查看
      modal.style.alignItems = 'flex-start';
      modal.style.paddingTop = '12px';
      box.style.maxHeight = (visible - 24) + 'px';
    } else {
      modal.style.alignItems = '';
      modal.style.paddingTop = '';
      box.style.maxHeight = '';
    }
  };
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
}
bindCheckinKeyboard();

async function handleCkinFiles(ev) {
  const files = [...ev.target.files].slice(0, 9 - ckinFulls.length);
  const st = $('#ckin-status');
  for (const f of files) {
    try {
      const [full, thumb] = await Promise.all([
        compressImage(f, 1600, 0.85),
        compressImage(f, 480, 0.75),
      ]);
      ckinFulls.push(new File([full], `p${ckinFulls.length}.jpg`, { type: 'image/jpeg' }));
      ckinThumbs.push(new File([thumb], `p${ckinThumbs.length}.jpg`, { type: 'image/jpeg' }));
      const img = document.createElement('img');
      img.src = URL.createObjectURL(thumb);
      img.title = f.name;
      $('#ckin-photos').appendChild(img);
    } catch (e) {
      st.textContent = e.message;
    }
  }
  const add = $('#ckin-photos').querySelector('.ckin-add');
  if (ckinFulls.length >= 9 && add) add.remove();
}

async function submitCheckin() {
  const t = ckinTodo;
  const ds = ckinDs;
  if (!t) return;
  const btn = $('#ckin-save');
  if (btn.disabled) return; // 防重复提交(双击/网络慢时连续点击)
  btn.disabled = true;
  const note = $('#ckin-note').value.trim();
  const location = $('#ckin-loc').value.trim();
  const album = $('#ckin-album').value.trim();
  const vis = $('#ckin-vis').value === 'private' ? 'private' : 'public';
  const st = $('#ckin-status');
  st.textContent = '提交中…';
  try {
    if (ckinEdit) {
      // ---- 编辑态:更新已有打卡记录(不走 toggle,保留 done/checkin_ts)----
      // 标题框 = 待办标题:改待办 + 服务端联动更新打卡标题(打卡标题不单独改)
      const newTodoText = $('#ckin-title-input').value.trim();
      if (newTodoText && newTodoText !== t.text) {
        const tfd = new FormData();
        tfd.append('id', String(t.id));
        tfd.append('text', newTodoText);
        const tres = await fetch('/api/todos/update', { method: 'POST', body: tfd });
        const tdata = await tres.json().catch(() => ({}));
        if (tres.ok && tdata.todo) {
          t.text = tdata.todo.text;
          // 本地同步打卡条目标题(服务端已联动更新)
          const ck = allEntries.find((e) => String(e.ts) === String(ckinEdit.ts));
          if (ck) ck.title = `打卡:${newTodoText}`;
        }
      }
      const fd = new FormData();
      fd.append('date', ckinEdit.date);
      fd.append('ts', String(ckinEdit.ts));
      fd.append('title', `打卡:${t.text}`);
      fd.append('text', note);
      fd.append('album', album);
      fd.append('visibility', vis);
      fd.append('location', location);
      if (ckinLat != null) fd.append('lat', String(ckinLat));
      if (ckinLng != null) fd.append('lng', String(ckinLng));
      if (ckinRemove.length) fd.append('photos_to_remove', JSON.stringify(ckinRemove));
      (ckinFulls || []).forEach((f) => fd.append('photo_full', f));
      (ckinThumbs || []).forEach((f) => fd.append('photo_thumb', f));
      const res = await fetch('/api/update', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        if (res.status === 401) { location.href = '/'; return; }
        st.textContent = data.error || `保存失败(HTTP ${res.status})`;
        return;
      }
      // 本地同步更新
      const idx = allEntries.findIndex((e) => String(e.ts) === String(ckinEdit.ts));
      if (idx >= 0) {
        allEntries[idx] = { ...allEntries[idx], title: `打卡:${t.text}`, text: note, album: album || null, visibility: vis, location: data.entry ? data.entry.location : allEntries[idx].location, photos: data.entry ? data.entry.photos : allEntries[idx].photos };
      }
      closeCheckinModal();
      renderDayTodos(ds);
      if (ds === selectedDate) renderDayEntries(ds);
      renderCalendar();
      return;
    }
    // ---- 新建态:生成打卡记录(无内容=仅勾选完成)----
    const hasContent = Boolean(note || location || ckinFulls.length || album || vis === 'private');
    const r = await toggleTodo(t.id, ds, hasContent ? { note, location, album, vis, lat: ckinLat, lng: ckinLng, fulls: ckinFulls, thumbs: ckinThumbs } : {});
    if (r.ok) closeCheckinModal();
    else st.textContent = r.error || '打卡失败';
  } finally {
    btn.disabled = false;
  }
}

// 编辑态「删除打卡」:删除该打卡记录 + 取消待办勾选(与点击已勾选待办取消一致)
$('#ckin-del-record').addEventListener('click', async () => {
  const t = ckinTodo;
  if (!t) return;
  if (!confirm('删除这条打卡记录?照片会一起删除,无法恢复。')) return;
  const st = $('#ckin-status');
  st.textContent = '删除中…';
  const btn = $('#ckin-del-record');
  btn.disabled = true;
  try {
    const r = await toggleTodo(t.id, ckinDs); // 取消勾选 → 服务端删关联条目(照片)+清 checkin_ts
    if (r.ok) closeCheckinModal();
    else st.textContent = r.error || '删除失败';
  } finally {
    btn.disabled = false;
  }
});

// 自动定位:高德 + 浏览器并行竞争,谁先成功用谁(浏览器源在手机/微信内置经常失败,
// 高德 Geolocation 失败还有 IP 定位兜底)→ 定位成功率大幅提升
let ckinAmapKey = '';
let ckinAmapSec = '';
let ckinAmapReadyP = null;
async function ckinFetchConfig() {
  try {
    const res = await (await fetch('/api/config')).json();
    ckinAmapKey = res.amap_key || '';
    ckinAmapSec = res.amap_security_js_code || '';
  } catch { ckinAmapKey = ''; ckinAmapSec = ''; }
}
function ckinLoadAmap() {
  return new Promise((resolve) => {
    if (window.AMap && window.AMap.Geolocation) return resolve(true);
    const s = document.createElement('script');
    s.src = `https://webapi.amap.com/maps?v=2.0&key=${ckinAmapKey}`;
    s.onload = () => {
      if (window.AMap && window.AMap.plugin) window.AMap.plugin(['AMap.Geolocation'], () => resolve(true));
      else resolve(false);
    };
    s.onerror = () => resolve(false);
    if (ckinAmapSec) window._AMapSecurityConfig = { securityJsCode: ckinAmapSec };
    document.head.appendChild(s);
  });
}
function ckinEnsureAmap() {
  if (window.AMap && window.AMap.Geolocation) return Promise.resolve(true);
  if (!ckinAmapKey) return Promise.resolve(false);
  if (!ckinAmapReadyP) {
    ckinAmapReadyP = ckinLoadAmap().catch(() => { ckinAmapReadyP = null; return false; });
  }
  return ckinAmapReadyP;
}
async function ckinGetPosition() {
  await ckinFetchConfig();
  const amapReady = await Promise.race([ckinEnsureAmap(), new Promise((r) => setTimeout(() => r(false), 6000))]);
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
          // 浏览器定位 = WGS-84,转 GCJ-02(否则图钉偏)
          (pos) => resolve(wgs2gcj(pos.coords.latitude, pos.coords.longitude)),
          () => resolve(null),
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
        );
      })
    : Promise.resolve(null);
  // 并行竞争:谁先成功用谁(高德 SDK 卡住不阻塞浏览器源)
  return firstCkinSuccess([amapP, browserP]);
}
async function firstCkinSuccess(promises) {
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
// 微信内置浏览器判定:微信 WebView 禁用 H5 geolocation(高德定位也依赖它)→ 定位必然失败
function isWechatBrowser() {
  return /MicroMessenger/i.test(navigator.userAgent);
}
// 定位失败原因探测:Chrome 拒绝过权限后 getCurrentPosition 直接失败不再弹框,
// 用 permissions.query 区分「被拒/待授权」给出精确指引
async function geolocDeniedReason() {
  try {
    if (navigator.permissions && navigator.permissions.query) {
      const st = await navigator.permissions.query({ name: 'geolocation' });
      if (st.state === 'denied') return 'denied';
      if (st.state === 'prompt') return 'prompt';
    }
  } catch { /* 老浏览器无 permissions API */ }
  return 'unknown';
}
// 关键时序:Chrome 要求 getCurrentPosition 在用户手势激活期内调用,
// 一旦 await(网络/高德)激活窗口过期,直接拒绝不弹权限框。
// 所以浏览器定位必须在点击回调里【同步】启动,高德并行不阻塞。
function locateCheckin() {
  const st = $('#ckin-status');
  const input = $('#ckin-loc');
  st.textContent = '定位中…';
  let settled = false;
  const done = (lat, lng) => {
    if (settled) return;
    settled = true;
    ckinLat = lat;
    ckinLng = lng;
    (async () => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const r = await (await fetch(`/api/reverse?lat=${lat}&lng=${lng}`, { signal: ctrl.signal })).json();
        clearTimeout(timer);
        if (r && r.name) input.value = r.name.slice(0, 80);
        else input.value = `${lat.toFixed(5)},${lng.toFixed(5)}`;
      } catch {
        input.value = `${lat.toFixed(5)},${lng.toFixed(5)}`;
      }
      st.textContent = '';
    })();
  };
  const fail = (err) => {
    if (settled) return;
    settled = true;
    if (isWechatBrowser()) {
      st.textContent = '微信内无法定位,请点右上角 ⋯ 选「在浏览器打开」后重试';
      return;
    }
    geolocDeniedReason().then((denied) => {
      if (denied === 'denied') {
        st.textContent = '定位被拒绝:点地址栏左侧图标 → 网站设置 → 允许位置,再试';
        return;
      }
      // 高德+浏览器都失败 → 打开地图选点器兜底
      st.textContent = '定位失败:' + (err ? { 1: '(权限被拒)', 2: '(定位服务不可用)', 3: '(定位超时)' }[err.code] || '' : '') + ',打开地图选点';
      setTimeout(() => openCkinMap(), 600);
    });
    ckinLat = null;
    ckinLng = null;
  };

  // 微信内置浏览器直接提示(微信禁 H5 定位,getCurrentPosition 挂起不回调,不等超时)
  if (/MicroMessenger/i.test(navigator.userAgent)) {
    st.textContent = '微信内无法定位:点右上角 ⋯ 选「在浏览器打开」后重试';
    return;
  }
  // ① 浏览器原生定位(网络定位):同步启动,手势激活期内 Chrome 才会弹权限框
  if (!navigator.geolocation) {
    fail();
  } else {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const g = wgs2gcj(pos.coords.latitude, pos.coords.longitude);
        done(g.lat, g.lng);
      },
      (err) => {
        // ② 浏览器失败 → 高德定位(基站/WiFi)
        st.textContent = '浏览器定位失败,改用高德定位…';
        LocPicker.lpAmapLocate().then((g) => {
          if (g) {
            done(g.lat, g.lng);
            return;
          }
          // ③ 高德也失败 → IP 定位(城市级兜底,必成功)
          st.textContent = '高德定位失败,改用 IP 定位…';
          LocPicker.lpIpLocate().then((ip) => {
            if (ip) {
              // 城市级坐标:回填位置名(城市),选点器从城市中心开始
              done(ip.lat, ip.lng);
            } else {
              fail(err);
            }
          });
        });
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 }
    );
  }
}

/* ---------- 待办拖拽排序(桌面 HTML5 DnD + 触屏长按) ---------- */
function setupTodoDrag(box, ds) {
  let dragId = null;

  // 按指针 Y 计算插入位置:返回 before_id(插到该 id 前面);null=末尾
  function computeBeforeId(clientY) {
    const items = [...box.querySelectorAll('.todo-item')].filter((el) => Number(el.dataset.id) !== dragId);
    for (const s of items) {
      const r = s.getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return Number(s.dataset.id);
    }
    return null;
  }
  function setOver(beforeId) {
    box.querySelectorAll('.todo-item.drag-over').forEach((x) => x.classList.remove('drag-over'));
    if (beforeId != null) {
      const t = box.querySelector(`.todo-item[data-id="${beforeId}"]`);
      if (t) t.classList.add('drag-over');
    }
  }

  // 桌面:容器级 DnD —— 空隙/末尾都能放,按 Y 上下半决定插前/插后
  box.addEventListener('dragstart', (e) => {
    const el = e.target.closest('.todo-item');
    if (!el || el.classList.contains('editing')) return; // 编辑中不拖拽(避免拖输入框文字)
    dragId = Number(el.dataset.id);
    el.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(dragId));
  });
  box.addEventListener('dragover', (e) => {
    if (dragId == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setOver(computeBeforeId(e.clientY));
  });
  box.addEventListener('drop', (e) => {
    e.preventDefault();
    if (dragId == null) return;
    const id = dragId;
    const beforeId = computeBeforeId(e.clientY);
    setOver(null);
    dragId = null;
    commitTodoMove(ds, id, beforeId);
  });
  box.addEventListener('dragleave', (e) => {
    if (!box.contains(e.relatedTarget)) setOver(null);
  });
  box.addEventListener('dragend', () => {
    box.querySelectorAll('.todo-item').forEach((x) => x.classList.remove('dragging', 'drag-over'));
    dragId = null;
  });

  // 触屏:长按 400ms 进入拖动,松手提交(拖动期间禁止滚动)
  let longPress = null;
  box.querySelectorAll('.todo-item').forEach((el) => {
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return; // 桌面走 HTML5 DnD
      if (el.classList.contains('editing')) return; // 编辑中不拖拽
      if (e.target.closest('.todo-del') || e.target.closest('.todo-edit')) return;
      clearTimeout(longPress);
      longPress = setTimeout(() => {
        dragId = Number(el.dataset.id);
        el.classList.add('dragging');
        ckinDragJustDone = true; // 拖动结束后吞掉 click
      }, 400);
      const onMove = (ev) => {
        if (dragId == null) return;
        setOver(computeBeforeId(ev.clientY));
      };
      const onUp = (ev) => {
        clearTimeout(longPress);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        if (dragId == null) return;
        const id = dragId;
        const beforeId = computeBeforeId(ev.clientY);
        setOver(null);
        dragId = null;
        el.classList.remove('dragging');
        commitTodoMove(ds, id, beforeId);
        setTimeout(() => { ckinDragJustDone = false; }, 350); // 兜底清残留,防吞掉之后正常点击
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    });
  });
}

async function commitTodoMove(ds, id, beforeId) {
  const fd = new FormData();
  fd.append('id', String(id));
  if (beforeId) fd.append('before_id', String(beforeId));
  try {
    const res = await (await fetch('/api/todos/move', { method: 'POST', body: fd })).json();
    if (res.ok && res.order) {
      const orderMap = new Map(res.order.map((x, i) => [x, i]));
      allTodos = allTodos.map((t) => (orderMap.has(t.id) ? { ...t, sort_order: orderMap.get(t.id) } : t));
    }
  } catch { /* 忽略 */ }
  renderDayTodos(ds);
}

/* ---------- 打卡:地图选点(共享 loc-picker.js,与写日记页同一组件) ---------- */
function openCkinMap() {
  LocPicker.open({
    lat: ckinLat != null ? ckinLat : undefined,
    lng: ckinLng != null ? ckinLng : undefined,
    onPick: (name, lat, lng) => {
      $('#ckin-loc').value = String(name || '').slice(0, 80);
      ckinLat = lat;
      ckinLng = lng;
    },
  });
}

/* ---------- 专辑地图(Leaflet + 高德瓦片,懒加载) ---------- */
let albumMap = null;

/* 条目时间戳:优先 ts 字段,退化为从照片路径提取 */
function entryTs(e) {
  if (e.ts) return String(e.ts);
  if (e.photos && e.photos[0]) {
    const m = e.photos[0].match(/([0-9]{13})-[0-9]+\.jpg$/);
    if (m) return m[1];
  }
  return '0';
}

async function renderAlbumMap(list) {
  const box = $('#album-map');
  const withLoc = list.filter((e) => e.location && e.location.lat != null && e.location.lng != null);
  if (!withLoc.length) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';
  try {
    await loadLeaflet();
  } catch {
    box.style.display = 'none';
    return;
  }
  if (albumMap) albumMap.remove();
  const map = L.map('album-map', { scrollWheelZoom: true, zoomControl: true });
  albumMap = map;
  // 容器从 display:none 切到显示后立即初始化会尺寸错位 → 延时校正(瓦片偏移/突出根因)
  setTimeout(() => map.invalidateSize(), 120);
  setTimeout(() => map.invalidateSize(), 400);
  L.tileLayer('https://webrd0{s}.is.autonavi.com/appmaptile?lang=zh_cn&size=1&scale=1&style=8&x={x}&y={y}&z={z}', {
    maxZoom: 18,
    subdomains: ['1', '2', '3', '4'],
    attribution: '&copy; 高德地图',
  }).addTo(map);
  const bounds = [];
  for (const e of withLoc) {
    const mk = L.marker([e.location.lat, e.location.lng], { icon: L.divIcon({ className: 'gg-marker', html: ggPinSvg(), iconSize: [28, 28], iconAnchor: [14, 27] }) }).addTo(map);
    mk.bindPopup(`<b>${esc(e.date)} ${fmtTime(e.ts)}</b> ${esc(e.title || '')}<br>${esc(e.location.display || e.location.name || '')}`);
    bounds.push([e.location.lat, e.location.lng]);
  }
  if (bounds.length === 1) {
    map.setView(bounds[0], 12);
  } else if (bounds.length > 1) {
    // 沿路规划(CF 边缘 OSRM 代理,失败回退直线),按日期+时间排序连线
    // ⚠️ 之前只按 date 排序,同一天多条打卡顺序不稳定(V8 sort 不稳定)→ 连线乱/漏
    const ordered = withLoc.slice().sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      return (entryTs(a) || 0) - (entryTs(b) || 0);
    });
    // 存储坐标=GCJ-02(高德系),OSRM 要 WGS-84,请求前转换
    const wgsPts = ordered.map((e) => gcj2wgs(e.location.lat, e.location.lng));
    let line = ordered.map((e) => [e.location.lat, e.location.lng]);
    try {
      const ptsStr = wgsPts.map((p) => `${p.lat},${p.lng}`).join('|');
      const route = await (await fetch(`/api/route?pts=${encodeURIComponent(ptsStr)}`)).json();
      if (route.coordinates && route.coordinates.length > 1) {
        // 响应几何是 WGS-84,转回 GCJ-02 才与瓦片/图钉对齐
        line = route.coordinates.map(([lat, lng]) => {
          const g = wgs2gcj(lat, lng);
          return [g.lat, g.lng];
        });
      }
    } catch { /* 直线 */ }
    // 轨迹线:品牌红醒目(原 #d97706 琥珀色太淡)
    L.polyline(line, { color: '#e11d48', weight: 4, opacity: 0.9 }).addTo(map);
    map.fitBounds(line, { padding: [30, 30] });
  }
}

/* ---------- 专辑 / 动态流 ---------- */
function renderAlbums() {
  const albums = [...new Set(allEntries.map((e) => e.album).filter(Boolean))];
  const chips = $('#album-chips');
  chips.innerHTML = '';
  const mk = (label, album, active) => {
    const b = document.createElement('button');
    b.className = 'chip' + (active ? ' active' : '');
    b.textContent = label;
    // 反选:再点已选中的专辑 → 收起详情(置空回占位态)
    b.addEventListener('click', () => setAlbum(activeAlbum === album ? null : album));
    chips.appendChild(b);
  };
  if (SHOW_RECENT_FEED) mk('全部', null, activeAlbum === null);
  for (const a of albums) mk(a, a, activeAlbum === a);
}

function setAlbum(album) {
  activeAlbum = album;
  renderAlbums();
  renderStream();
}

async function renderStream() {
  let list = allEntries;
  if (activeAlbum) list = list.filter((e) => e.album === activeAlbum);
  if (!activeAlbum && !SHOW_RECENT_FEED) {
    // 专辑入口:默认不渲染动态流
    $('#stream-title').textContent = '专辑';
    $('#stream').innerHTML = `<p class="empty">${allEntries.length ? '选择一个专辑查看' : '还没有日记 ✏️'}</p>`;
    $('#album-map').style.display = 'none';
    return;
  }
  list = [...list].sort((a, b) => {
    if (activeAlbum) return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; // 专辑正序
    if (a.date !== b.date) return a.date > b.date ? -1 : 1;                 // 动态倒序
    return (a.created_at || '') > (b.created_at || '') ? -1 : 1;
  });
  $('#stream-title').textContent = activeAlbum ? `专辑 · ${activeAlbum}` : '最近动态';
  // 条目按日期分组:每日小标题 + 当日条目(样式与管理界面一致)
  const grouped = [];
  const byDate = {};
  for (const e of list.slice(0, 60)) {
    (byDate[e.date] = byDate[e.date] || []).push(e);
  }
  for (const date of Object.keys(byDate).sort().reverse()) grouped.push({ date, items: byDate[date] });
  $('#stream').innerHTML = grouped.length
    ? grouped.map((g) => `
      <div class="stream-date-head">${esc(g.date)}</div>
      ${g.items.map((e) => {
        const isCkin = (e.title || '').startsWith('打卡:');
        const visTag = e.visibility === 'private' ? '<span class="vis-tag">私有</span>' : '';
        const visBtn = currentUser
          ? `<button type="button" class="btn-small btn-vis" data-date="${esc(e.date)}" data-ts="${esc(e.ts)}" data-vis="${e.visibility === 'private' ? 'private' : 'public'}">${e.visibility === 'private' ? '改公开' : '改私有'}</button>`
          : '';
        const prevBtn = currentUser
          ? `<button type="button" class="btn-small btn-prev" data-date="${esc(e.date)}" data-ts="${esc(e.ts)}">预览</button>`
          : '';
        const editBtn = currentUser
          ? `<button type="button" class="btn-small btn-edit" data-date="${esc(e.date)}" data-ts="${esc(e.ts)}">编辑</button>`
          : '';
        const delBtn = currentUser
          ? `<button type="button" class="btn-small btn-del" data-date="${esc(e.date)}" data-ts="${esc(e.ts)}">删除</button>`
          : '';
        return `<div class="recent-item">
          <span class="recent-info">${esc(e.date)} <span class="time-tag">${fmtTime(e.ts)}</span> ${visTag} <b>${esc(e.title || '')}</b>${isCkin ? '' : ` · ${esc(e.author || '')}`}</span>
          <span class="recent-actions">${visBtn}${prevBtn}${editBtn}${delBtn}</span>
        </div>`;
      }).join('')}
    `).join('')
    : '<p class="empty">还没有日记 ✏️</p>';
  bindStreamEditBtns($('#stream'));
  // 地图仅在选中专辑时显示
  if (activeAlbum) await renderAlbumMap(list);
  else $('#album-map').style.display = 'none';
}

/* ---------- 大图 ---------- */
function setupLightbox() {
  const lb = document.getElementById('lightbox');
  document.addEventListener('click', (e) => {
    const img = e.target.closest('.photo-grid img');
    if (!img || !lb) return;
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

async function loadEntries() {
  const data = await (await fetch('/api/entries')).json();
  allEntries = data.entries || [];
}

/* ---------- 启动 ---------- */
async function init() {
  await loadEntries();
  setupLightbox();
  // 打卡弹窗按钮(静态元素,只绑一次)
  $('#ckin-save').addEventListener('click', () => submitCheckin());
  $('#ckin-locate').addEventListener('click', locateCheckin);
  $('#ckin-map').addEventListener('click', openCkinMap);
  // 点击阴影区关闭(e.target 是遮罩本身,弹窗内部点击不触发)
  $('#ckin-modal').addEventListener('click', (e) => {
    if (e.target === $('#ckin-modal')) closeCheckinModal();
  });
  initCalendar();
  initTabs();
  renderAlbums();
  renderStream();
  initPortalUser(); // 探测登录态 + 拉私有待办(待办橙点/待办区仅登录可见)

  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const urlDate = new URLSearchParams(location.search).get('date');

  if (urlDate && /^\d{4}-\d{2}-\d{2}$/.test(urlDate)) {
    // 上传成功跳转 ?date=YYYY-MM-DD → 定位到该月并选中当天
    currentMonth = urlDate.slice(0, 7);
    renderCalendar();
    selectDate(urlDate);
  } else if (allEntries.some((e) => e.date === today)) {
    selectDate(today);
  }
}

init().catch((err) => {
  console.error(err);
  $('#stream').innerHTML = `<p class="empty">加载失败:${esc(err.message)}</p>`;
});
