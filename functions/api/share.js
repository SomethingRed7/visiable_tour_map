// 行程分享快照 API:
//   POST   /api/share            → 创建快照(冻结内容入 KV + 写成 github.io 静态页 share/<token>.html)
//   POST   /api/share?token=xxx  → 更新快照(按快照记忆的生成条件用最新数据重新冻结,链接不变)
//   DELETE /api/share?token=xxx  → 删除快照(KV + github.io 静态页)
// 快照 key = `share:<8位随机码>`,value = { token, album, from, to, ck, entries, todos, created_at, updated_at, url }
// 照片仅存路径引用(不复制);冻结语义与导出页一致(私有勾选=快照含私有,生成者决定)。
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
  const html = buildSnapshotHtml(snap, { cspMeta: true });
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

/* 与导出页 filteredEntries 同款过滤:公开 / 私有(非打卡)/ 打卡(私有子集,需私有+打卡都勾) */
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

/* 按条件冻结最新数据(创建与更新共用;更新用快照里记忆的旧条件) */
async function freeze(env, cond) {
  const { results: entryRows } = await env.DB.prepare('SELECT * FROM entries').all();
  const entries = filterEntries((entryRows || []).map(normEntry), cond.album, cond.from, cond.to, cond.ck);

  // 待办仅日期区间模式参与(待办无专辑概念,与导出页一致)
  let todos = [];
  if (cond.from && cond.to && cond.ck.todo) {
    const { results: todoRows } = await env.DB
      .prepare('SELECT id, date, text, done, sort_order, checkin_ts FROM todos ORDER BY date ASC, sort_order ASC, id ASC')
      .all();
    todos = (todoRows || [])
      .filter((t) => t.date >= cond.from && t.date <= cond.to)
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

  // 勾选:checkbox 缺席 = 与生成器页默认一致(全勾)
  const chk = (n) => {
    const v = form.get(n);
    if (v === null) return true;
    return v !== '' && v !== '0' && v !== 'false';
  };

  if (token) {
    // ---- 更新:按快照记忆的生成条件重新冻结(链接不变) ----
    const raw = await context.env.ENTRIES.get(`share:${token}`);
    if (!raw) return Response.json({ error: '快照不存在或已删除' }, { status: 404 });
    let snap;
    try { snap = JSON.parse(raw); } catch { return Response.json({ error: '快照数据损坏' }, { status: 500 }); }
    const { entries, todos } = await freeze(context.env, snap);
    snap.entries = entries;
    snap.todos = todos;
    snap.updated_at = new Date().toISOString();
    const url = await persistSnapshot(context.env, snap, token);
    return Response.json({ ok: true, token: snap.token, url, created_at: snap.created_at, updated_at: snap.updated_at, updated: true });
  }

  // ---- 创建 ----
  const album = (form.get('album') || '').trim();
  const from = (form.get('from') || '').trim();
  const to = (form.get('to') || '').trim();

  const fromOk = DATE_RE.test(from);
  const toOk = DATE_RE.test(to);
  const rangeOk = fromOk && toOk && from <= to;
  if (!album && !rangeOk) {
    return Response.json({ error: '请选择专辑,或选择起止日期(可都选叠加)' }, { status: 400 });
  }
  if ((from || to) && !rangeOk) {
    return Response.json({ error: '起始/结束日期需成对且起始不晚于结束' }, { status: 400 });
  }
  if (rangeOk) {
    const days = Math.round((new Date(to) - new Date(from)) / 86400000) + 1;
    if (days > MAX_RANGE_DAYS) return Response.json({ error: '区间最多 60 天' }, { status: 400 });
  }

  const cond = {
    album: album || null,
    from: rangeOk ? from : null,
    to: rangeOk ? to : null,
    ck: { public: chk('ck_public'), private: chk('ck_private'), todo: chk('ck_todo'), checkin: chk('ck_checkin') },
  };
  const { entries, todos } = await freeze(context.env, cond);
  const now = new Date().toISOString();
  const newToken = genToken();
  const snap = { token: newToken, album: cond.album, from: cond.from, to: cond.to, ck: cond.ck, entries, todos, created_at: now, updated_at: now };
  const url = await persistSnapshot(context.env, snap, newToken);
  return Response.json({ ok: true, token: newToken, url, created_at: now, updated_at: now, entries: entries.length, todos: todos.length });
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
