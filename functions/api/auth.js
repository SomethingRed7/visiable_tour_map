// 会话探测:GET /api/auth → { user: "球" | null }
// 写日记页据此决定渲染登录框还是编辑器
import { verifySession } from '../_lib/auth.js';

export async function onRequestGet(context) {
  const user = await verifySession(context.env, context.request);
  return Response.json({ user });
}
