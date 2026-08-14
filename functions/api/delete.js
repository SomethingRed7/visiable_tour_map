// 删除 API:POST /api/delete(multipart)
// 字段:date, ts(条目主键的一部分)
// 权限:需登录会话;删除 D1 条目 + R2 照片(大图+缩略图)
import { verifySession } from '../_lib/auth.js';
import { deleteEntryWithPhotos } from '../_lib/entries.js';

export async function onRequestPost(context) {
  const user = await verifySession(context.env, context.request);
  if (!user) return Response.json({ error: '请先登录' }, { status: 401 });

  const form = await context.request.formData();
  const date = (form.get('date') || '').trim();
  const ts = (form.get('ts') || '').trim();

  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date) || !/^[0-9]{13}$/.test(ts)) {
    return Response.json({ error: '参数不对' }, { status: 400 });
  }

  const deleted = await deleteEntryWithPhotos(context.env, date, Number(ts));
  if (!deleted) return Response.json({ error: '条目不存在' }, { status: 404 });
  return Response.json({ ok: true });
}
