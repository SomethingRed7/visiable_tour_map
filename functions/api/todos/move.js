// 待办排序:POST /api/todos/move(multipart)
// 字段:id(必填,被移动的待办), before_id(可选,移到该待办之前;缺省/不存在 → 移到当天末尾)
// 仅在同一天内重排 sort_order(0..n-1);需登录
import { verifySession } from '../../_lib/auth.js';

export async function onRequestPost(context) {
  const user = await verifySession(context.env, context.request);
  if (!user) return Response.json({ error: '请先登录' }, { status: 401 });

  const form = await context.request.formData();
  const id = Number(form.get('id'));
  const beforeRaw = form.get('before_id');
  const beforeId = beforeRaw ? Number(beforeRaw) : null;
  if (!Number.isInteger(id) || id <= 0) return Response.json({ error: 'id 不对' }, { status: 400 });
  if (beforeId != null && (!Number.isInteger(beforeId) || beforeId <= 0)) {
    return Response.json({ error: 'before_id 不对' }, { status: 400 });
  }

  const row = await context.env.DB.prepare('SELECT id, date FROM todos WHERE id = ?1').bind(id).first();
  if (!row) return Response.json({ error: '待办不存在' }, { status: 404 });

  const { results } = await context.env.DB
    .prepare('SELECT id FROM todos WHERE date = ?1 ORDER BY sort_order ASC, id ASC')
    .bind(row.date).all();
  const ids = results.map((r) => r.id);
  const from = ids.indexOf(id);
  if (from === -1) return Response.json({ error: '待办不存在' }, { status: 404 });
  ids.splice(from, 1);
  let to = ids.length; // 默认移到末尾
  if (beforeId != null && ids.includes(beforeId)) to = ids.indexOf(beforeId);
  ids.splice(to, 0, id);

  const stmt = context.env.DB.prepare('UPDATE todos SET sort_order = ?1 WHERE id = ?2');
  for (let i = 0; i < ids.length; i++) await stmt.bind(i, ids[i]).run();

  return Response.json({ ok: true, order: ids });
}
