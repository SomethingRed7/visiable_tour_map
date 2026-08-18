// 已分享快照列表 API:GET /api/shares(仅登录,按更新时间倒序)
// 只返回元信息(token/条件/时间/链接),不含冻结内容(列表页不需要,内容在 /s/<token> 渲染)
import { verifySession } from '../_lib/auth.js';

export async function onRequestGet(context) {
  const user = await verifySession(context.env, context.request);
  if (!user) return Response.json({ error: '请先登录' }, { status: 401 });

  const list = await context.env.ENTRIES.list({ prefix: 'share:' });
  const out = [];
  for (const k of (list.keys || [])) {
    const raw = await context.env.ENTRIES.get(k.name);
    if (!raw) continue;
    try {
      const s = JSON.parse(raw);
      out.push({
        token: s.token,
        album: s.album || null,
        from: s.from || null,
        to: s.to || null,
        ck: s.ck || {},
        created_at: s.created_at || null,
        updated_at: s.updated_at || null,
        url: `/s/${s.token}`,
      });
    } catch { /* 跳过损坏项 */ }
  }
  out.sort((a, b) => ((a.updated_at || '') < (b.updated_at || '') ? 1 : -1));
  return Response.json({ shares: out });
}
