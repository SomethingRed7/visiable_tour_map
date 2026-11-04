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
  let loaded = false;

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

  function emptyState(date) {
    const isToday = date === todayStr();
    const book = (latest && latest.book) || {};
    const name = book.title ? '《' + book.title + '》' : '';
    // 前一天读了多久,用来把「该去读书了」说得具体一点
    let prevTip = '';
    for (let i = 1; i <= 7; i++) {
      const d = new Date(date + 'T00:00:00');
      d.setDate(d.getDate() - i);
      const p = (n) => String(n).padStart(2, '0');
      const key = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      const m = minutes.get(key);
      if (m) { prevTip = (i === 1 ? '昨天' : '前 ' + i + ' 天') + '读了 ' + mm(m); break; }
    }
    const link = book.link
      ? '<a class="rd-empty-link" href="' + esc(book.link) + '">去读' + esc(name) + '</a>'
      : '';
    return '<div class="rd-empty">' +
      '<p class="rd-empty-main">' + (isToday ? '今天还没翻开书' : '这天没有读书记录') + '</p>' +
      '<p class="rd-empty-sub">' + (isToday
        ? ('该去读书了' + (prevTip ? ' · ' + prevTip : ''))
        : '换一天看看,或者从今天开始') + '</p>' +
      link + '</div>';
  }

  function compactState(date) {
    const m = minutes.get(date) || 0;
    return '<div class="rd-top"><div class="rd-book"><b>' + mm(m) + '</b>' +
      '<span class="rd-author">这天读了这么久</span></div></div>' +
      '<p class="rd-facts">当天明细没有单独记录(明细只在推送当天保存)</p>' +
      barChart(latest && latest.days);
  }

  function fullCard(it) {
    const book = it.book || {};
    const pct = Math.max(0, Math.min(100, Number(it.progress) || 0));
    const facts = [];
    if (it.highlights_today) facts.push('当日划线 ' + it.highlights_today + ' 条');
    if (it.highlights) facts.push('累计划线 ' + it.highlights + ' 条');
    if (it.chapter) facts.push('读到「' + it.chapter + '」');
    const quotes = (it.quotes || []).slice(0, 2).map((q) =>
      '<p class="rd-quote">' + esc(q.t) + '</p>').join('');
    return '<div class="rd-top">' +
        '<div class="rd-book"><b>' + esc(book.title || '在读') + '</b>' +
          '<span class="rd-author">' + esc(book.author || '') + '</span></div>' +
        '<div class="rd-min">' + mm(it.minutes) + '<small>这天</small></div>' +
      '</div>' +
      '<div class="rd-progress"><div class="rd-progress-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="rd-progress-label"><span>全书 ' + pct + '% · 第 ' + (it.chapter_idx || '') + '／' +
        (it.chapters || '') + ' 章</span><span>当周 ' + mm(it.week_minutes) + '</span></div>' +
      barChart(it.days) +
      (facts.length ? '<p class="rd-facts">' + esc(facts.join(' · ')) + '</p>' : '') +
      quotes;
  }

  function render(date) {
    if (!date) { body.innerHTML = ''; return; }
    const it = payloads.get(date);
    const m = it ? Number(it.minutes) || 0 : (minutes.get(date) || 0);
    if (it && m > 0) body.innerHTML = fullCard(it);
    else if (m > 0) body.innerHTML = compactState(date);
    else body.innerHTML = emptyState(date);
  }

  function load() {
    fetch('/api/reading?days=30')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const items = (d && d.items) || [];
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
      .catch(() => { /* 接口挂了就当这天没读,不报错 */ });
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', load);
  } else {
    load();
  }
})();
