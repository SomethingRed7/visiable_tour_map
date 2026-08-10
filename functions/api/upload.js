// 上传 API:POST /api/upload(multipart)
// 字段:date, title, text, album, author, location, lat, lng, photo_full[] / photo_thumb[]
// 无口令(上传靠隐秘 URL 保护);删除才需口令(见 /api/delete)
// 照片 → R2 photos/<date>/<ts>-<n>.jpg(+ -thumb),条目 → D1(强一致)
// 防重复:同一天同照片内容(SHA-256)拒绝;地点已带坐标则直存,否则服务端 Nominatim 编码
export async function onRequestPost(context) {
  const form = await context.request.formData();
  const date = (form.get('date') || '').trim();
  const title = (form.get('title') || '').trim();
  const text = (form.get('text') || '').trim();
  const album = (form.get('album') || '').trim() || null;
  const author = (form.get('author') || '').trim() || '球';
  const locationName = (form.get('location') || '').trim() || null;
  const latRaw = parseFloat(form.get('lat'));
  const lngRaw = parseFloat(form.get('lng'));

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Response.json({ error: '日期格式不对,应为 YYYY-MM-DD' }, { status: 400 });
  }

  const fulls = form.getAll('photo_full').filter((f) => typeof f !== 'string');
  const thumbs = form.getAll('photo_thumb').filter((f) => typeof f !== 'string');
  if (!title && !text && fulls.length === 0) {
    return Response.json({ error: '内容为空:至少填标题/文字/照片之一' }, { status: 400 });
  }

  // 照片内容哈希:同一天去重(D1 强一致查询)
  const photoHashes = [];
  if (fulls.length > 0) {
    const existingHashes = new Set();
    try {
      const rows = await context.env.DB.prepare('SELECT photo_hashes FROM entries WHERE date = ?1')
        .bind(date)
        .all();
      for (const r of rows.results || []) {
        for (const h of JSON.parse(r.photo_hashes || '[]')) existingHashes.add(h);
      }
    } catch { /* DB 不可用则跳过去重 */ }
    for (const f of fulls) {
      const buf = await f.arrayBuffer();
      const digest = await crypto.subtle.digest('SHA-256', buf);
      const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
      if (existingHashes.has(hash)) {
        return Response.json({ error: '这张照片今天已经传过啦,换一张或去掉重复' }, { status: 400 });
      }
      photoHashes.push(hash);
    }
  }

  // 地点:已有坐标直存;否则地名 geocode(失败仅存地名)
  let location = null;
  if (locationName) {
    if (Number.isFinite(latRaw) && Number.isFinite(lngRaw)) {
      location = { name: locationName, lat: latRaw, lng: lngRaw, display: locationName };
    } else {
      try {
        const q = encodeURIComponent(locationName);
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=zh-CN&q=${q}`, {
          headers: { 'User-Agent': 'gugugaga-travel-diary/1.0 (personal use)' },
          signal: AbortSignal.timeout(8000),
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
      } catch { /* 忽略 */ }
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
    ts,
    photos: photoPaths,
    photo_hashes: photoHashes,
    created_at: new Date().toISOString(),
  };
  await context.env.DB.prepare(
    'INSERT OR REPLACE INTO entries (date, ts, title, text, album, author, location, photos, photo_hashes, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)'
  )
    .bind(date, ts, title, text, album, author, JSON.stringify(location), JSON.stringify(photoPaths), JSON.stringify(photoHashes), entry.created_at)
    .run();
  return Response.json({ ok: true, entry });
}
