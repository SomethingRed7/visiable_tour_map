#!/usr/bin/env python3
# 规划打卡预置导入:把 data/trips/nz2026.json 的 16 天行程按天写入 D1 todos。
# 用法:
#   python3 scripts/import_nz_todos.py --remote | npx wrangler d1 execute gugugaga-db --remote --file /dev/stdin
#   python3 scripts/import_nz_todos.py --local  | npx wrangler d1 execute gugugaga-db --local  --file /dev/stdin
# 幂等:按 (date, text) 去重,重复执行不产生重复条目。
import json
import sys
from datetime import datetime, timezone

def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else '--remote'
    with open('data/trips/nz2026.json', encoding='utf-8') as f:
        data = json.load(f)

    stmts = []
    for day in data.get('days', []):
        date = day.get('date', '')
        text = f"{day.get('city', '')} · {day.get('summary', '')}".strip(' ·')
        if not date or not text:
            continue
        created = datetime.now(timezone.utc).isoformat()
        stmts.append(
            "INSERT INTO todos (date, text, done, sort_order, created_at) "
            f"SELECT '{date}', '{text.replace(chr(39), chr(39)*2)}', 0, 0, '{created}' "
            f"WHERE NOT EXISTS (SELECT 1 FROM todos WHERE date = '{date}' AND text = '{text.replace(chr(39), chr(39)*2)}');"
        )

    print(f"-- 规划打卡预置: {mode} {len(stmts)} 天(去重导入)")
    for s in stmts:
        print(s)
    if not stmts:
        print("-- (nz2026.json 里没有可导入的天)", file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
