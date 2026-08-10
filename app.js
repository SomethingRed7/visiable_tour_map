/* 旅行地图集 - 数据驱动渲染 */
'use strict';

const $ = (sel) => document.querySelector(sel);

async function loadJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`加载失败 ${url} (HTTP ${res.status})`);
  return res.json();
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ---------- 状态徽章 ---------- */
const STATUS = {
  booked:  { label: '已订',  cls: 'booked' },
  pending: { label: '待定',  cls: 'pending' },
};

function statusBadge(status) {
  const s = STATUS[status] || STATUS.pending;
  return `<span class="status-badge ${s.cls}">${s.label}</span>`;
}

/* ---------- 头部 ---------- */
function renderHeader(trip, index, data) {
  $('#trip-title').textContent = data.meta.title || trip.title || '旅行';
  $('#trip-subtitle').textContent = data.meta.subtitle || '';
  document.title = `${data.meta.title || trip.title} · 旅行地图集`;

  const sel = $('#trip-switcher');
  if (index.length > 1) {
    sel.hidden = false;
    sel.innerHTML = index
      .map((t) => `<option value="${escapeHtml(t.id)}" ${t.id === trip.id ? 'selected' : ''}>${escapeHtml(t.title)}</option>`)
      .join('');
  } else {
    sel.hidden = true;
  }
}

function setupSwitcher() {
  $('#trip-switcher').addEventListener('change', (e) => {
    const url = new URL(window.location.href);
    url.searchParams.set('trip', e.target.value);
    window.location.href = url.toString();
  });
}

/* ---------- 每日卡片 ---------- */
function renderCards(data) {
  const tl = $('#timeline');
  tl.innerHTML = '';

  if (!data.days || data.days.length === 0) {
    tl.innerHTML = '<p class="empty">暂无行程数据</p>';
    return;
  }

  for (const d of data.days) {
    const card = document.createElement('article');
    card.className = `day-card${d.status === 'booked' ? ' status-booked' : ''}`;
    card.dataset.day = d.day;

    const activities = (d.activities || [])
      .map((a) => `<li>${escapeHtml(a)}</li>`)
      .join('');

    card.innerHTML = `
      <div class="day-head">
        <span class="day-badge">Day ${d.day}</span>
        <span class="day-date">${escapeHtml(d.date)}${d.weekday ? ' ' + escapeHtml(d.weekday) : ''}</span>
        ${statusBadge(d.status)}
      </div>
      <h3 class="day-city">${escapeHtml(d.city)}${d.city_en ? ` <span class="city-en">${escapeHtml(d.city_en)}</span>` : ''}</h3>
      ${d.summary ? `<p class="day-summary">${escapeHtml(d.summary)}</p>` : ''}
      ${activities ? `<ul class="day-activities">${activities}</ul>` : ''}
      <dl class="day-meta">
        ${d.accommodation ? `<div><dt>住宿</dt><dd>${escapeHtml(d.accommodation)}</dd></div>` : ''}
        ${d.meals ? `<div><dt>餐食</dt><dd>${escapeHtml(d.meals)}</dd></div>` : ''}
        ${d.transport ? `<div><dt>交通</dt><dd>${escapeHtml(d.transport)}</dd></div>` : ''}
      </dl>
    `;
    tl.appendChild(card);
  }
}

/* ---------- 底部 ---------- */
function renderFooter(data) {
  const updated = data.meta && data.meta.updated_at;
  $('#footer').textContent = updated
    ? `最近更新:${updated} · 数据源:飞书文档`
    : '数据源:飞书文档';
}

/* ---------- 启动 ---------- */
async function init() {
  const index = await loadJSON('data/trips/index.json');

  if (!Array.isArray(index) || index.length === 0) {
    $('#timeline').innerHTML = '<p class="empty">暂无行程,请先在 data/trips/ 中添加</p>';
    return;
  }

  const requested = new URLSearchParams(window.location.search).get('trip');
  const trip = index.find((t) => t.id === requested) || index[0];
  const data = await loadJSON(`data/trips/${encodeURIComponent(trip.id)}.json`);

  renderHeader(trip, index, data);
  setupSwitcher();
  renderCards(data);
  renderFooter(data);
}

init().catch((err) => {
  console.error(err);
  $('#timeline').innerHTML = `<p class="empty">页面加载失败:${escapeHtml(err.message)}</p>`;
});
