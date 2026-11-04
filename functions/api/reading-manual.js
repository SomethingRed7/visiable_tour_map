// 「当日在读」的手动条目（微信读书同步之外的补充记录）。
//   GET    /api/reading-manual?days=30   公开只读，按日期倒序
//   POST   /api/reading-manual           multipart 新增（需登录）
//   DELETE /api/reading-manual?id=123    删除（需登录）
//
// 和 /api/reading 的区别：那边是播报脚本推的「微信读书每日总结」，只读、整份覆盖；
// 这边是用户手写的（书名/时长/简评/摘要/图片），独立成表，允许并存和删除。
import { verifySession, rateLimitUpload } from '../_lib/auth.js';
import { storePhotos } from '../_lib/entries.js';
import { MAX_FILE_BYTES } from '../_lib/images.js';

const MAX_PHOTOS = 4;
const LIMITS = { title: 100, author: 50, note: 200, summary: 2000 };

let ensured = false;
async function ensureTable(env) {
  if (ensured) return;
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS reading_manual (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       date TEXT NOT NULL,
       ts INTEGER NOT NULL,
       title TEXT NOT NULL,
       author TEXT,
       minutes INTEGER,
       note TEXT,
       summary TEXT,
       photos TEXT,
       author_name TEXT,
       created_at TEXT NOT NULL
     )`
  ).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_rm_date ON reading_manual(date)').run();
  ensured = true;
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
      .prepare('SELECT * FROM reading_manual WHERE date >= ?1 ORDER BY date DESC, ts DESC')
      .bind(since)
      .all();
    rows = r.results || [];
  } catch {
    rows = [];   // 表还没建：当作暂无
  }

  const items = rows.map((r) => ({
    id: r.id,
    date: r.date,
    ts: r.ts,
    title: r.title,
    author: r.author || '',
    minutes: Number(r.minutes) || 0,
    summary: r.summary || '',
    photos: safeParse(r.photos),
    author_name: r.author_name || '',
    created_at: r.created_at,
  }));
  return json({ items });
}

function safeParse(v) {
  try { return JSON.parse(v || '[]'); } catch { return []; }
}

export async function onRequestPost(context) {
  const user = await verifySession(context.env, context.request);
  if (!user) return json({ error: '请先登录' }, 401);

  const rl = await rateLimitUpload(context.env, user);
  if (!rl.allowed) return json({ error: '写入太频繁了，休息一会儿再试' }, 429);

  let form;
  try {
    form = await context.request.formData();
  } catch {
    return json({ error: '请求格式不对' }, 400);
  }

  const date = String(form.get('date') || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json({ error: '日期格式不对' }, 400);

  const title = String(form.get('title') || '').trim().slice(0, LIMITS.title);
  if (!title) return json({ error: '书名不能为空' }, 400);

  const minutes = Math.max(0, Math.min(1440, parseInt(form.get('minutes') || '0', 10) || 0));
  const author = String(form.get('author') || '').trim().slice(0, LIMITS.author);
  const summary = String(form.get('summary') || '').trim().slice(0, LIMITS.summary);
  const editId = parseInt(form.get('id') || '0', 10) || 0;

  // 图片：最多 4 张，逐张校验大小
  const files = form.getAll('photos').filter((f) => f && typeof f !== 'string');
  if (files.length > MAX_PHOTOS) return json({ error: `一次最多 ${MAX_PHOTOS} 张图片` }, 400);
  for (const f of files) {
    if (f.size > MAX_FILE_BYTES) return json({ error: '有图片超过 10MB' }, 400);
    if (!/^image\//.test(f.type || '')) return json({ error: '只能上传图片' }, 400);
  }

  await ensureTable(context.env);

  const ts = Date.now();
  let photoPaths = [];

  // 编辑：没传新图就保留原来的，别把旧图删掉
  if (editId) {
    try {
      const row = await context.env.DB
        .prepare('SELECT photos FROM reading_manual WHERE id = ?1').bind(editId).first();
      if (!row) return json({ error: '这条记录不存在了' }, 404);
      photoPaths = safeParse(row.photos);
    } catch {
      return json({ error: '读取原记录失败' }, 500);
    }
  }

  if (files.length) {
    try {
      // 复用日记那套 R2 存储：key 用 <date>/<ts>-<n>.jpg，返回 /photos/... 显示路径
      photoPaths = await storePhotos(context.env, date, ts, files, files.map(() => null));
    } catch {
      return json({ error: '图片保存失败，换个网络再试' }, 502);
    }
  }

  if (editId) {
    await context.env.DB.prepare(
      `UPDATE reading_manual
          SET title = ?2, author = ?3, minutes = ?4, summary = ?5, photos = ?6, ts = ?7
        WHERE id = ?1`
    ).bind(editId, title, author, minutes, summary, JSON.stringify(photoPaths), ts).run();
    return json({ ok: true, date, photos: photoPaths, updated: true });
  }

  await context.env.DB.prepare(
    `INSERT INTO reading_manual (date, ts, title, author, minutes, summary, photos, author_name, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`
  ).bind(
    date, ts, title, author, minutes, summary,
    JSON.stringify(photoPaths), String(user.name || '').slice(0, 40),
    new Date().toISOString()
  ).run();

  return json({ ok: true, date, photos: photoPaths });
}

export async function onRequestDelete(context) {
  const user = await verifySession(context.env, context.request);
  if (!user) return json({ error: '请先登录' }, 401);

  const id = parseInt(new URL(context.request.url).searchParams.get('id') || '', 10);
  if (!Number.isFinite(id)) return json({ error: '缺少 id' }, 400);

  await context.env.DB.prepare('DELETE FROM reading_manual WHERE id = ?1').bind(id).run();
  return json({ ok: true });
}
