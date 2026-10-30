/* 咕咕嘎嘎 - 导出面板(行程总览 + 地图 + 生成分享快照 / 导出 HTML)
 *
 * 2026-10-30:导出流程合并进管理页。
 * 原来:管理页「导出」tab 点「生成分享页」→ 跳到 export.html 选内容 → 生成快照 → 再回管理页,
 *       一次导出跨两个页面来回跳,改个条件就得重走一遍。
 * 现在:行程总览和地图直接渲染在管理页「导出」tab 下方,改专辑/日期、改勾选、重新生成都在同一页。
 *       export.html 已改成跳转 stub,导出逻辑只有这一份(别再抄第二份,抄一份就漏兜底)。
 *
 * 对外接口:
 *   window.ExportPanel.load({ album, from, to, token })
 *       载入/刷新面板。token 非空 = 更新已有快照(预填该快照已包含的内容,链接不变)。
 *   window.ExportPanel.resize()
 *       切回「导出」tab 时重算地图尺寸(Leaflet 在隐藏容器里量不到宽高)。
 *   window.ggExportHooks.onShared(url, isUpdate)
 *       快照生成成功后回调宿主页(管理页)弹二维码;宿主页没接就提示错误。
 */
'use strict';

(function () {
  const $ = (s) => document.querySelector(s);
  const el = (id) => document.getElementById(id);
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

  /* 当前面板状态(导出条件 + 勾选结果) */
  let exFrom = '';
  let exTo = '';
  let exAlbum = '';
  let exToken = '';
  let exAllEntries = [];
  let exAllTodos = [];
  let exSel = new Map();      // 条目 key(date|ts) → 是否导出
  let exTodoSel = new Map();  // 待办 key(date|sort|id) → 是否导出

  /* 条目/待办唯一 key,与后端 inc/inc_todo 一致 */
  const entryKey = (e) => `${e.date}|${e.ts}`;
  const todoKey = (t) => `${t.date}|${t.sort_order}|${t.id}`;

  /* 本地 esc:upload.js 的同名全局函数不转义引号,这里自己来一份(属性里也要塞值) */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  function fmtDateCN(d) {
    const [y, m, day] = String(d).split('-');
    return `${y} 年 ${Number(m)} 月 ${Number(day)} 日`;
  }

  function setTitle(text) { const t = el('ex-title'); if (t) t.textContent = text; }
  function setSub(text) { const s = el('ex-subtitle'); if (s) s.textContent = text; }
  function setErr(text, isErr) {
    const e = el('share-err');
    if (!e) return;
    e.className = isErr ? 'form-status error' : 'form-status';
    e.textContent = text || '';
  }
  function showHost(on) { const h = el('export-panel'); if (h) h.hidden = !on; }
  function showMap(on) { const w = el('ex-map-wrap'); if (w) w.hidden = !on; }
  function setNote(text) { const n = el('ex-map-note'); if (n) n.textContent = text || ''; }

  /* ---------- 载入 ---------- */
  async function load(opts) {
    opts = opts || {};
    exAlbum = String(opts.album || '').trim();
    exFrom = opts.from || '';
    exTo = opts.to || '';
    exToken = String(opts.token || '').trim();

    showHost(true);
    setErr('');
    setTitle(exToken ? '更新快照 · 重新选择导出内容' : '行程总览');

    // 更新模式:以快照里存的条件为准(列表里点「更新」时可能没带条件过来)
    let incFromSnap = null;
    let incTodoFromSnap = null;
    if (exToken) {
      const sr = await fetch(`/api/share?token=${encodeURIComponent(exToken)}`).catch(() => null);
      if (!sr || !sr.ok) {
        setTitle('快照不存在或已删除');
        const box = el('ex-overview');
        if (box) box.innerHTML = '<p class="empty">无法读取该快照,请回到「快照」列表重新生成。</p>';
        showMap(false);
        return;
      }
      const snap = await sr.json();
      if (snap.album) exAlbum = snap.album;
      if (snap.from) exFrom = snap.from;
      if (snap.to) exTo = snap.to;
      incFromSnap = new Set((snap.entries || []).map(entryKey));
      incTodoFromSnap = new Set((snap.todos || []).map(todoKey));
    }

    const fromOk = DATE_RE.test(exFrom);
    const toOk = DATE_RE.test(exTo);
    const rangeOk = fromOk && toOk && exFrom <= exTo;
    if (!exAlbum && !rangeOk) {
      setTitle('参数不对');
      const box = el('ex-overview');
      if (box) box.innerHTML = '<p class="empty">请选择专辑,或选择起止日期</p>';
      showMap(false);
      return;
    }
    if ((exFrom || exTo) && !rangeOk) {
      setTitle('日期区间不对');
      const box = el('ex-overview');
      if (box) box.innerHTML = '<p class="empty">起始/结束日期需成对且起始不晚于结束</p>';
      showMap(false);
      return;
    }

    // 副标题:专辑名 / 区间 / 叠加
    const rangeText = rangeOk ? `${fmtDateCN(exFrom)} ~ ${fmtDateCN(exTo)}` : '';
    setSub([exAlbum && `专辑 · ${exAlbum}`, rangeText, exToken && '正在更新快照'].filter(Boolean).join('  '));
    const btn = el('btn-share');
    if (btn) btn.textContent = exToken ? '保存更新' : '生成分享快照';

    const [entriesData, todosData] = await Promise.all([
      // 按专辑分享时直接让服务端在 SQL 里过滤:全量接口有条数上限,
      // 老专辑(如「长沙2026」)会被截掉 → 分享页空白(2026-09-17 与管理页专辑视图同源问题)
      fetch(exAlbum ? `/api/entries?album=${encodeURIComponent(exAlbum)}` : '/api/entries').then((r) => r.json()),
      fetch('/api/todos').then((r) => r.json()).catch(() => ({ todos: [] })),
    ]);
    let list = entriesData.entries || [];
    if (exAlbum) list = list.filter((e) => e.album === exAlbum); // 服务端已过滤,这层只是保险
    if (rangeOk) list = list.filter((e) => e.date >= exFrom && e.date <= exTo);
    exAllEntries = list;
    // 待办仅日期区间时参与;纯专辑模式待办不参与(待办无专辑概念)
    exAllTodos = rangeOk ? (todosData.todos || []).filter((t) => t.date >= exFrom && t.date <= exTo) : [];

    // 勾选初始:更新模式按快照已包含内容;新建默认全勾
    exSel = new Map(exAllEntries.map((e) => [entryKey(e), incFromSnap ? incFromSnap.has(entryKey(e)) : true]));
    exTodoSel = new Map(exAllTodos.map((t) => [todoKey(t), incTodoFromSnap ? incTodoFromSnap.has(todoKey(t)) : true]));

    await renderExport();
  }

  /* 当前勾选集合:逗号分隔 key,空串 = 一个都不导出 */
  function collectSelection() {
    const inc = exAllEntries.filter((e) => exSel.get(entryKey(e))).map(entryKey).join(',');
    const incTodo = exAllTodos.filter((t) => exTodoSel.get(todoKey(t))).map(todoKey).join(',');
    return { inc, incTodo };
  }

  /* ---------- 渲染总览 + 地图 ---------- */
  async function renderExport() {
    const box = el('ex-overview');
    const mapBox = el('ex-map');
    if (!box) return;
    const sortedEntries = exAllEntries.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.ts || 0) - (b.ts || 0)));
    const sortedTodos = exAllTodos.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.sort_order || 0) - (b.sort_order || 0) || (a.id || 0) - (b.id || 0)));

    if (!sortedEntries.length && !sortedTodos.length) {
      setTitle('这段时间还没有内容');
      box.innerHTML = '<p class="empty">所选区间内没有内容,换个日期或专辑试试</p>';
      showMap(false);
      setNote('');
      return;
    }
    setTitle(exToken ? '更新快照 · 重新选择导出内容' : '行程总览');

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
    box.querySelectorAll('.ex-chk').forEach((c) => {
      c.addEventListener('change', () => {
        exSel.set(c.dataset.key, c.checked);
        renderExport();
      });
    });
    box.querySelectorAll('.ex-todo-chk').forEach((c) => {
      c.addEventListener('change', () => {
        exTodoSel.set(c.dataset.key, c.checked);
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

    // 照片点击:统一走 map-common 的 lightbox(点任意处/Esc 关)
    box.querySelectorAll('.photo-grid img').forEach((img) => {
      img.addEventListener('click', () => {
        const src = img.dataset.full || img.src;
        if (window.MapCommon && MapCommon.openLightbox) MapCommon.openLightbox(src);
        else window.open(src, '_blank');
      });
    });

    // 地图:打卡点点击 → 紧凑详情面板(文字+部分图片,复用 map-common)
    if (!mapBox) return;
    const located = exportEntries.filter((e) => e.location && e.location.lat != null && e.location.lng != null);
    if (!located.length) {
      showMap(false);
      setNote('这段行程没有带定位的条目,地图暂不显示');
      return;
    }
    showMap(true);
    setNote(`地图上共 ${located.length} 个打卡点,红线为行程路线`);
    await MapCommon.renderCheckinMap(mapBox, exportEntries, {
      containerId: 'ex-map',
      scrollWheelZoom: false,
    });
  }

  /* ---------- 生成分享快照 ---------- */
  async function createSnapshot() {
    setErr('');
    const btn = el('btn-share');
    const { inc, incTodo } = collectSelection();
    const fd = new FormData();
    if (exAlbum) fd.append('album', exAlbum);
    if (exFrom) fd.append('from', exFrom);
    if (exTo) fd.append('to', exTo);
    fd.append('inc', inc);
    fd.append('inc_todo', incTodo);
    const url = exToken ? `/api/share?token=${encodeURIComponent(exToken)}` : '/api/share';
    if (btn) btn.disabled = true; // 防连点重复生成
    try {
      const res = await fetch(url, { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || `生成失败(HTTP ${res.status})`, true);
        return;
      }
      if (window.ggExportHooks && window.ggExportHooks.onShared) {
        window.ggExportHooks.onShared(data.url || '', !!exToken);
      } else {
        setErr('分享弹窗未就绪,请刷新页面重试', true);
      }
    } catch {
      setErr('网络错误,请重试', true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  /* ---------- 导出 HTML(隐藏表单提交,浏览器直接下载) ---------- */
  function exportHtml() {
    setErr('');
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
    setTimeout(() => form.remove(), 1000);
  }

  /* ---------- 绑定(页面加载即挂,幂等) ---------- */
  let bound = false;
  function bind() {
    if (bound) return;
    bound = true;
    const b1 = el('btn-share');
    if (b1) b1.addEventListener('click', createSnapshot);
    const b2 = el('btn-export-html');
    if (b2) b2.addEventListener('click', exportHtml);
  }
  // 脚本在 </body> 前加载时 DOM 已就绪;放 head 里则等 DOMContentLoaded
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();

  /* 切回「导出」tab 时重算地图尺寸(隐藏容器里 Leaflet 量不到宽高) */
  function resize() {
    const mapBox = el('ex-map');
    if (mapBox && mapBox._ggMap) {
      try { mapBox._ggMap.invalidateSize(); } catch (e) { /* 忽略 */ }
    }
  }

  window.ExportPanel = { load, resize, bind };
})();
