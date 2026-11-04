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
  const manualByDate = new Map();   // date -> 手写的运动记录[]
  let amEditId = 0;                 // 手写条目的 id，0 = 新增
  let amEditKey = '';               // 覆盖 COROS 某条时用的 key
  let amIcon = '🏃';

  const KINDS = [
    { name: '跑步', icon: '🏃' }, { name: '骑行', icon: '🚴' },
    { name: '羽毛球', icon: '🏸' }, { name: '攀岩', icon: '🧗' },
    { name: '跳绳', icon: '🤸' }, { name: '爬楼', icon: '🪜' },
    { name: '健身', icon: '🏋️' }, { name: '徒步', icon: '🥾' },
  ];

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
    const row = '<div class="ac-item">' +
      '<span class="ac-icon">' + icon + '</span>' +
      '<span class="ac-main"><b>' + name + '</b>' +
        (facts.length ? '<em>' + esc(facts.join(' · ')) + '</em>' : '') +
      '</span>' +
      (main ? '<span class="ac-figure">' + esc(main) + '</span>' : '') +
      '</div>';

    // 一律带操作：COROS 同步的也能改（改完存成本地覆盖记录，不动同步数据）
    const who = it.manual
      ? (it.author_name ? esc(it.author_name) + ' 记的' : '手动记录')
      : '高驰同步';
    const target = it.manual ? it.id : it._key;
    const del = it.manual
      ? '<button type="button" class="rm-act rm-act-del" data-am-del="' + it.id + '">删除</button>'
      : '';
    return '<div class="ac-manual">' + row +
      '<div class="ac-manual-acts">' +
        '<span class="rm-by">' + who + '</span>' +
        '<span class="ac-manual-btns">' +
          '<button type="button" class="rm-act" data-am-edit="' + target + '">修改</button>' +
          del +
        '</span>' +
      '</div></div>';
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

    const isFuture = !isToday && date > todayStr();
    return '<div class="day-empty">' +
      '<p class="day-empty-main">' + (isFuture ? '还没到这天' : isToday ? '今天还没动' : '这天没有运动记录') + '</p>' +
      (prev ? '<p class="day-empty-sub">上次：' + esc(prev) + '</p>' : '') +
      '<p class="day-empty-tip">' + esc(tip) + '</p>' +
      '</div>';
  }

  // ---------- 手动运动记录 ----------

  function loadManual() {
    return fetch('/api/activity-manual?days=60', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        manualByDate.clear();
        ((d && d.items) || []).forEach((it) => {
          if (!manualByDate.has(it.date)) manualByDate.set(it.date, []);
          manualByDate.get(it.date).push(it);
        });
      })
      .catch(() => { /* 接口挂了就当没有手写记录 */ });
  }

  function bindManualActs() {
    const add = document.getElementById('am-add');
    if (add) add.onclick = () => amOpen();
    body.querySelectorAll('[data-am-edit]').forEach((b) => {
      b.onclick = () => amOpen(b.dataset.amEdit);
    });
    body.querySelectorAll('[data-am-del]').forEach((b) => {
      b.onclick = () => amDelete(Number(b.dataset.amDel));
    });
  }

  function renderKinds() {
    const box = document.getElementById('am-kinds');
    if (!box) return;
    box.innerHTML = KINDS.map((k) =>
      '<button type="button" class="chip" data-kind="' + k.name + '" data-icon="' + k.icon + '"' +
      ' aria-pressed="' + (k.icon === amIcon) + '">' + k.icon + ' ' + k.name + '</button>'
    ).join('');
    box.querySelectorAll('.chip').forEach((b) => {
      b.onclick = () => {
        amIcon = b.dataset.icon;
        const nm = document.getElementById('am-name');
        if (nm && !nm.value.trim()) nm.value = b.dataset.kind;
        renderKinds();
      };
    });
  }

  function amOpen(target) {
    const modal = document.getElementById('act-modal');
    if (!modal) return;
    amEditId = 0;
    amEditKey = '';
    ['am-name', 'am-minutes', 'am-dist'].forEach((k) => {
      const el = document.getElementById(k);
      if (el) el.value = '';
    });
    amIcon = '🏃';

    const set = (k, v) => { const el = document.getElementById(k); if (el) el.value = v == null ? '' : v; };

    if (typeof target === 'string' && target.indexOf('auto-') === 0) {
      // 改 COROS 同步来的那条：把它的值填进来，保存时写成覆盖记录
      amEditKey = target;
      const idx = Number(target.split('-').pop());
      const it = byDate.get(current);
      const x = (it && it.items && it.items[idx]) || null;
      if (x) {
        set('am-name', x.name);
        set('am-minutes', x.dur ? Math.round(Number(x.dur) / 60) : '');
        set('am-dist', x.dist ? (Number(x.dist) / 1000).toFixed(1) : '');
        amIcon = x.icon || '🏃';
      }
    } else if (target) {
      amEditId = Number(target) || 0;
      const x = (manualByDate.get(current) || []).find((it) => it.id === amEditId);
      if (x) {
        set('am-name', x.name);
        set('am-minutes', x.dur ? Math.round(x.dur / 60) : '');
        set('am-dist', x.dist || '');
        amIcon = x.icon || '🏃';
      }
    }

    const head = document.getElementById('am-head');
    if (head) head.textContent = (amEditId || amEditKey) ? '修改这次' : '记一次';
    renderKinds();
    modal.hidden = false;
  }

  function amClose() {
    const modal = document.getElementById('act-modal');
    if (modal) modal.hidden = true;
  }

  async function amSave() {
    const btn = document.getElementById('am-save');
    const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    const name = val('am-name');
    if (!name) { alert('写个运动名称'); return; }

    const fd = new FormData();
    if (amEditId) fd.append('id', String(amEditId));
    if (amEditKey) fd.append('override_key', amEditKey);
    fd.append('date', current || todayStr());
    fd.append('name', name);
    fd.append('icon', amIcon);
    fd.append('minutes', val('am-minutes') || '0');
    fd.append('dist', val('am-dist') || '0');

    if (btn) { btn.disabled = true; btn.textContent = '保存中…'; }
    try {
      const r = await fetch('/api/activity-manual', { method: 'POST', body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || '保存失败');
      amClose();
      amEditId = 0;
      amEditKey = '';
      await loadManual();
      render(current || todayStr());
    } catch (err) {
      alert(err.message || '保存失败');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '保存'; }
    }
  }

  async function amDelete(id) {
    if (!id || !confirm('删掉这条运动记录？')) return;
    try {
      const r = await fetch('/api/activity-manual?id=' + id, { method: 'DELETE' });
      if (!r.ok) throw new Error('删除失败');
      await loadManual();
      render(current || todayStr());
    } catch (err) {
      alert(err.message || '删除失败');
    }
  }

  function render(date) {
    current = date || '';
    if (!date) { body.innerHTML = ''; return; }
    const it = byDate.get(date);

    // COROS 每条给个稳定 key，手写记录可以按这个 key 覆盖它（相当于校正同步数据）
    const auto = ((it && it.items) || []).map((x, i) => Object.assign({}, x, {
      _key: 'auto-' + date + '-' + i,
      manual: false,
    }));
    const manualAll = manualByDate.get(date) || [];
    const overrides = new Map();
    manualAll.forEach((m) => { if (m.override_key) overrides.set(m.override_key, m); });

    const items = auto.map((a) => {
      const ov = overrides.get(a._key);
      return ov ? Object.assign({}, ov, { manual: true }) : a;
    }).concat(manualAll.filter((m) => !m.override_key));

    if (items.length) {
      body.innerHTML = items.map(itemRow).join('') + summaryBar(items);
    } else if (minutes.get(date) > 0) {
      // 只有时长没有明细(历史日期,从 days 反推)
      body.innerHTML = '<p class="ac-facts">这天运动了 ' + minutes.get(date) + ' 分钟（明细没单独记录）</p>';
    } else {
      body.innerHTML = emptyState(date);
    }
    body.insertAdjacentHTML('beforeend', manualAddBtn());
    bindManualActs();
  }

  // 底部汇总：共几项、多长时间、多少距离
  function summaryBar(items) {
    const total = items.reduce((s, x) => s + (Number(x.dur) || 0), 0);
    const dist = items.reduce((s, x) => s + (Number(x.dist) || 0), 0);
    const parts = ['共 ' + items.length + ' 项'];
    if (total) parts.push(mmss(total));
    if (dist) parts.push(dist.toFixed(dist >= 10 ? 0 : 1) + ' km');
    return '<p class="ac-facts">' + esc(parts.join(' · ')) + '</p>';
  }

  function manualAddBtn() {
    if (!window.currentUser) return '';
    // 和「记一把」同一个样式（橙色实心胶囊、靠右）
    return '<div class="ac-add-row"><button type="button" class="btn-add-entry" id="am-add">＋ 记一次</button></div>';
  }

  function load() {
    loadManual().then(() => { if (loaded && current) render(current); });
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

  // 弹窗按钮
  const amCloseBtn = document.getElementById('am-close');
  if (amCloseBtn) amCloseBtn.onclick = amClose;
  const amSaveBtn = document.getElementById('am-save');
  if (amSaveBtn) amSaveBtn.onclick = amSave;
  const amModal = document.getElementById('act-modal');
  if (amModal) amModal.addEventListener('click', (e) => { if (e.target === amModal) amClose(); });

  window.addEventListener('gg:date', (e) => {
    const date = e.detail && e.detail.date;
    if (!date) return;
    current = date;
    if (loaded) render(date); else body.innerHTML = '';
  });

  load();
})();
