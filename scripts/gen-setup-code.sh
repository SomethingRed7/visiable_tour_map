#!/bin/bash
# 生成一次性设置码并写入 KV(供账号首次登录设置密码)
# 用法:./scripts/gen-setup-code.sh <用户名> [--local]
#   --local  = 写入本地 miniflare 模拟 KV(wrangler pages dev 用)
#   默认     = 写入线上 KV(需已登录 wrangler)
# 设置码 6 位随机,7 天有效,单次使用(登录接口用后即焚)
set -euo pipefail
USER="${1:?用法: gen-setup-code.sh <用户名> [--local]}"
MODE="${2:-}"
CODE=$(printf '%06d' $((RANDOM % 1000000)))

if [ "$MODE" = "--local" ]; then
  npx wrangler kv key put --binding=ENTRIES "setup:$USER" "$CODE" --ttl 604800 --local
else
  npx wrangler kv key put --binding=ENTRIES "setup:$USER" "$CODE" --ttl 604800
fi
echo "OK 设置码已写入 KV:setup:$USER = $CODE (7 天有效,单次使用)"
