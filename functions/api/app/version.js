// GET /api/app/version —— Android 壳的更新清单
//
// 版本信息来自 data/app-version.json(和 android/app/build.gradle 的 versionCode 一一对应,
// 由 android-app/publish-app.sh 自动同步,不要手改两处)。
// 用 import 而不是放 R2:打包时直接内联进 Worker,零额外请求、零额外权限,
// 代价是发版要重新部署一次(20~40 秒),家庭场景完全可接受。
//
// 返回:{ versionCode, versionName, size, notes, publishedAt, apkUrl }
// versionCode 为 0 时返回 204,客户端视为「没有更新」。
//
// ⚠️ 必须 no-store:客户端每次都要问到最新值,被缓存住更新功能就失效了。
import meta from '../../../data/app-version.json';

export async function onRequestGet() {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  };

  const versionCode = Number(meta.versionCode) || 0;
  if (!versionCode) return new Response(null, { status: 204, headers });

  return new Response(
    JSON.stringify({
      versionCode,
      versionName: String(meta.versionName || ''),
      size: Number(meta.size) || 0,
      notes: String(meta.notes || ''),
      publishedAt: String(meta.publishedAt || ''),
      // 安装包走 Pages 静态托管,不走 R2(省掉一份账号权限,也不用单独管对象存储)
      apkUrl: '/download/gugugaga.apk',
    }),
    { headers }
  );
}
