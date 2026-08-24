// 行程分享快照 API:
//   POST   /api/share            → 创建快照(冻结内容入 KV + 写成 github.io 静态页 share/<token>.html)
//   POST   /api/share?token=xxx  → 更新快照(表单带重新选择的 album/from/to/inc/inc_todo,链接不变)
//   GET    /api/share?token=xxx  → 读取快照(供「更新」进生成页时预填;仅登录)
//   DELETE /api/share?token=xxx  → 删除快照(KV + github.io 静态页)
// 快照 key = `share:<8位随机码>`,value = { token, album, from, to, entries, todos, created_at, updated_at, url }
// 条目选择:inc = 逗号分隔 date|ts;inc_todo = 逗号分隔 date|sort_order|id;字段缺席=全选,空串=一个都不导出。
// 照片仅存路径引用(不复制);冻结语义=生成者逐个勾选决定。
// github.io 静态页写入需要 env.GH_PAT(GitHub token,只授权 somethingred7.github.io 仓库);
// 无 GH_PAT 或写入失败 → 回退返回 /s/<token>(pages.dev 服务端渲染),快照照常可用。
import { verifySession } from '../_lib/auth.js';
import { buildSnapshotHtml } from '../_lib/snapshot.js';

const GH_REPO = 'SomethingRed7/somethingred7.github.io';

// UTF-8 安全 base64(Workers 无 unescape)
function b64(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// 把快照页写成 github.io 静态文件 share/<token>.html;成功 true
async function ghWritePage(env, token, html) {
  const pat = env.GH_PAT;
  if (!pat) return false;
  const path = `share/${token}.html`;
  try {
    const res = await fetch(`https://api.github.com/repos/${GH_REPO}/contents/${path}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${pat}`, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'gugugaga' },
      body: JSON.stringify({ message: `share ${token}`, content: b64(html), branch: 'main' }),
    });
    return res.ok;
  } catch { return false; }
}

// 删除 github.io 静态文件(不存在视为成功);成功 true
async function ghDeletePage(env, token) {
  const pat = env.GH_PAT;
  if (!pat) return true;
  const path = `share/${token}.html`;
  const url = `https://api.github.com/repos/${GH_REPO}/contents/${path}`;
  try {
    const r = await fetch(url, { headers: { 'Authorization': `Bearer ${pat}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'gugugaga' } });
    if (r.status === 404) return true;
    if (!r.ok) return false;
    const meta = await r.json();
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${pat}`, 'Accept': 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'gugugaga' },
      body: JSON.stringify({ message: `delete ${token}`, sha: meta.sha, branch: 'main' }),
    });
    return res.ok;
  } catch { return false; }
}

// 冻结后写 KV + 尽力写 github.io 静态页;返回 { url }
async function persistSnapshot(env, snap, token) {
  const html = buildSnapshotHtml(snap, { cspMeta: true, origin: 'https://gugugaga-viw.pages.dev' });
  const ghOk = await ghWritePage(env, token, html);
  snap.url = ghOk ? `/share/${token}.html` : `/s/${token}`;
  await env.ENTRIES.put(`share:${token}`, JSON.stringify(snap));
  return snap.url;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 60;

function genToken() {
  // 8 位随机码,去易混字符(0/o/1/l/i)
  const CH = 'abcdefghjkmnpqrstuvwxyz23456789';
  const b = crypto.getRandomValues(new Uint8Array(8));
  let s = '';
  for (let i = 0; i < 8; i++) s += CH[b[i] % CH.length];
  return s;
}

/* 逐个条目导出选择:inc/inc_todo 逗号分隔 key(date|ts / date|sort|id);
 * 表单未提供该字段 → null(全选,旧客户端兼容);提供空串 → 一个都不导出 */
function parseKeys(form, name) {
  if (!form || !form.has(name)) return null;
  const s = (form.get(name) || '').trim();
  return new Set(s ? s.split(',').map((x) => x.trim()).filter(Boolean) : []);
}

/* 过滤:专辑/日期区间 + 逐个条目导出勾选(incSet 为 null 则全选) */
function filterEntries(list, album, from, to, incSet) {
  return list
    .filter((e) => {
      if (album && e.album !== album) return false;
      if (from && to && (e.date < from || e.date > to)) return false;
      if (incSet) return incSet.has(`${e.date}|${e.ts}`);
      return true;
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.ts || 0) - (b.ts || 0)));
}

function normEntry(e) {
  let location = null;
  try { location = e.location ? JSON.parse(e.location) : null; } catch { location = null; }
  let photos = [];
  try { photos = JSON.parse(e.photos || '[]'); } catch { photos = []; }
  return {
    date: e.date || '',
    title: e.title || '',
    text: e.text || '',
    album: e.album || null,
    author: e.author || null,
    location,
    ts: e.ts ?? null,
    photos,
    visibility: e.visibility || 'public',
    created_at: e.created_at || null,
  };
}

/* 按条件冻结最新数据(创建与更新共用;incSet/incTodoSet=null 表示全选) */
async function freeze(env, cond) {
  const { results: entryRows } = await env.DB.prepare('SELECT * FROM entries').all();
  const entries = filterEntries((entryRows || []).map(normEntry), cond.album, cond.from, cond.to, cond.incSet);

  // 待办仅日期区间模式参与(待办无专辑概念,与导出页一致)
  let todos = [];
  if (cond.from && cond.to) {
    const { results: todoRows } = await env.DB
      .prepare('SELECT id, date, text, done, sort_order, checkin_ts FROM todos ORDER BY date ASC, sort_order ASC, id ASC')
      .all();
    todos = (todoRows || [])
      .filter((t) => t.date >= cond.from && t.date <= cond.to && (cond.incTodoSet ? cond.incTodoSet.has(`${t.date}|${t.sort_order}|${t.id}`) : true))
      .map((t) => ({ id: t.id, date: t.date, text: t.text, done: t.done, checkin_ts: t.checkin_ts }));
  }
  return { entries, todos };
}

export async function onRequestPost(context) {
  const user = await verifySession(context.env, context.request);
  if (!user) return Response.json({ error: '请先登录' }, { status: 401 });

  const url = new URL(context.request.url);
  const qToken = (url.searchParams.get('token') || '').trim();
  let form = null;
  try { form = await context.request.formData(); } catch { /* 空 body:query 带 token 的更新无需表单 */ }
  const token = qToken || (form ? (form.get('token') || '').trim() : '');
  if (!form && !token) return Response.json({ error: '缺少表单数据' }, { status: 400 });

  // 逐个条目导出选择:字段缺席=全选,空串=一个都不导出
  const album = (form ? (form.get('album') || '').trim() : '');
  const from = (form ? (form.get('from') || '').trim() : '');
  const to = (form ? (form.get('to') || '').trim() : '');
  const incSet = parseKeys(form, 'inc');
  const incTodoSet = parseKeys(form, 'inc_todo');

  const fromOk = DATE_RE.test(from);
  const toOk = DATE_RE.test(to);
  const rangeOk = fromOk && toOk && from <= to;
  const condValid = (album || rangeOk) && (!(from || to) || rangeOk);

  if (token) {
    // ---- 更新:重新进「生成分享页」选择内容后保存(链接不变) ----
    const raw = await context.env.ENTRIES.get(`share:${token}`);
    if (!raw) return Response.json({ error: '快照不存在或已删除' }, { status: 404 });
    let snap;
    try { snap = JSON.parse(raw); } catch { return Response.json({ error: '快照数据损坏' }, { status: 500 }); }
    // 表单带选择(新客户端)→ 用表单条件;否则(旧客户端空 body)→ 沿用快照条件全量导出
    const explicit = form && (form.has('inc') || form.has('inc_todo') || album || from || to);
    const cond = explicit
      ? { album: album || null, from: rangeOk ? from : null, to: rangeOk ? to : null, incSet, incTodoSet }
      : { album: snap.album || null, from: snap.from || null, to: snap.to || null, incSet: null, incTodoSet: null };
    if (!cond.album && !(cond.from && cond.to)) {
      return Response.json({ error: '请选择专辑,或选择起止日期(可都选叠加)' }, { status: 400 });
    }
    const { entries, todos } = await freeze(context.env, cond);
    snap.entries = entries;
    snap.todos = todos;
    snap.album = cond.album;
    snap.from = cond.from;
    snap.to = cond.to;
    snap.updated_at = new Date().toISOString();
    const shareUrl = await persistSnapshot(context.env, snap, token);
    return Response.json({ ok: true, token: snap.token, url: shareUrl, created_at: snap.created_at, updated_at: snap.updated_at, updated: true });
  }

  // ---- 创建 ----
  if (!condValid) {
    if (!from && !to) return Response.json({ error: '请选择专辑,或选择起止日期(可都选叠加)' }, { status: 400 });
    return Response.json({ error: '起始/结束日期需成对且起始不晚于结束' }, { status: 400 });
  }
  if (rangeOk) {
    const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
    if (days > MAX_RANGE_DAYS) return Response.json({ error: '区间最多 60 天' }, { status: 400 });
  }

  const cond = { album: album || null, from: rangeOk ? from : null, to: rangeOk ? to : null, incSet, incTodoSet };
  const { entries, todos } = await freeze(context.env, cond);
  const now = new Date().toISOString();
  const newToken = genToken();
  const snap = { token: newToken, album: cond.album, from: cond.from, to: cond.to, entries, todos, created_at: now, updated_at: now };
  const shareUrl = await persistSnapshot(context.env, snap, newToken);
  return Response.json({ ok: true, token: newToken, url: shareUrl, created_at: now, updated_at: now, entries: entries.length, todos: todos.length });
}

// 读取快照(供「更新」进生成页预填):返回条件 + 冻结内容
export async function onRequestGet(context) {
  const user = await verifySession(context.env, context.request);
  if (!user) return Response.json({ error: '请先登录' }, { status: 401 });

  const token = (new URL(context.request.url).searchParams.get('token') || '').trim();
  if (!/^[a-z0-9]{8}$/.test(token)) return Response.json({ error: '缺少 token' }, { status: 400 });

  const raw = await context.env.ENTRIES.get(`share:${token}`);
  if (!raw) return Response.json({ error: '快照不存在或已删除' }, { status: 404 });
  let snap;
  try { snap = JSON.parse(raw); } catch { return Response.json({ error: '快照数据损坏' }, { status: 500 }); }
  return Response.json({
    token: snap.token,
    album: snap.album || null,
    from: snap.from || null,
    to: snap.to || null,
    entries: snap.entries || [],
    todos: snap.todos || [],
    created_at: snap.created_at || null,
    updated_at: snap.updated_at || null,
    url: snap.url || `/s/${snap.token}`,
  });
}

export async function onRequestDelete(context) {
  const user = await verifySession(context.env, context.request);
  if (!user) return Response.json({ error: '请先登录' }, { status: 401 });

  const url = new URL(context.request.url);
  const token = (url.searchParams.get('token') || '').trim();
  if (!/^[a-z0-9]{8}$/.test(token)) return Response.json({ error: '缺少 token' }, { status: 400 });

  const raw = await context.env.ENTRIES.get(`share:${token}`);
  if (!raw) return Response.json({ error: '快照不存在或已删除' }, { status: 404 });
  await context.env.ENTRIES.delete(`share:${token}`);
  await ghDeletePage(context.env, token);
  return Response.json({ ok: true });
}
