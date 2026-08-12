// 生成 PBKDF2 口令哈希(与 functions/_lib/auth.js 参数一致:SHA-256,100k 迭代,16B 盐,32B 密钥)
// 用法:node scripts/gen-user-hash.mjs <明文密码>
// 输出:salt:hash(hex)—— 如需管理员预置密码,把这两段写入 D1 users 表:
//   INSERT OR REPLACE INTO users (username, salt, hash, created_at) VALUES ('<用户名>', '<salt>', '<hash>', datetime('now'));
// 常规流程不需要本脚本:用户首次登录凭一次性设置码自助设置密码(见 scripts/gen-setup-code.sh)
import crypto from 'node:crypto';

const password = process.argv[2];
if (!password) {
  console.error('用法:node scripts/gen-user-hash.mjs <明文密码>');
  process.exit(1);
}
const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256');
console.log(`salt:${salt.toString('hex')}`);
console.log(`hash:${hash.toString('hex')}`);
