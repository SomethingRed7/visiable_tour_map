// 上传 API:POST /api/upload(multipart)
// 字段:date, title, text, album, photo_full[] / photo_thumb[](前端已压缩,成对提交)
// 照片 → R2 photos/<date>/<ts>-<n>.jpg(+ -thumb),条目 → KV entry:<date>:<ts>
export async function onRequestPost(context) {
  const form = await context.request.formData();
  const date = (form.get('date') || '').trim();
  const title = (form.get('title') || '').trim();
  const text = (form.get('text') || '').trim();
  const album = (form.get('album') || '').trim() || null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: '日期格式不对,应为 YYYY-MM-DD' }, { status: 400 });
  }

  const fulls = form.getAll('photo_full').filter((f) => typeof f !== 'string');
  const thumbs = form.getAll('photo_thumb').filter((f) => typeof f !== 'string');
  if (!title && !text && fulls.length === 0) {
    return Response.json({ error: '内容为空:至少填标题/文字/照片之一' }, { status: 400 });
  }

  const ts = Date.now();
  const photoPaths = [];
  for (let i = 0; i < fulls.length; i++) {
    // R2 key 不带 photos/ 前缀;条目里的显示路径带 /photos/ 前缀
    const base = `${date}/${ts}-${i}`;
    await context.env.PHOTOS.put(`${base}.jpg`, fulls[i].stream(), {
      httpMetadata: { contentType: 'image/jpeg' },
    });
    if (thumbs[i]) {
      await context.env.PHOTOS.put(`${base}-thumb.jpg`, thumbs[i].stream(), {
        httpMetadata: { contentType: 'image/jpeg' },
      });
    }
    photoPaths.push(`/photos/${base}.jpg`);
  }

  const entry = { date, title, text, album, photos: photoPaths, created_at: new Date().toISOString() };
  await context.env.ENTRIES.put(`entry:${date}:${ts}`, JSON.stringify(entry));
  return Response.json({ ok: true, entry });
}
