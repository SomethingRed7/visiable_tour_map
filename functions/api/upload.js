// 上传 API:POST /api/upload(multipart)
// 字段:pass(口令), date, title, text, album, author, location, photo_full[] / photo_thumb[]
// 照片 → R2 photos/<date>/<ts>-<n>.jpg(+ -thumb),条目 → KV entry:<date>:<ts>
// 地点 → 服务端 Nominatim 地理编码(CF 边缘发起),失败仅存地名不存坐标
export async function onRequestPost(context) {
  const form = await context.request.formData();
  const pass = (form.get('pass') || '').trim();
  const date = (form.get('date') || '').trim();
  const title = (form.get('title') || '').trim();
  const text = (form.get('text') || '').trim();
  const album = (form.get('album') || '').trim() || null;
  const author = (form.get('author') || '').trim() || '球';
  const locationName = (form.get('location') || '').trim() || null;

  // 口令校验:环境变量未配置则放行(本地 dev 便于调试),配置了必须匹配
  if (context.env.UPLOAD_PASS && pass !== context.env.UPLOAD_PASS) {
    return Response.json({ error: '口令不对' }, { status: 401 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: '日期格式不对,应为 YYYY-MM-DD' }, { status: 400 });
  }

  const fulls = form.getAll('photo_full').filter((f) => typeof f !== 'string');
  const thumbs = form.getAll('photo_thumb').filter((f) => typeof f !== 'string');
  if (!title && !text && fulls.length === 0) {
    return Response.json({ error: '内容为空:至少填标题/文字/照片之一' }, { status: 400 });
  }

  // 地点地理编码(失败不阻断上传)
  let location = null;
  if (locationName) {
    try {
      const q = encodeURIComponent(locationName);
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=zh-CN&q=${q}`, {
        headers: { 'User-Agent': 'gugugaga-travel-diary/1.0 (personal use)' },
      });
      if (res.ok) {
        const arr = await res.json();
        if (arr.length > 0) {
          location = {
            name: locationName,
            lat: parseFloat(arr[0].lat),
            lng: parseFloat(arr[0].lon),
            display: (arr[0].display_name || locationName).slice(0, 80),
          };
        }
      }
    } catch {
      // 地理编码不可用 → 仅存地名
    }
    if (!location) location = { name: locationName, lat: null, lng: null, display: locationName };
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

  const entry = {
    date, title, text, album, author, location,
    photos: photoPaths,
    created_at: new Date().toISOString(),
  };
  await context.env.ENTRIES.put(`entry:${date}:${ts}`, JSON.stringify(entry));
  return Response.json({ ok: true, entry });
}
