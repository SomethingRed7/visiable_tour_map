#!/bin/bash
# 照片压缩流水线:原图 → photos/<tripId>/dayNN/(长边1600 大图 + 480 缩略图)
#
# 用法: scripts/compress_photos.sh <incoming_dir> <tripId> <dayNN>
# 例:   scripts/compress_photos.sh photos/_incoming/nz2026/day01 nz2026 day01
#
# 原图先丢进 photos/_incoming/<tripId>/dayNN/(不入库),跑完自动按序编号输出,
# 打印的照片路径加进 data/trips/<tripId>.json 对应天的 photos 数组。
set -euo pipefail

IN="${1:?用法: compress_photos.sh <incoming_dir> <tripId> <dayNN>}"
TRIP="${2:?tripId}"
DAY="${3:?dayNN}"
OUT="photos/$TRIP/$DAY"
mkdir -p "$OUT"

START=1
if [ -n "$(ls "$OUT"/*.jpg 2>/dev/null | head -1)" ]; then
  START=$(ls "$OUT" | grep -E '^[0-9]+\.jpg$' | sed 's/\.jpg//' | sort -n | tail -1 | awk '{print $1 + 1}')
fi

i=$START
for src in "$IN"/*; do
  [ -f "$src" ] || continue
  ext="${src##*.}"
  case "$ext" in jpg|jpeg|png|heic|JPG|JPEG|PNG|HEIC) ;; *) echo "跳过非图片: $src" >&2; continue ;; esac

  full="$OUT/$i.jpg"
  thumb="$OUT/$i-thumb.jpg"
  sips -s format jpeg -s formatOptions 80 --resampleHeightWidthMax 1600 "$src" --out "$full" >/dev/null 2>&1
  sips -s format jpeg -s formatOptions 75 --resampleHeightWidthMax 480 "$src" --out "$thumb" >/dev/null 2>&1

  fsize=$(stat -f%z "$full" 2>/dev/null || echo 0)
  echo "photos/$TRIP/$DAY/$i.jpg (+thumb, ${fsize} bytes)"
  i=$((i + 1))
done

echo "完成: $OUT (共 $((i - START)) 张)"
