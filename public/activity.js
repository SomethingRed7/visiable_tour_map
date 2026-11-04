// 「当日运动」tab:跟随日历所选日期(app.js 的 selectDate 派发 gg:date 事件)。
// 数据来自 /api/activity(COROS 那边同步后推送上来);前端只读。
// - 当天有运动 → 逐条列出(类型/时长/距离/配速/心率/消耗) + 近 7 天柱状图
// - 当天没动 → 说清「上一次是什么时候、做了什么」,不空喊口号
(function () {
  const body = document.getElementById('activity-body');
  if (!body) return;

  const byDate = new Map();     // date -> payload
  let minutes = new Map();      // date -> 运动分钟(含 days 反推)
  let loaded = false;
  let current = '';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function pad(n) { return String(n).padStart(2, '0'); }
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function shiftDay(date, delta) {
    const d = new Date(date + 'T00:00:00');
    d.setDate(d.getDate() + delta);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  function mmss(sec) {
    const n = Math.round(Number(sec) || 0);
    if (n <= 0) return '';
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    const s = n % 60;
    return h ? `${h} 时 ${pad(m)} 分` : (m ? `${m} 分 ${pad(s)} 秒` : `${s} 秒`);
  }

  // 行右侧的位置窄，用紧凑写法：15:29 / 1:19:50
  function clock(sec) {
    const n = Math.round(Number(sec) || 0);
    if (n <= 0) return '';
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    const s = n % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  function km(meters) {
    const n = Number(meters) || 0;
    if (n <= 0) return '';
    return (n >= 10000 ? (n / 1000).toFixed(1) : (n / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')) + ' km';
  }

  // 配速:秒/公里 → 6'12"
  function pace(secPerKm) {
    const n = Math.round(Number(secPerKm) || 0);
    if (n <= 0) return '';
    return Math.floor(n / 60) + "'" + pad(n % 60) + '"';
  }

  function barChart(days) {
    const list = (days || []).slice(-7);
    if (!list.length) return '';
    const max = Math.max.apply(null, list.map((d) => Number(d.m) || 0)) || 1;
    const cols = list.map((d) => {
      const v = Number(d.m) || 0;
      const h = v ? Math.max(6, Math.round((v / max) * 34)) : 2;
      const cls = d.d === current ? ' ac-bar is-current' : ' ac-bar';
      return `<span class="${cls.trim()}" style="height:${h}px" title="${esc(d.d)} ${v} 分"></span>`;
    }).join('');
    return '<div class="ac-week"><span class="ac-week-label">近 7 天</span>' +
      '<span class="ac-bars">' + cols + '</span></div>';
  }

  function itemRow(it) {
    const name = esc(it.name || '运动');
    const icon = esc(it.icon || '🏃');
    const main = km(it.dist) || clock(it.dur);
    const facts = [];
    const d = mmss(it.dur);
    if (d && km(it.dist)) facts.push(d);
    const p = pace(it.pace);
    if (p) facts.push(p + '/km');
    if (Number(it.hr) > 0) facts.push('心率 ' + Math.round(it.hr));
    if (Number(it.cal) > 0) facts.push(Math.round(it.cal) + ' 千卡');
    return '<div class="ac-item">' +
      '<span class="ac-icon">' + icon + '</span>' +
      '<span class="ac-main"><b>' + name + '</b>' +
        (facts.length ? '<em>' + esc(facts.join(' · ')) + '</em>' : '') +
      '</span>' +
      (main ? '<span class="ac-figure">' + esc(main) + '</span>' : '') +
      '</div>';
  }

  function emptyState(date) {
    const isToday = date === todayStr();
    // 往前找最近一次运动，把「上次」说得具体
    let prev = '';
    for (let i = 1; i <= 30; i++) {
      const key = shiftDay(date, -i);
      const p = byDate.get(key);
      const first = p && (p.items || [])[0];
      if (first) {
        const label = i === 1 ? '昨天' : i === 2 ? '前天' : `${Number(key.slice(5, 7))} 月 ${Number(key.slice(8, 10))} 日`;
        const what = [first.name, km(first.dist) || clock(first.dur)].filter(Boolean).join(' ');
        prev = `${label} ${what}`;
        break;
      }
    }

    // 本周（从周一起）动了几天 —— 提示用真实数据说话，比空喊「该运动了」有用
    const dow = new Date(date + 'T00:00:00').getDay() || 7;   // 周日算第 7 天
    let weekCount = 0;
    for (let i = 0; i < dow; i++) {
      const k = shiftDay(date, -i);
      const p = byDate.get(k);
      if ((p && (p.items || []).length) || (minutes.get(k) || 0) > 0) weekCount++;
    }

    let tip = '';
    if (!isToday) {
      tip = '这天没有运动记录';
    } else if (!byDate.size && !minutes.size) {
      tip = '动一下，这里就有记录了';
    } else if (weekCount === 0) {
      tip = '这周还没动过，今天开个头？';
    } else if (weekCount <= 2) {
      tip = `这周动了 ${weekCount} 天，今天再补一次？`;
    } else {
      tip = `这周已经动了 ${weekCount} 天，保持住`;
    }

    return '<div class="day-empty">' +
      '<p class="day-empty-main">' + (isToday ? '今天还没动' : '这天没有运动记录') + '</p>' +
      (prev ? '<p class="day-empty-sub">上次：' + esc(prev) + '</p>' : '') +
      '<p class="day-empty-tip">' + esc(tip) + '</p>' +
      '</div>';
  }

  function render(date) {
    current = date || '';
    if (!date) { body.innerHTML = ''; return; }
    const it = byDate.get(date);
    const items = (it && it.items) || [];
    if (items.length) {
      const total = items.reduce((s, x) => s + (Number(x.dur) || 0), 0);
      const cal = items.reduce((s, x) => s + (Number(x.cal) || 0), 0);
      body.innerHTML =
        items.map(itemRow).join('') +
        barChart((it && it.days) || []) +
        (items.length > 1
          ? '<p class="ac-facts">共 ' + items.length + ' 项' +
            (total ? ' · ' + mmss(total) : '') + (cal ? ' · ' + Math.round(cal) + ' 千卡' : '') + '</p>'
          : '');
    } else if (minutes.get(date) > 0) {
      // 只有时长没有明细(历史日期,从 days 反推)
      body.innerHTML = '<p class="ac-facts">这天运动了 ' + minutes.get(date) + ' 分钟（明细没单独记录）</p>' +
        barChart((it && it.days) || []);
    } else {
      body.innerHTML = emptyState(date);
    }
  }

  function load() {
    fetch('/api/activity?days=30', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const items = (d && d.items) || [];
        minutes = new Map();
        items.forEach((it) => {
          byDate.set(it.date, it);
          (it.days || []).forEach((x) => {
            const v = Number(x.m) || 0;
            if (v && (!minutes.has(x.d) || v > minutes.get(x.d))) minutes.set(x.d, v);
          });
        });
        loaded = true;
        // 数据到了就把当前选中日补渲染一次。current 可能还是空的
        // （用户还没点日历、gg:date 没派发过），这时按 app.js 的选中日期兜底 ——
        // 否则切到「当日运动」看到的就是一片空白。
        render(current || window.__ggSelectedDate || todayStr());
      })
      .catch(() => {
        // 同上:失败也要落地一次渲染,否则面板一片空白
        loaded = true;
        render(current || window.__ggSelectedDate || todayStr());
      });
  }

  window.addEventListener('gg:date', (e) => {
    const date = e.detail && e.detail.date;
    if (!date) return;
    current = date;
    if (loaded) render(date); else body.innerHTML = '';
  });

  load();
})();
