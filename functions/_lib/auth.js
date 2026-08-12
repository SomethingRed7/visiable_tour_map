// 共享认证工具(登录/会话/设置码/限流)
// - 口令:PBKDF2-SHA256(100k 迭代,16B 盐,32B 密钥),hex 存储于 D1 users 表
// - 会话:HMAC-SHA256 签名 cookie `gg_session=<username>.<expiresMs>.<sig>`,90 天
// - 设置码:KV `setup:<username>`,单次使用、用后即焚,管理员经脚本写入
// - 限流:KV `rl:cnt:<username>`(失败计数)/ `rl:lock:<username>`(锁定),15 分钟窗口
// 说明:密码哈希必须存 D1(运行时写入);vars 只读,只放白名单与签名密钥

export const COOKIE_NAME = 'gg_session';
export const SESSION_DAYS = 90;
const MAX_FAILS = 5;
const LOCK_TTL = 900; // 15 分钟(秒)

const enc = new TextEncoder();

/* ---------- hex 工具 ---------- */
export function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function fromHex(s) {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out.buffer;
}
export function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ---------- 白名单(vars USERS = "球,小红") ---------- */
export function getUsers(env) {
  const out = {};
  for (const u of String(env.USERS || '').split(',')) {
    const name = u.trim();
    if (name) out[name] = true;
  }
  return out;
}

/* ---------- PBKDF2 口令(hex) ---------- */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, 100000);
  return { salt: toHex(salt), hash: toHex(hash) };
}

export async function verifyPassword(password, saltHex, hashHex) {
  try {
    const derived = await pbkdf2(password, fromHex(saltHex), 100000);
    return timingSafeEqual(toHex(derived), hashHex);
  } catch {
    return false;
  }
}

async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
}

/* ---------- 会话 cookie 签发/校验 ---------- */
async function sessionSig(env, username, expiresMs) {
  const key = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET || ''), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${username}.${expiresMs}`));
  return toHex(sig);
}

// 返回 Set-Cookie 头值;secure 仅 https 下置位(本地 http 开发也能存 cookie)
// 注意:header 值必须 latin1(Fetch 规范),中文用户名须 encodeURIComponent,
// 否则真实浏览器/Workers 抛 TypeError(miniflare 有 quirk 掩盖此问题)
export async function sessionCookie(env, username, secure) {
  const expiresMs = Date.now() + SESSION_DAYS * 86400 * 1000;
  const sig = await sessionSig(env, username, expiresMs);
  const u = encodeURIComponent(username);
  return `${COOKIE_NAME}=${u}.${expiresMs}.${sig}; Max-Age=${SESSION_DAYS * 86400}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax`;
}

// 从请求 cookie 解析用户名;签名不符/过期/格式错 → null
export async function verifySession(env, request) {
  const raw = request.headers.get('Cookie') || '';
  let val = '';
  for (const part of raw.split(';')) {
    const p = part.trim();
    if (p.startsWith(COOKIE_NAME + '=')) val = p.slice(COOKIE_NAME.length + 1);
  }
  if (!val) return null;
  const idx1 = val.indexOf('.');
  const idx2 = val.lastIndexOf('.');
  if (idx1 <= 0 || idx2 <= idx1 + 1) return null;
  const encodedUser = val.slice(0, idx1);
  const expiresMs = val.slice(idx1 + 1, idx2);
  const sig = val.slice(idx2 + 1);
  if (!/^\d{13}$/.test(expiresMs)) return null;
  if (Number(expiresMs) < Date.now()) return null;
  let username;
  try { username = decodeURIComponent(encodedUser); } catch { return null; }
  const expect = await sessionSig(env, username, expiresMs);
  if (!timingSafeEqual(expect, sig)) return null;
  if (!getUsers(env)[username]) return null; // 白名单收缩后旧会话作废
  return username;
}

/* ---------- 登录限流(KV) ---------- */
export async function rateLimitCheck(env, username) {
  const lock = await env.ENTRIES.get(`rl:lock:${username}`);
  if (lock) {
    // 尝试读剩余时间(KV put 时存入到期时间戳)
    const until = Number(lock) || 0;
    const retryAfter = Math.max(1, Math.ceil((until - Date.now()) / 1000));
    return { allowed: false, retryAfter };
  }
  return { allowed: true };
}

// 记录一次失败;连续 MAX_FAILS 次 → 锁 LOCK_TTL
export async function rateLimitFail(env, username) {
  const key = `rl:cnt:${username}`;
  const cur = Number((await env.ENTRIES.get(key)) || '0');
  const next = cur + 1;
  await env.ENTRIES.put(key, String(next), { expirationTtl: LOCK_TTL });
  if (next >= MAX_FAILS) {
    await env.ENTRIES.put(`rl:lock:${username}`, String(Date.now() + LOCK_TTL * 1000), { expirationTtl: LOCK_TTL });
  }
}

export async function rateLimitReset(env, username) {
  await env.ENTRIES.delete(`rl:cnt:${username}`);
  await env.ENTRIES.delete(`rl:lock:${username}`);
}

/* ---------- 一次性设置码(KV) ---------- */
export async function getSetupCode(env, username) {
  return env.ENTRIES.get(`setup:${username}`);
}

export async function consumeSetupCode(env, username) {
  await env.ENTRIES.delete(`setup:${username}`);
}
