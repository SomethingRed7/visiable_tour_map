#!/usr/bin/env python3
"""旅行数据契约校验 — 本项目唯一的自动化测试接缝。

每次同步后、push 前运行:
    python3 scripts/validate_trips.py               # 校验全部行程
    python3 scripts/validate_trips.py --trip nz2026 # 校验单个行程

校验内容:
  - schema:index.json 结构、行程 meta 与 days 字段
  - 业务规则:天数=departure~return 区间、日期连续无重复、status 枚举、坐标在新西兰境内
  - 隐私边界:全字段扫描价格/手机号/邮箱/预订号/地址残留
  - 引用完整性:照片文件真实存在、index 与 trips 文件一一对应

退出码:0=通过,1=失败。纯标准库,无第三方依赖。
"""
import argparse
import json
import re
import sys
from datetime import datetime, date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TRIPS_DIR = ROOT / "data" / "trips"

# 新西兰大致边界(含查塔姆群岛余量)
NZ_LAT = (-48.0, -33.5)
NZ_LON = (165.5, 179.5)

STATUS_OK = {"booked", "pending"}

RE_PRICE = re.compile(r"[¥￥$€£]\s?\d|\d+\s*(元|NZD|纽币|RMB|人民币)")
RE_PHONE_CN = re.compile(r"1[3-9]\d{9}")
RE_PHONE_NZ = re.compile(r"\+?64\s?\d{7,10}")
RE_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[A-Za-z]{2,}")
RE_BOOKING = re.compile(
    r"预订号|订单号|确认号|预定号|booking\s*(no\.?|ref\.?)?|confirmation\s*(no\.?|ref\.?)?",
    re.I,
)
RE_ADDR = re.compile(r"地址|门牌|街道|详细地址")

errors: list[str] = []
warnings: list[str] = []


def err(msg: str) -> None:
    errors.append(msg)


def warn(msg: str) -> None:
    warnings.append(msg)


def check(cond, msg: str) -> None:
    if not cond:
        err(msg)


def walk_strings(obj, path: str = "root"):
    """递归遍历 JSON,产出 (路径, 字符串值)。"""
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from walk_strings(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from walk_strings(v, f"{path}[{i}]")
    elif isinstance(obj, str):
        yield path, obj


def scan_privacy(trip) -> None:
    """全字段扫描敏感信息残留。"""
    rules = (
        ("价格", RE_PRICE),
        ("手机号", RE_PHONE_CN),
        ("NZ电话", RE_PHONE_NZ),
        ("邮箱", RE_EMAIL),
        ("预订号/订单号", RE_BOOKING),
        ("地址", RE_ADDR),
    )
    for path, s in walk_strings(trip):
        for name, rx in rules:
            if rx.search(s):
                err(f"隐私泄漏 [{name}] {path}: {s[:60]!r}")


def parse_date(s):
    """YYYY-MM-DD → date,解析失败返回 None。"""
    try:
        return datetime.strptime(s, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def validate_trip(trip_id: str) -> None:
    path = TRIPS_DIR / f"{trip_id}.json"
    if not path.exists():
        err(f"行程文件不存在: {path.name}")
        return
    try:
        trip = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        err(f"JSON 解析失败 {path.name}: {e}")
        return

    meta = trip.get("meta") or {}
    check(isinstance(meta, dict) and meta.get("title"), f"{trip_id}: meta.title 缺失")
    dep = parse_date(meta.get("departure", ""))
    ret = parse_date(meta.get("return", ""))
    check(dep is not None, f"{trip_id}: meta.departure 不是 YYYY-MM-DD")
    check(ret is not None, f"{trip_id}: meta.return 不是 YYYY-MM-DD")
    check(meta.get("updated_at") is not None, f"{trip_id}: meta.updated_at 缺失")

    if dep and ret:
        check(ret >= dep, f"{trip_id}: return 早于 departure")
    days = trip.get("days")
    check(isinstance(days, list), f"{trip_id}: days 缺失或非数组")
    if isinstance(days, list) and dep and ret:
        expected = (ret - dep).days + 1
        check(len(days) == expected, f"{trip_id}: 天数 {len(days)} != 预期 {expected}({dep}~{ret})")
    check(isinstance(trip.get("routes"), list), f"{trip_id}: routes 缺失或非数组")

    seen_dates = set()
    for i, d in enumerate(days or [], 1):
        tag = f"{trip_id}.days[{i - 1}]"
        check(isinstance(d, dict), f"{tag}: 不是对象")
        if not isinstance(d, dict):
            continue
        for fld in ("day", "date", "city", "status", "lat", "lon", "photos"):
            check(fld in d, f"{tag}: 缺字段 {fld}")
        check(d.get("day") == i, f"{tag}: day 应为 {i},实际 {d.get('day')}")
        dt = parse_date(str(d.get("date", "")))
        check(dt is not None, f"{tag}: date 不是 YYYY-MM-DD")
        if dt:
            check(dt not in seen_dates, f"{tag}: 日期重复 {dt}")
            seen_dates.add(dt)
            if dep:
                expected_date = date.fromordinal(dep.toordinal() + i - 1)
                check(dt == expected_date, f"{tag}: 日期不连续,应为 {expected_date},实际 {dt}")
        check(d.get("status") in STATUS_OK, f"{tag}: status 非法 {d.get('status')!r}")
        lat, lon = d.get("lat"), d.get("lon")
        if isinstance(lat, (int, float)) and isinstance(lon, (int, float)):
            check(NZ_LAT[0] <= lat <= NZ_LAT[1], f"{tag}: 纬度 {lat} 超出新西兰范围")
            check(NZ_LON[0] <= lon <= NZ_LON[1], f"{tag}: 经度 {lon} 超出新西兰范围")
        else:
            err(f"{tag}: lat/lon 缺失或非数值")
        photos = d.get("photos")
        check(isinstance(photos, list), f"{tag}: photos 非数组")
        if isinstance(photos, list):
            for p in photos:
                check(isinstance(p, str) and p.startswith(f"photos/{trip_id}/"),
                      f"{tag}: 照片路径应形如 photos/{trip_id}/...,实际 {p!r}")
                if isinstance(p, str):
                    check((ROOT / p).exists(), f"{tag}: 照片文件不存在 {p}")

    scan_privacy(trip)


def validate_index() -> None:
    idx_path = TRIPS_DIR / "index.json"
    if not idx_path.exists():
        err("data/trips/index.json 不存在")
        return
    try:
        index = json.loads(idx_path.read_text(encoding="utf-8"))
    except Exception as e:
        err(f"index.json 解析失败: {e}")
        return
    check(isinstance(index, list), "index.json 应为数组")
    if not isinstance(index, list):
        return
    if len(index) == 0:
        warn("index.json 为空(暂无行程)")
        return
    ids = [t.get("id") for t in index]
    check(all(ids), "index.json 有项缺 id")
    check(len(set(ids)) == len(ids), "index.json 存在重复 id")
    for t in index:
        for fld in ("id", "title", "departure", "return"):
            check(fld in t, f"index.json 项缺 {fld}: {t}")
        for fld in ("departure", "return"):
            if fld in t and parse_date(t[fld]) is None:
                err(f"index.json 项 {t.get('id')} 的 {fld} 不是 YYYY-MM-DD")
    files = {p.stem for p in TRIPS_DIR.glob("*.json") if p.name != "index.json"}
    check(set(ids) == files,
          f"index 与文件不一致:index={sorted(set(ids))},文件={sorted(files)}")


def main() -> int:
    ap = argparse.ArgumentParser(description="旅行数据契约校验(唯一测试接缝)")
    ap.add_argument("--trip", help="只校验指定行程 id")
    args = ap.parse_args()

    before = len(errors)
    validate_index()
    if args.trip:
        validate_trip(args.trip)
    else:
        idx_path = TRIPS_DIR / "index.json"
        if idx_path.exists():
            try:
                index = json.loads(idx_path.read_text(encoding="utf-8"))
                for t in index:
                    validate_trip(t.get("id", ""))
            except Exception:
                pass

    for w in warnings:
        print(f"[WARN] {w}")
    for e in errors:
        print(f"[ERROR] {e}")
    new_errors = len(errors) - before
    if new_errors == 0:
        print("✓ 数据契约校验通过")
        return 0
    print(f"✗ 校验失败:{new_errors} 个错误")
    return 1


if __name__ == "__main__":
    sys.exit(main())
