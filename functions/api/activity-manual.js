// 「当日运动」的手动条目（COROS 同步之外的补充）。
//   GET    /api/activity-manual?days=30   公开只读
//   POST   /api/activity-manual           multipart 新增 / 带 id 时修改（需登录）
//   DELETE /api/activity-manual?id=123    删除（需登录）
//
// 和 /api/activity 的区别：那边是 COROS 同步来的（只读、按天整份覆盖），
// 这边是手写的（今天骑车 40 分钟这种 COROS 没记到的）。
import { verifySession, rateLimitUpload } from '../_lib/auth.js';

const LIMITS = { name: 30 };
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

let ensured = false;
async function ensureTable(env) {
  if (!ensured) {
    await env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS activity_manual (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         date TEXT NOT NULL,
         ts INTEGER NOT NULL,
         name TEXT NOT NULL,
         icon TEXT,
         dur INTEGER,
         dist REAL,
         override_key TEXT,
         author_name TEXT,
         created_at TEXT NOT NULL
       )`
    ).run();
    await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_am_date ON activity_manual(date)').run();
    // 老版本建的表没有这列，补上（SQLite 不支持 IF NOT EXISTS 加列，失败就算了）
    try { await env.DB.prepare('ALTER TABLE activity_manual ADD COLUMN override_key TEXT').run(); } catch { /* 已存在 */ }
    ensured = true;
  }
}

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  let days = parseInt(url.searchParams.get('days') || '30', 10);
  if (!Number.isFinite(days)) days = 30;
  days = Math.min(365, Math.max(1, days));

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const since = cutoff.toISOString().slice(0, 10);

  let rows = [];
  try {
    const r = await context.env.DB
      .prepare('SELECT * FROM activity_manual WHERE date >= ?1 ORDER BY date DESC, ts DESC')
      .bind(since).all();
    rows = r.results || [];
  } catch { rows = []; }

  return json({
    items: rows.map((r) => ({
      id: r.id,
      date: r.date,
      ts: r.ts,
      name: r.name,
      icon: r.icon || '🏃',
      dur: Number(r.dur) || 0,       // 秒
      dist: Number(r.dist) || 0,     // 公里
      override_key: r.override_key || '',
      author_name: r.author_name || '',
      manual: true,
    })),
  });
}

export async function onRequestPost(context) {
  const user = await verifySession(context.env, context.request);
  if (!user) return json({ error: '请先登录' }, 401);

  const rl = await rateLimitUpload(context.env, user);
  if (!rl.allowed) return json({ error: '写下太频繁了，休息一会儿再试' }, 429);

  let form;
  try { form = await context.request.formData(); } catch { return json({ error: '请求格式不对' }, 400); }

  const date = String(form.get('date') || '').slice(0, 10);
  if (!DATE_RE.test(date)) return json({ error: '日期格式不对' }, 400);

  const name = String(form.get('name') || '').trim().slice(0, LIMITS.name);
  if (!name) return json({ error: '运动名称不能为空' }, 400);

  const icon = String(form.get('icon') || '🏃').slice(0, 8);
  // dur 传分钟，存秒（前端展示统一用 分:秒）
  const minutes = Math.max(0, Math.min(1440, parseInt(form.get('minutes') || '0', 10) || 0));
  // 前端填的是公里，统一存成米 —— 和 COROS 同步来的 dist 同单位，
  // 否则 itemRow 里的 km() 会再除一次 1000（显示 0.005 km 那种）
  const distKm = Math.max(0, Math.min(1000, parseFloat(form.get('dist') || '0') || 0));
  const dist = Math.round(distKm * 1000);
  const editId = parseInt(form.get('id') || '0', 10) || 0;
  const overrideKey = String(form.get('override_key') || '').slice(0, 60);

  await ensureTable(context.env);

  if (editId) {
    const row = await context.env.DB
      .prepare('SELECT id FROM activity_manual WHERE id = ?1').bind(editId).first();
    if (!row) return json({ error: '这条记录不存在了' }, 404);
    await context.env.DB.prepare(
      `UPDATE activity_manual SET name = ?2, icon = ?3, dur = ?4, dist = ?5, ts = ?6, override_key = ?7 WHERE id = ?1`
    ).bind(editId, name, icon, minutes * 60, dist, Date.now(), overrideKey || null).run();
    return json({ ok: true, updated: true });
  }

  await context.env.DB.prepare(
    `INSERT INTO activity_manual (date, ts, name, icon, dur, dist, override_key, author_name, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
  ).bind(
    date, Date.now(), name, icon, minutes * 60, dist, overrideKey || null,
    String(user || '').slice(0, 40), new Date().toISOString()
  ).run();

  return json({ ok: true, date });
}

export async function onRequestDelete(context) {
  const user = await verifySession(context.env, context.request);
  if (!user) return json({ error: '请先登录' }, 401);

  const id = parseInt(new URL(context.request.url).searchParams.get('id') || '', 10);
  if (!Number.isFinite(id)) return json({ error: '缺少 id' }, 400);

  await context.env.DB.prepare('DELETE FROM activity_manual WHERE id = ?1').bind(id).run();
  return json({ ok: true });
}
