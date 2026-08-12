// 规划待办 API(私有,全部需登录会话):
//   GET    /api/todos          → 全部待办(按日期/sort 排序)
//   GET    /api/todos?date=    → 当天待办(按 sort_order 升序)
//   POST   /api/todos          → 新增(date+text,sort_order=当天最大+1)
//   DELETE /api/todos?id=      → 删除
// 勾选/取消见 /api/todos/toggle.js
import { verifySession } from '../_lib/auth.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function onRequestGet(context) {
  const user = await verifySession(context.env, context.request);
  if (!user) return Response.json({ error: '请先登录' }, { status: 401 });

  const url = new URL(context.request.url);
  const date = url.searchParams.get('date');
  if (date) {
    if (!DATE_RE.test(date)) return Response.json({ error: '日期格式不对' }, { status: 400 });
    const { results } = await context.env.DB
      .prepare('SELECT id, date, text, done, sort_order FROM todos WHERE date = ?1 ORDER BY sort_order ASC, id ASC')
      .bind(date).all();
    return Response.json({ todos: results });
  }
  const { results } = await context.env.DB
    .prepare('SELECT id, date, text, done, sort_order FROM todos ORDER BY date ASC, sort_order ASC, id ASC')
    .all();
  return Response.json({ todos: results });
}

export async function onRequestPost(context) {
  const user = await verifySession(context.env, context.request);
  if (!user) return Response.json({ error: '请先登录' }, { status: 401 });

  const form = await context.request.formData();
  const date = (form.get('date') || '').trim();
  const text = (form.get('text') || '').trim();
  if (!DATE_RE.test(date)) return Response.json({ error: '日期格式不对' }, { status: 400 });
  if (!text || text.length > 200) return Response.json({ error: '待办内容不能为空且不超过 200 字' }, { status: 400 });

  const row = await context.env.DB
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS mx FROM todos WHERE date = ?1')
    .bind(date).first();
  const sort = (row && row.mx != null ? Number(row.mx) : -1) + 1;
  const todo = await context.env.DB
    .prepare('INSERT INTO todos (date, text, done, sort_order, created_at) VALUES (?1, ?2, 0, ?3, ?4) RETURNING id, date, text, done, sort_order')
    .bind(date, text, sort, new Date().toISOString()).first();
  return Response.json({ ok: true, todo });
}

export async function onRequestDelete(context) {
  const user = await verifySession(context.env, context.request);
  if (!user) return Response.json({ error: '请先登录' }, { status: 401 });

  const url = new URL(context.request.url);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: 'id 不对' }, { status: 400 });
  await context.env.DB.prepare('DELETE FROM todos WHERE id = ?1').bind(id).run();
  return Response.json({ ok: true });
}
