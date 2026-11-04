// 「当日在读」tab 内容:跟随日历所选日期(app.js 的 selectDate 派发 gg:date 事件)。
// 数据来自 /api/reading(每日播报脚本从微信读书推送);前端只读。
// - 当天有记录 → 完整卡(书名/时长/进度/7 天柱状图/最近划线)
// - 只有时长没有明细(历史日期,由 payload.days 反推)→ 精简卡
// - 完全没读 → 提示该去读书了
(function () {
  const body = document.getElementById('reading-body');
  if (!body) return;

  const payloads = new Map();   // date -> payload
  const minutes = new Map();    // date -> 分钟(含 payload.days 反推)
  let latest = null;            // 最新一条 payload(取书名/链接用)
  let reco = [];                // 换书推荐(微信读书/番茄书架各 1-2 本)
  let loaded = false;
  const manuals = new Map();   // date -> 手动添加的条目[]
  let curDate = '';            // 当前选中日期（弹窗保存时要用）
  const SYNC_OWNER = '小红';   // 微信读书同步的记录都算她的

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function mm(v) {
    const n = Math.round(Number(v) || 0);
    if (n <= 0) return '0 分';
    if (n < 60) return n + ' 分';
    return Math.floor(n / 60) + ' 时 ' + (n % 60) + ' 分';
  }

  function md(d) { return String(d || '').slice(5).replace('-', '.'); }
  function todayStr() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function barChart(days) {
    const list = (days || []).slice(-7);
    if (!list.length) return '';
    const max = Math.max.apply(null, list.map((d) => Number(d.m) || 0)) || 1;
    const cols = list.map((d) => {
      const m = Number(d.m) || 0;
      const h = Math.max(3, Math.round((m / max) * 100));
      return '<div class="rd-col">' +
        '<div class="rd-bar-wrap"><div class="rd-bar' + (m > 0 ? '' : ' rd-off') +
        '" style="height:' + h + '%" title="' + esc(md(d.d)) + ' · ' + mm(m) + '"></div></div>' +
        '<span class="rd-day">' + esc(md(d.d)) + '</span></div>';
    }).join('');
    return '<div class="rd-chart">' + cols + '</div>';
  }

  // 书架推荐:微信读书的可点直达,番茄没有公开书籍页,只作书名提示
  function recoBlock(title) {
    if (!reco.length) return '';
    const chips = reco.slice(0, 4).map((b) => {
      const src = b.source === 'fanqie' ? '番茄' : '微信读书';
      const inner = '<span class="rd-chip-src">' + esc(src) + '</span>' + esc(b.title);
      const tip = b.note ? ' title="' + esc(b.note) + '"' : '';
      return b.link
        ? '<a class="rd-chip" href="' + esc(b.link) + '"' + tip + '>' + inner + '</a>'
        : '<span class="rd-chip rd-chip-plain"' + tip + '>' + inner + '</span>';
    }).join('');
    return '<div class="rd-reco"><p class="rd-reco-title">' + esc(title || '也可以换一本') + '</p>' +
      '<div class="rd-reco-list">' + chips + '</div></div>';
  }

  function emptyState(date) {
    const isToday = date === todayStr();
    const book = (latest && latest.book) || {};
    const name = book.title ? '《' + book.title + '》' : '';
    // 往前找最近一次读书，把「上次」说得具体 —— 比空喊「该去读书了」有用
    let last = '';
    for (let i = 1; i <= 7; i++) {
      const d = new Date(date + 'T00:00:00');
      d.setDate(d.getDate() - i);
      const p = (n) => String(n).padStart(2, '0');
      const key = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      const m = minutes.get(key);
      if (m) { last = (i === 1 ? '昨天' : '前 ' + i + ' 天') + ' ' + mm(m); break; }
    }
    const sub = [name ? '上次读到' + name : '', last].filter(Boolean).join(' · ')
      || '翻开一本书，今天就有可记的';
    const link = book.link
      ? '<a class="day-empty-link" href="' + esc(book.link) + '">' + (name ? '继续读' : '去读书') + '</a>'
      : '';
    const isFuture = !isToday && date > todayStr();
    return '<div class="day-empty">' +
      '<p class="day-empty-main">' + (isFuture ? '还没到这天' : isToday ? '今天还没翻开书' : '这天没有读书记录') + '</p>' +
      '<p class="day-empty-sub">' + esc(sub) + '</p>' +
      link + recoBlock() + '</div>';
  }

  function compactState(date) {
    const m = minutes.get(date) || 0;
    return '<div class="rd-top"><div class="rd-book"><b>' + mm(m) + '</b>' +
      '<span class="rd-author">这天读了这么久</span></div></div>' +
      '<p class="rd-facts">当天明细没有单独记录(明细只在推送当天保存)</p>' +
      '<div class="rm-by">' + tag(SYNC_OWNER) + '</div>';
  }

  function fullCard(it, ov, date) {
    const book = it.book || {};
    // ov = 用户对这张同步卡的手工校正（书名/作者/时长），没改就是 null
    const title = ov && ov.title ? ov.title : (book.title || '在读');
    const author = ov ? (ov.author || '') : (book.author || '');
    const mins = ov && ov.minutes ? ov.minutes : it.minutes;
    const pct = Math.max(0, Math.min(100, Number(it.progress) || 0));
    const facts = [];
    if (it.highlights_today) facts.push('当日划线 ' + it.highlights_today + ' 条');
    if (it.highlights) facts.push('累计划线 ' + it.highlights + ' 条');
    if (it.chapter) facts.push('读到「' + it.chapter + '」');
    const quotes = (it.quotes || []).slice(0, 2).map((q) =>
      '<p class="rd-quote">' + esc(q.t) + '</p>').join('');
    return '<div class="rd-top">' +
        '<div class="rd-book"><b>' + esc(title) + '</b>' +
          '<span class="rd-author">' + esc(author) + '</span></div>' +
        '<div class="rd-min">' + mm(mins) + '<small>这天</small></div>' +
      '</div>' +
      '<div class="rd-progress"><div class="rd-progress-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="rd-progress-label"><span>全书 ' + pct + '% · 第 ' + (it.chapter_idx || '') + '／' +
        (it.chapters || '') + ' 章</span><span>当周 ' + mm(it.week_minutes) + '</span></div>' +
      '' +
      (facts.length ? '<p class="rd-facts">' + esc(facts.join(' · ')) + '</p>' : '') +
      quotes +
      '<div class="rm-by">' + tag(SYNC_OWNER) +
        '<button type="button" class="rm-act" data-rm-edit="wx-' + date + '">修改</button>' +
      '</div>';
    // 有记录就不推「接下来读」了（那是空状态用来引导翻书的）
  }

  // ---------- 手动添加的阅读记录（微信读书之外的书 / 纸质书） ----------

  // 排版刻意复用 rd-* 那套（书名/作者/右侧时长），视觉和微信读书那张卡一致
  // 和「当日动态」里条目上的用户名徽标同一套样式
  function tag(name) {
    return '<span class="author-tag' + (name === '小红' ? ' rose' : '') + '">' + esc(name) + '</span>';
  }

  function manualCard(x) {
    const photos = (x.photos || []).slice(0, 4)
      .map((p) => '<img src="' + esc(p) + '" alt="" loading="lazy">').join('');
    const mins = Number(x.minutes) || 0;
    return '<div class="rm-card">' +
      '<div class="rd-top">' +
        '<div class="rd-book">' +
          '<b>' + esc(x.title) + '</b>' +
          (x.author ? '<span class="rd-author">' + esc(x.author) + '</span>' : '') +
        '</div>' +
        (mins ? '<div class="rd-min">' + mins + '分<small>这天</small></div>' : '') +
      '</div>' +
      (x.author_name
        ? '<div class="rm-by">' + tag(x.author_name) + '</div>'
        : '') +
      (x.summary ? '<p class="rm-summary">' + esc(x.summary) + '</p>' : '') +
      (photos ? '<div class="rm-photos">' + photos + '</div>' : '') +
      '<div class="rm-acts">' +
        '<button type="button" class="rm-act" data-rm-edit="' + x.id + '">修改</button>' +
        '<button type="button" class="rm-act rm-act-del" data-rm-del="' + x.id + '">删除</button>' +
      '</div>' +
      '</div>';
  }

  function manualBlock(date) {
    // 覆盖微信读书卡的记录不单独成条，它已经顶到上面的卡里了
    const list = (manuals.get(date) || []).filter((x) => !x.override_key);
    const cards = list.map(manualCard).join('');
    // 「记一本」在面板右上角（和「记一把」同一个位置），这里只管条目
    const acts = document.getElementById('rd-actions');
    if (acts) acts.hidden = !window.currentUser;
    if (!cards) return '';
    return '<div class="rm-wrap">' + cards + '</div>';
  }

  function bindManual() {
    const addBtn = document.getElementById('rm-add-top');
    if (addBtn) addBtn.onclick = () => rmOpen();
    body.querySelectorAll('[data-rm-del]').forEach((b) => {
      b.onclick = () => rmDelete(Number(b.dataset.rmDel));
    });
    body.querySelectorAll('[data-rm-edit]').forEach((b) => {
      b.onclick = () => rmOpen(b.dataset.rmEdit);
    });
  }

  let rmEditId = 0;    // 手写条目的 id，0 = 新建
  let rmEditKey = '';  // 覆盖微信读书卡时的 key（wx-<date>）

  function rmOpen(target) {
    const modal = document.getElementById('read-modal');
    if (!modal) return;
    rmEditId = 0;
    rmEditKey = '';
    ['rm-title', 'rm-author', 'rm-minutes', 'rm-summary'].forEach((k) => {
      const el = document.getElementById(k);
      if (el) el.value = '';
    });
    const set = (k, v) => { const el = document.getElementById(k); if (el) el.value = v == null ? '' : v; };

    if (typeof target === 'string' && target.indexOf('wx-') === 0) {
      // 改微信读书同步来的那张卡：用当前展示值（可能已有覆盖）打底
      rmEditKey = target;
      const date = target.slice(3);
      const it = payloads.get(date);
      const ov = (manuals.get(date) || []).find((x) => x.override_key === target) || null;
      if (it) {
        const book = it.book || {};
        set('rm-title', ov && ov.title ? ov.title : (book.title || ''));
        set('rm-author', ov ? (ov.author || '') : (book.author || ''));
        set('rm-minutes', (ov && ov.minutes) ? ov.minutes : (Number(it.minutes) || ''));
        set('rm-summary', ov ? (ov.summary || '') : '');
      }
    } else if (target) {
      rmEditId = Number(target) || 0;
      const x = (manuals.get(curDate) || []).find((it) => it.id === rmEditId);
      if (x) {
        set('rm-title', x.title);
        set('rm-author', x.author);
        set('rm-minutes', x.minutes || '');
        set('rm-summary', x.summary);
      }
    }

    const head = document.getElementById('rm-head');
    if (head) head.textContent = (rmEditId || rmEditKey) ? '修改这本' : '记一本';
    const file = document.getElementById('rm-photos');
    if (file) file.value = '';
    const cnt = document.getElementById('rm-file-count');
    if (cnt) cnt.textContent = '';
    modal.hidden = false;
    const t = document.getElementById('rm-title');
    if (t) setTimeout(() => t.focus(), 60);
  }

  function rmClose() {
    const modal = document.getElementById('read-modal');
    if (modal) modal.hidden = true;
  }

  async function rmSave() {
    const btn = document.getElementById('rm-save');
    const val = (id) => {
      const el = document.getElementById(id);
      return el ? el.value.trim() : '';
    };
    const title = val('rm-title');
    if (!title) { alert('书名不能为空'); return; }

    const fd = new FormData();
    if (rmEditId) fd.append('id', String(rmEditId));
    if (rmEditKey) fd.append('override_key', rmEditKey);
    fd.append('date', curDate || todayStr());
    fd.append('title', title);
    fd.append('author', val('rm-author'));
    fd.append('minutes', val('rm-minutes') || '0');
    fd.append('summary', val('rm-summary'));

    const fileInput = document.getElementById('rm-photos');
    const files = fileInput && fileInput.files ? [...fileInput.files].slice(0, 4) : [];
    files.forEach((f) => fd.append('photos', f));

    if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
    try {
      const r = await fetch('/api/reading-manual', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || '保存失败');
      rmClose();
      rmEditId = 0;
      rmEditKey = '';
      await loadManuals();
      render(curDate || todayStr());
    } catch (err) {
      alert(err.message || '保存失败');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '保存'; }
    }
  }

  async function rmDelete(id) {
    if (!id || !confirm('删掉这条阅读记录？')) return;
    try {
      const r = await fetch('/api/reading-manual?id=' + id, { method: 'DELETE' });
      if (!r.ok) throw new Error('删除失败');
      await loadManuals();
      render(curDate || todayStr());
    } catch (err) {
      alert(err.message || '删除失败');
    }
  }

  function loadManuals() {
    return fetch('/api/reading-manual?days=60', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        manuals.clear();
        ((d && d.items) || []).forEach((it) => {
          if (!manuals.has(it.date)) manuals.set(it.date, []);
          manuals.get(it.date).push(it);
        });
      })
      .catch(() => { /* 接口挂了就当没有手动记录 */ });
  }

  function render(date) {
    if (!date) { body.innerHTML = ''; return; }
    curDate = date;
    const it = payloads.get(date);
    const m = it ? Number(it.minutes) || 0 : (minutes.get(date) || 0);
    // 微信读书那张卡也允许校正：一天一张，key 固定为 wx-<date>
    const wxOv = (manuals.get(date) || []).find((x) => x.override_key === 'wx-' + date) || null;
    let html;
    if (it && m > 0) html = fullCard(it, wxOv, date);
    else if (m > 0) html = compactState(date);
    else html = emptyState(date);
    body.innerHTML = html + manualBlock(date);
    bindManual();
  }

  function load() {
    // 手动条目独立拉取：接口挂了也不影响微信读书那张卡
    loadManuals().then(() => { if (curDate) render(curDate); });
    fetch('/api/reading?days=30')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const items = (d && d.items) || [];
        reco = (d && d.reco) || [];
        items.forEach((it) => {
          payloads.set(it.date, it);
          // 明细里自带的 7 天序列,顺手补上「只有时长」的历史日
          (it.days || []).forEach((x) => {
            const v = Number(x.m) || 0;
            if (!minutes.has(x.d) || v > minutes.get(x.d)) minutes.set(x.d, v);
          });
          const v = Number(it.minutes) || 0;
          if (!minutes.has(it.date) || v > minutes.get(it.date)) minutes.set(it.date, v);
        });
        if (items.length) latest = items[0];
        loaded = true;
        const cur = window.__ggSelectedDate || (window.__ggSelectedDate = null) || todayStr();
        render(cur);
        // 调试直链 ?rd=YYYY-MM-DD:app.js 初始化会先选中今天,等它渲染完再强制回目标日期
        if (forced && forced !== cur) setTimeout(() => render(forced), 350);
      })
      .catch(() => {
        // 接口挂了也要把 loaded 置 true 并渲染 —— 否则之后每个 gg:date 都被
        // 「if (!loaded) return」丢掉，面板永远空白（2026-11-04 用户报「当日在读没了」）。
        loaded = true;
        render(window.__ggSelectedDate || todayStr());
      });
  }

  // 跟随日历:selectDate 会派发 gg:date
  window.addEventListener('gg:date', (e) => {
    const date = e && e.detail && e.detail.date;
    if (!loaded) return;      // 数据未到时先不渲染,load() 完成会用当前日期补渲染
    render(date || todayStr());
  });

  // 调试/直链:?rd=YYYY-MM-DD 可强制看某天
  const forced = new URLSearchParams(location.search).get('rd');
  if (/^\d{4}-\d{2}-\d{2}$/.test(forced || '')) window.__ggSelectedDate = forced;

  // 弹窗按钮
  const rmCloseBtn = document.getElementById('rm-close');
  if (rmCloseBtn) rmCloseBtn.onclick = rmClose;
  const rmSaveBtn = document.getElementById('rm-save');
  if (rmSaveBtn) rmSaveBtn.onclick = rmSave;
  const rmFile = document.getElementById('rm-photos');
  if (rmFile) {
    rmFile.onchange = () => {
      const cnt = document.getElementById('rm-file-count');
      if (!cnt) return;
      const n = rmFile.files ? rmFile.files.length : 0;
      cnt.textContent = n ? n + ' 张' : '';
      if (n > 4) cnt.textContent = '最多 4 张，只取前 4 张';
    };
  }
  const rmModal = document.getElementById('read-modal');
  if (rmModal) {
    rmModal.addEventListener('click', (e) => { if (e.target === rmModal) rmClose(); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
