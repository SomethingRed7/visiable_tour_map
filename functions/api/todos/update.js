// 编辑待办内容:POST /api/todos/update(multipart)
// 字段:id(必填), text(≤200)
// 需登录;改文本不影响 checkin_ts 与已完成状态(打卡条目标题是勾选时生成的快照,不回改)
import { verifySession } from '../../_lib/auth.js';

export async function onRequestPost(context) {
  const user = await verifySession(context.env, context.request);
  if (!user) return Response.json({ error: '请先登录' }, { status: 401 });

  const form = await context.request.formData();
  const id = Number(form.get('id'));
  const text = (form.get('text') || '').trim();
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: 'id 不对' }, { status: 400 });
  if (!text || text.length > 200) return Response.json({ error: '待办内容不能为空且不超过 200 字' }, { status: 400 });

  const todo = await context.env.DB
    .prepare('UPDATE todos SET text = ?1 WHERE id = ?2 RETURNING id, date, text, done, sort_order, checkin_ts')
    .bind(text, id).first();
  if (!todo) return Response.json({ error: '待办不存在' }, { status: 404 });
  return Response.json({ ok: true, todo });
}
