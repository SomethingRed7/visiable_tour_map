// 编辑待办内容:POST /api/todos/update(multipart)
// 字段:id(必填), text(≤200)
// 需登录;改文本不影响 checkin_ts 与已完成状态;若该待办已打卡(checkin_ts 非空),
// 联动更新对应打卡条目标题(「打卡:旧标题」→「打卡:新标题」),保持匹配
import { verifySession } from '../../_lib/auth.js';

export async function onRequestPost(context) {
  const user = await verifySession(context.env, context.request);
  if (!user) return Response.json({ error: '请先登录' }, { status: 401 });

  const form = await context.request.formData();
  const id = Number(form.get('id'));
  const text = (form.get('text') || '').trim();
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: 'id 不对' }, { status: 400 });
  if (!text || text.length > 200) return Response.json({ error: '待办内容不能为空且不超过 200 字' }, { status: 400 });

  const old = await context.env.DB
    .prepare('SELECT id, date, text, done, sort_order, checkin_ts FROM todos WHERE id = ?1')
    .bind(id).first();
  if (!old) return Response.json({ error: '待办不存在' }, { status: 404 });

  // 已打卡 → 联动更新打卡条目标题(「打卡:旧文本」→「打卡:新文本」)
  // 按 date+ts 定位(不匹配 title——用户可能改过打卡标题,title 条件会漏更新)
  if (old.done === 1 && old.checkin_ts) {
    await context.env.DB
      .prepare("UPDATE entries SET title = ?1 WHERE date = ?2 AND ts = ?3 AND title LIKE '打卡:%'")
      .bind(`打卡:${text}`, old.date, old.checkin_ts)
      .run();
  }

  const todo = await context.env.DB
    .prepare('UPDATE todos SET text = ?1 WHERE id = ?2 RETURNING id, date, text, done, sort_order, checkin_ts')
    .bind(text, id).first();
  if (!todo) return Response.json({ error: '待办不存在' }, { status: 404 });
  return Response.json({ ok: true, todo });
}
