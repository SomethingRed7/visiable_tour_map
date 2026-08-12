// 登录 API:POST /api/login(multipart)
// 两种模式:
//   ① 首次设置:username + code(一次性设置码)+ new_password(≥8 位)→ 校验码、写哈希、自动登录
//   ② 正常登录:username + password → PBKDF2 校验 → 发会话 cookie(90 天)
// 失败限流:同用户名 15 分钟错 5 次锁 15 分钟(密码与设置码共用,见 _lib/auth.js)
import {
  getUsers, hashPassword, verifyPassword, timingSafeEqual,
  sessionCookie, rateLimitCheck, rateLimitFail, rateLimitReset,
  getSetupCode, consumeSetupCode,
} from '../_lib/auth.js';

export async function onRequestPost(context) {
  const form = await context.request.formData();
  const username = (form.get('username') || '').trim();
  const password = form.get('password') || '';
  const code = (form.get('code') || '').trim();
  const newPassword = form.get('new_password') || '';

  if (!getUsers(context.env)[username]) {
    return Response.json({ error: '用户名或密码不对' }, { status: 401 });
  }

  const lock = await rateLimitCheck(context.env, username);
  if (!lock.allowed) {
    return Response.json({ error: '尝试次数过多,请 15 分钟后再试', retry_after: lock.retryAfter }, { status: 429 });
  }

  const secure = new URL(context.request.url).protocol === 'https:';

  // ---- 模式① 首次设置 ----
  if (code || newPassword) {
    if (!code) return Response.json({ error: '缺少一次性设置码' }, { status: 400 });
    if (!newPassword) return Response.json({ error: '请设置新密码' }, { status: 400 });
    if (newPassword.length < 8) return Response.json({ error: '密码至少 8 位' }, { status: 400 });

    const stored = await getSetupCode(context.env, username);
    if (!stored || !timingSafeEqual(stored, code)) {
      await rateLimitFail(context.env, username);
      return Response.json({ error: '设置码不对或已过期,联系管理员重新生成' }, { status: 403 });
    }
    await consumeSetupCode(context.env, username);

    const { salt, hash } = await hashPassword(newPassword);
    await context.env.DB.prepare(
      'INSERT OR REPLACE INTO users (username, salt, hash, created_at) VALUES (?1, ?2, ?3, ?4)'
    ).bind(username, salt, hash, new Date().toISOString()).run();
    await rateLimitReset(context.env, username);

    return new Response(JSON.stringify({ ok: true, user: username, setup: true }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': await sessionCookie(context.env, username, secure),
      },
    });
  }

  // ---- 模式② 正常登录 ----
  if (!password) return Response.json({ error: '请输入密码' }, { status: 400 });
  const row = await context.env.DB.prepare('SELECT salt, hash FROM users WHERE username = ?1')
    .bind(username).first();
  if (!row || !row.hash) {
    // 白名单账号还没设置密码:与错密码同样处理(不暴露账号状态、计入限流);
    // 首次设置入口在前端「初次使用?」链接,不自动跳转
    await rateLimitFail(context.env, username);
    return Response.json({ error: '密码不正确' }, { status: 401 });
  }
  const ok = await verifyPassword(password, row.salt, row.hash);
  if (!ok) {
    await rateLimitFail(context.env, username);
    return Response.json({ error: '用户名或密码不对' }, { status: 401 });
  }
  await rateLimitReset(context.env, username);

  return new Response(JSON.stringify({ ok: true, user: username }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Set-Cookie': await sessionCookie(context.env, username, secure),
    },
  });
}
