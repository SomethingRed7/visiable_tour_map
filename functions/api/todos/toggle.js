// 勾选/取消打卡:POST /api/todos/toggle(id) → 翻转 done(幂等)
// 需登录会话,未登录 401
import { verifySession } from '../../_lib/auth.js';

export async function onRequestPost(context) {
  const user = await verifySession(context.env, context.request);
  if (!user) return Response.json({ error: '请先登录' }, { status: 401 });

  const form = await context.request.formData();
  const id = Number(form.get('id'));
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: 'id 不对' }, { status: 400 });

  const row = await context.env.DB.prepare('SELECT id FROM todos WHERE id = ?1').bind(id).first();
  if (!row) return Response.json({ error: '待办不存在' }, { status: 404 });

  await context.env.DB.prepare('UPDATE todos SET done = 1 - done WHERE id = ?1').bind(id).run();
  const todo = await context.env.DB
    .prepare('SELECT id, date, text, done, sort_order FROM todos WHERE id = ?1')
    .bind(id).first();
  return Response.json({ ok: true, todo });
}
