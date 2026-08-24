// POST /api/push —— 把当天公开动态推送到微信(WxPusher 第三方服务)
// 需要登录会话(管理页「推送到微信」按钮调用)。
// 配置读取 wrangler.toml [vars]:
//   WXPUSHER_APPTOKEN  应用 token(AT_ 开头),用闲置微信号登录 https://wxpusher.zjiecode.com 注册应用获取
//   WXPUSHER_TOPIC_ID  (可选)主题 ID,家人扫码关注主题后群发(与 uids 二选一,优先)
//   WXPUSHER_UIDS      (可选)接收人 UID,逗号分隔(每个接收人在 WxPusher 后台复制自己的 UID)
import { verifySession } from '../_lib/auth.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WXPUSHER_API = 'https://wxpusher.zjiecode.com/api/send/message';

function normEntry(e) {
  let location = null;
  try { location = e.location ? JSON.parse(e.location) : null; } catch { location = null; }
  let photos = [];
  try { photos = JSON.parse(e.photos || '[]'); } catch { photos = []; }
  return {
    title: e.title || '',
    text: e.text || '',
    author: e.author || null,
    location,
    photos,
    visibility: e.visibility || 'public',
  };
}

function fmtDateLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export async function onRequestPost(context) {
  const user = await verifySession(context.env, context.request);
  if (!user) return Response.json({ error: '未登录' }, { status: 401 });

  const appToken = (context.env.WXPUSHER_APPTOKEN || '').trim();
  if (!appToken) {
    return Response.json(
      { error: '微信推送未配置:请在 wrangler.toml 设置 WXPUSHER_APPTOKEN(用闲置微信号登录 wxpusher.zjiecode.com 注册应用获取)' },
      { status: 503 },
    );
  }
  const topicId = (context.env.WXPUSHER_TOPIC_ID || '').trim();
  const uids = (context.env.WXPUSHER_UIDS || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  if (!topicId && !uids.length) {
    return Response.json(
      { error: '微信推送未配置接收人:请设置 WXPUSHER_TOPIC_ID(主题)或 WXPUSHER_UIDS(UID 列表)' },
      { status: 503 },
    );
  }

  // 日期:body.date 优先,否则默认本地今天
  let body = {};
  try { body = await context.request.json(); } catch { /* 空 body 用默认日期 */ }
  let date = body.date;
  if (!date || !DATE_RE.test(date)) date = fmtDateLocal(new Date());

  // 公开动态(家人视角,私有条目不推)
  const { results: entryRows } = await context.env.DB
    .prepare('SELECT * FROM entries WHERE date = ?1 AND visibility = ?2 ORDER BY ts ASC')
    .bind(date, 'public')
    .all();
  const entries = (entryRows || []).map(normEntry).filter((e) => e.visibility === 'public');

  // 待办(含完成状态)
  const { results: todoRows } = await context.env.DB
    .prepare('SELECT text, done FROM todos WHERE date = ?1 ORDER BY sort_order ASC, id ASC')
    .bind(date)
    .all();
  const todos = todoRows || [];

  if (!entries.length && !todos.length) {
    return Response.json({ error: `${date} 还没有内容可推送` }, { status: 400 });
  }

  const origin = new URL(context.request.url).origin;
  const md = buildMarkdown(date, entries, todos, origin);

  const payload = {
    appToken,
    content: md,
    summary: `${date} 咕咕嘎嘎播报`,
    contentType: 3, // 3 = markdown
  };
  if (topicId) payload.topicIds = [parseInt(topicId, 10)];
  else payload.uids = uids;

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    const r = await fetch(WXPUSHER_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const j = await r.json().catch(() => ({}));
    if (j.code !== 1000) {
      return Response.json({ error: `微信推送失败:${j.msg || JSON.stringify(j)}` }, { status: 502 });
    }
    // 送达人数:WxPusher 返回结构在不同版本下字段名可能是 success(数组)或 sent(数字)
    let sent = 0;
    if (j.data) {
      if (Array.isArray(j.data.success)) sent = j.data.success.length;
      else if (typeof j.data.sent === 'number') sent = j.data.sent;
    }
    const who = sent > 0 ? `送达 ${sent} 人` : '已提交';
    return Response.json({ ok: true, message: `已推送到微信 ✅ ${who}(${date})` });
  } catch (e) {
    return Response.json({ error: `微信推送请求异常:${String(e)}` }, { status: 502 });
  }
}

function buildMarkdown(date, entries, todos, origin) {
  const lines = [];
  lines.push(`## 📮 咕咕嘎嘎播报 · ${date}`);
  lines.push('');

  // 首条公开动态的首图作封面预览
  const cover = entries.find((e) => e.photos && e.photos.length);
  if (cover) lines.push(`![封面](${origin}${cover.photos[0]})`, '');

  if (entries.length) {
    lines.push(`**今天 ${entries.length} 条公开动态:**`, '');
    for (const e of entries) {
      const who = e.author || '有人';
      let t = e.title || '(无标题)';
      if (e.location && e.location.name) t += ` 📍${e.location.name.split(',')[0]}`;
      lines.push(`- **${who}** ${t}`);
    }
    lines.push('');
  }
  if (todos.length) {
    lines.push('**今日待办:**', '');
    for (const td of todos) lines.push(`- ${td.done ? '✅' : '⬜'} ${td.text}`);
    lines.push('');
  }
  lines.push(`👉 [查看全部](${origin}/?date=${date})`);
  return lines.join('\n');
}
