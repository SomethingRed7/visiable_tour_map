// 照片访问:GET /photos/<key>(R2 直出,长缓存)
export async function onRequestGet(context) {
  const key = context.params.path.join('/');
  if (!key) return new Response('missing key', { status: 400 });
  const obj = await context.env.PHOTOS.get(key);
  if (!obj) return new Response('not found', { status: 404 });
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType || 'image/jpeg',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
