// 删除 API:POST /api/delete(multipart)
// 字段:pin(删除口令), date, ts(条目键 entry:<date>:<ts>)
// 校验 DELETE_PASS;删除 KV 条目 + R2 照片(大图+缩略图)
export async function onRequestPost(context) {
  const form = await context.request.formData();
  const pin = (form.get('pin') || '').trim();
  const date = (form.get('date') || '').trim();
  const ts = (form.get('ts') || '').trim();

  if (context.env.DELETE_PASS && pin !== context.env.DELETE_PASS) {
    return Response.json({ error: '删除口令不对' }, { status: 401 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{13}$/.test(ts)) {
    return Response.json({ error: '参数不对' }, { status: 400 });
  }

  const key = `entry:${date}:${ts}`;
  const raw = await context.env.ENTRIES.get(key);
  if (!raw) return Response.json({ error: '条目不存在' }, { status: 404 });

  const entry = JSON.parse(raw);
  for (const p of entry.photos || []) {
    const k = p.replace(/^\/photos\//, '');
    if (!k) continue;
    await context.env.PHOTOS.delete(k);
    await context.env.PHOTOS.delete(k.replace(/\.(jpg|jpeg|png)$/i, '-thumb.$1'));
  }
  await context.env.ENTRIES.delete(key);
  return Response.json({ ok: true });
}
