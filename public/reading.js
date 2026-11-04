// 首页「最近在读」面板:读 /api/reading?days=7,渲染成一张读书卡。
// 数据由每日播报脚本从微信读书拉取后 POST 上来,前端只读。
(function () {
  const panel = document.getElementById('reading-panel');
  if (!panel) return;
  const body = document.getElementById('reading-body');
  const sub = document.getElementById('reading-sub');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function mm(v) {
    const n = Math.round(Number(v) || 0);
    if (n < 60) return n + ' 分';
    return Math.floor(n / 60) + ' 时 ' + (n % 60) + ' 分';
  }

  // 2026-11-04 → 11.04
  function md(d) { return String(d || '').slice(5).replace('-', '.'); }

  function barChart(days) {
    const list = (days || []).slice(-7);
    if (!list.length) return '';
    const max = Math.max.apply(null, list.map((d) => Number(d.m) || 0)) || 1;
    const cols = list.map((d) => {
      const m = Number(d.m) || 0;
      const h = Math.max(3, Math.round((m / max) * 100));
      const on = m > 0;
      return '<div class="rd-col">' +
        '<div class="rd-bar' + (on ? '' : ' rd-off') + '" style="height:' + h + '%" title="' + esc(md(d.d)) + ' · ' + mm(m) + '"></div>' +
        '<span class="rd-day">' + esc(md(d.d)) + '</span>' +
        '</div>';
    }).join('');
    return '<div class="rd-chart">' + cols + '</div>';
  }

  function render(items) {
    if (!items || !items.length) { panel.hidden = true; return; }
    const latest = items[0];
    const book = latest.book || {};
    const pct = Math.max(0, Math.min(100, Number(latest.progress) || 0));

    const quotes = (latest.quotes || []).slice(0, 2).map((q) =>
      '<p class="rd-quote">' + esc(q.t) + '</p>').join('');

    const facts = [];
    if (latest.highlights_today) facts.push('今日划线 ' + latest.highlights_today + ' 条');
    if (latest.highlights) facts.push('累计划线 ' + latest.highlights + ' 条');
    if (latest.chapter) facts.push('读到「' + latest.chapter + '」');

    body.innerHTML =
      '<div class="rd-top">' +
        '<div class="rd-book"><b>' + esc(book.title || '在读') + '</b>' +
          '<span class="rd-author">' + esc(book.author || '') + '</span></div>' +
        '<div class="rd-min">' + mm(latest.minutes) + '<small>今日</small></div>' +
      '</div>' +
      '<div class="rd-progress"><div class="rd-progress-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="rd-progress-label"><span>全书 ' + pct + '%</span>' +
        '<span>本周 ' + mm(latest.week_minutes) + '</span></div>' +
      barChart(latest.days) +
      (facts.length ? '<p class="rd-facts">' + esc(facts.join(' · ')) + '</p>' : '') +
      quotes +
      '<p class="rd-foot">更新于 ' + esc(md(latest.date)) + '</p>';

    sub.textContent = latest.chapter ? '第 ' + (latest.chapter_idx || '') + ' 章 · 全书 ' + pct + '%' : '';
    panel.hidden = false;
  }

  fetch('/api/reading?days=7')
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => render(d && d.items))
    .catch(() => { panel.hidden = true; });
})();
