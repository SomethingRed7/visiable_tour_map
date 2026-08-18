// 行程导出 HTML API:
//   POST /api/export-html → 按专辑/日期区间 + 四类勾选,生成自包含 HTML 文件下载(离线可看,照片走线上 URL)
// 参数与 /api/share 一致:album/from/to/ck_public/ck_private/ck_todo/ck_checkin(checkbox 缺席=全勾)
import { verifySession } from '../_lib/auth.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 60;

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/* 与 share.js/导出页同款过滤 */
function filterEntries(list, album, from, to, ck) {
  return list
    .filter((e) => {
      if (album && e.album !== album) return false;
      if (from && to && (e.date < from || e.date > to)) return false;
      if (e.visibility !== 'private') return ck.public;
      const isCheckin = (e.title || '').startsWith('打卡:');
      if (isCheckin) return ck.private && ck.checkin;
      return ck.private;
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.ts || 0) - (b.ts || 0)));
}

function normEntry(e) {
  let location = null;
  try { location = e.location ? JSON.parse(e.location) : null; } catch { location = null; }
  let photos = [];
  try { photos = JSON.parse(e.photos || '[]'); } catch { photos = []; }
  return {
    date: e.date || '', title: e.title || '', text: e.text || '', album: e.album || null,
    author: e.author || null, location, ts: e.ts ?? null, photos,
    visibility: e.visibility || 'public', created_at: e.created_at || null,
  };
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(Number(ts));
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function thumbUrl(p) { return p.replace(/\.(jpg|jpeg|png)$/i, '-thumb.$1'); }

export async function onRequestPost(context) {
  const user = await verifySession(context.env, context.request);
  if (!user) return Response.json({ error: '请先登录' }, { status: 401 });

  const form = await context.request.formData().catch(() => null);
  if (!form) return Response.json({ error: '缺少表单数据' }, { status: 400 });

  const chk = (n) => {
    const v = form.get(n);
    if (v === null) return true;
    return v !== '' && v !== '0' && v !== 'false';
  };

  const album = (form.get('album') || '').trim();
  const from = (form.get('from') || '').trim();
  const to = (form.get('to') || '').trim();
  const fromOk = DATE_RE.test(from);
  const toOk = DATE_RE.test(to);
  const rangeOk = fromOk && toOk && from <= to;
  if (!album && !rangeOk) return Response.json({ error: '请选择专辑,或选择起止日期(可都选叠加)' }, { status: 400 });
  if ((from || to) && !rangeOk) return Response.json({ error: '起始/结束日期需成对且起始不晚于结束' }, { status: 400 });
  if (rangeOk) {
    const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
    if (days > MAX_RANGE_DAYS) return Response.json({ error: '区间最多 60 天' }, { status: 400 });
  }

  const ck = { public: chk('ck_public'), private: chk('ck_private'), todo: chk('ck_todo'), checkin: chk('ck_checkin') };
  const { results: entryRows } = await context.env.DB.prepare('SELECT * FROM entries').all();
  const entries = filterEntries((entryRows || []).map(normEntry), album || null, rangeOk ? from : null, rangeOk ? to : null, ck);

  let todos = [];
  if (rangeOk && ck.todo) {
    const { results: todoRows } = await context.env.DB
      .prepare('SELECT id, date, text, done, sort_order, checkin_ts FROM todos ORDER BY date ASC, sort_order ASC, id ASC')
      .all();
    todos = (todoRows || []).filter((t) => t.date >= from && t.date <= to);
  }

  const origin = new URL(context.request.url).origin;

  // ---- 渲染 HTML ----
  const condParts = [];
  if (album) condParts.push(`专辑：${esc(album)}`);
  if (rangeOk) condParts.push(`${esc(from)} ~ ${esc(to)}`);
  if (!condParts.length) condParts.push('全部内容');
  const ckParts = [];
  if (ck.public) ckParts.push('公开');
  if (ck.private) ckParts.push('私有');
  if (ck.checkin) ckParts.push('打卡');
  if (ck.todo) ckParts.push('待办');

  // 按日期分组
  const byDate = {};
  for (const e of entries) (byDate[e.date] = byDate[e.date] || []).push(e);
  const dateKeys = Object.keys(byDate).sort();

  const entriesHtml = dateKeys.map((d) => `
    <div class="date-head">${esc(d)}</div>
    ${byDate[d].map((e) => {
      const meta = [];
      if (e.ts) meta.push(esc(fmtTime(e.ts)));
      if (e.author) meta.push(esc(e.author));
      meta.push(e.visibility === 'private' ? '私有' : '公开');
      if (e.album) meta.push(esc(e.album));
      if (e.location && e.location.name) meta.push(`📍 ${esc(String(e.location.name).split(/[,，]/)[0])}`);
      const photos = (e.photos || []).map((p) => `<img src="${esc(origin)}/photos/${esc(p)}" loading="lazy" alt="照片">`).join('');
      return `
      <div class="item">
        <div class="meta">${meta.join(' · ')}</div>
        <div class="title">${esc(e.title || '')}</div>
        ${e.text ? `<div class="text">${esc(e.text).replace(/\n/g, '<br>')}</div>` : ''}
        ${photos ? `<div class="photos">${photos}</div>` : ''}
      </div>`;
    }).join('')}
  `).join('');

  const todosHtml = todos.length ? `
    <div class="date-head">待办</div>
    ${todos.map((t) => `<div class="item"><div class="meta">${esc(t.date)}${t.done ? ' · 已完成 ✅' : ' · 未完成'}</div><div class="title">${esc(t.text)}</div></div>`).join('')}
  ` : '';

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>咕咕嘎嘎 · 行程导出</title>
<style>
  body { margin: 0; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2937; background: #f5f5f7; }
  .wrap { max-width: 720px; margin: 0 auto; padding: 16px; }
  header { background: #111827; color: #fff; padding: 18px 16px; }
  header h1 { margin: 0; font-size: 1.1rem; }
  header .sub { font-size: 0.8rem; color: #9ca3af; margin-top: 4px; }
  .cond { background: #fff; border-radius: 10px; padding: 10px 12px; margin: 12px 0; font-size: 0.85rem; color: #6b7280; }
  .date-head { font-weight: 700; font-size: 0.9rem; margin: 16px 0 6px; display: flex; align-items: center; gap: 8px; }
  .date-head::after { content: ''; flex: 1; height: 1px; background: #e5e7eb; }
  .item { background: #fff; border-radius: 10px; padding: 12px; margin-bottom: 8px; }
  .item .meta { font-size: 0.75rem; color: #6b7280; margin-bottom: 4px; }
  .item .title { font-weight: 600; font-size: 1rem; }
  .item .text { font-size: 0.9rem; color: #374151; margin-top: 6px; white-space: pre-wrap; }
  .photos { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .photos img { width: 96px; height: 96px; object-fit: cover; border-radius: 8px; }
  footer { text-align: center; color: #9ca3af; font-size: 0.75rem; padding: 20px 0; }
</style>
</head>
<body>
<header>
  <h1>咕咕嘎嘎 · 行程导出</h1>
  <div class="sub">${condParts.join(' · ')} · 共 ${entries.length} 条${todos.length ? ` · 待办 ${todos.length} 项` : ''}</div>
</header>
<div class="wrap">
  <div class="cond">包含：${ckParts.join(' / ')} · 生成于 ${new Date().toLocaleString('zh-CN', { hour12: false })}</div>
  ${entriesHtml}
  ${todosHtml}
  ${entries.length || todos.length ? '' : '<p style="text-align:center;color:#9ca3af;">没有符合条件的内容</p>'}
</div>
<footer>由咕咕嘎嘎生成</footer>
</body>
</html>`;

  const filename = encodeURIComponent(`咕咕嘎嘎-行程导出-${new Date().toISOString().slice(0, 10)}.html`);
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="gugugaga-export.html"; filename*=UTF-8''${filename}`,
    },
  });
}
