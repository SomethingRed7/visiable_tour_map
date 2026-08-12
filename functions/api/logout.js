// 登出 API:POST /api/logout(清会话 cookie,幂等)
import { clearSessionCookie } from '../_lib/auth.js';

export async function onRequestPost() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearSessionCookie() },
  });
}
