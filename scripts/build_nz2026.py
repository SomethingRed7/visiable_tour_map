#!/usr/bin/env python3
"""nz2026 行程数据生成器(飞书同步产物)。

数据来源:飞书 wiki「新西兰咕咕嘎嘎」(docx P9RddnoSdonpH6xzWijcZamEnQb) 行程表,
2026-08-10 读取。按白名单提取:城市/行程(DeepSeek修订时间线)/住宿名/吃的/交通;
丢弃:费用、预订链接、预订号、地址、点评、时间地点表。

生成 data/trips/nz2026.json + data/trips/index.json,自驾路线走 OSRM(真实道路)。
运行: python3 scripts/build_nz2026.py
"""
import json
import urllib.request
from datetime import date, timedelta

OUT_TRIP = "data/trips/nz2026.json"
OUT_INDEX = "data/trips/index.json"

# 城市坐标(2026-08-10 Nominatim 不可达,使用标准已知值;英文名=Google Maps 对照名)
CITIES = {
    "奥克兰":   ("Auckland",      -36.8485, 174.7633),
    "罗托鲁瓦": ("Rotorua",       -38.1368, 176.2497),
    "玛塔玛塔": ("Matamata",      -37.8106, 175.7722),
    "怀托摩":   ("Waitomo",       -38.2577, 175.1104),
    "基督城":   ("Christchurch",  -43.5321, 172.6362),
    "但尼丁":   ("Dunedin",       -45.8788, 170.5028),
    "蒂阿瑙":   ("Te Anau",       -45.4148, 167.7161),
    "皇后镇":   ("Queenstown",    -45.0312, 168.6626),
    "库克山":   ("Mount Cook",    -43.7333, 170.0933),
    "特卡波湖": ("Lake Tekapo",   -44.0048, 170.4768),
}
# 路线途经点(真实道路走向)
VIA = {
    "leg1":  [(-37.7870, 175.2793)],                          # Hamilton
    "leg2":  [(-38.6857, 176.0702)],                          # Taupo
    "leg3":  [(-37.8721, 175.6826)],                          # Hobbiton
    "leg7":  [(-44.3960, 171.2546), (-45.0976, 170.9705)],    # Timaru, Oamaru
    "leg12": [(-45.0436, 169.2022), (-44.2566, 170.1006)],    # Cromwell, Twizel
    "leg14": [(-44.2566, 170.1006)],                          # Twizel
}

# 16 天行程(来自飞书文档;activities=DeepSeek修订时间线,无修订则用行程列)
DAYS = [
    dict(date="2026-08-29", city="奥克兰", summary="奥克兰落地休整",
         activities=["11:50 落地奥克兰", "14:00 前后取车（延迟 1h 内租车商宽容）",
                     "15:00-17:00 超市采购保暖衣物、温泉泳衣、零食物资", "17:30 Auckland Fish Market 晚餐"],
         accommodation="奥克兰市区酒店（1晚）",
         meals="鱼市晚餐 ★ Auckland Fish Market（生蚝/青口/鱼薯） ○ Depot（烤牛舌、蒜香面包） △ 中餐留到 DAY 5 倒霉路",
         transport="✈️ -> 🚗 28km"),
    dict(date="2026-08-30", city="罗托鲁瓦", summary="奥克兰 → 哈密尔顿花园 → 罗托鲁瓦",
         activities=["上午 哈密尔顿花园拍照", "下午 地狱之门地热+泥浆温泉（火山泥不急定）", "晚间 Polynesian Spa（确认预订）"],
         accommodation="罗托鲁瓦湖边民宿（1晚,有猫）",
         meals="地热+意餐 ★ 地热蒸玉米（毛利路边摊） ○ Bistro 128（小镇最佳餐厅） ★ 毛利窑烤 Hāngi（提前订）",
         transport="🚗 131km + 105km"),
    dict(date="2026-08-31", city="玛塔玛塔", summary="罗托鲁瓦 → 陶波 → 玛塔玛塔",
         activities=["上午 陶波:胡卡瀑布+飞机麦当劳", "傍晚 入住玛塔玛塔小镇"],
         accommodation="玛塔玛塔小镇酒店（1晚）",
         meals="湖边鱼薯 ○ 陶波湖边鱼薯（胡卡瀑布后看湖吃） △ 玛塔玛塔 Redoubt（凑合）",
         transport="🚗 80km + 116km"),
    dict(date="2026-09-01", city="怀托摩", summary="玛塔玛塔 → 霍比特人村 → 怀托摩",
         activities=["8:40 霍比屯 Second Breakfast（已定,2.5h）", "13:00 怀托摩萤火虫洞游船（不急定,建议提前 3-5 天订）",
                     "可选 黑河漂流（时间充足时）"],
         accommodation="怀托摩小镇酒店（1晚,不可取消）",
         meals="小镇简餐 ○ Whistle Stop Café（霍比屯回来吃）",
         transport="🚗 15km + 88km"),
    dict(date="2026-09-02", city="奥克兰", summary="怀托摩 → 奥克兰",
         activities=["上午 怀托摩→奥克兰 178km", "14:00-14:30 机场还车（避开柜台下班）",
                     "下午 弹性:状态好则 SkyBus 进城（伊甸山/皇后街）,否则直接休息"],
         accommodation="奥克兰机场旁边民宿（1晚,有猫）",
         meals="中餐乡愁 ★ 倒霉路 Dominion Rd（火锅/烧烤/粤菜） ○ Viaduct 港区（海鲜+帆船码头） ★ 超市囤货（Whittaker's/Hokey Pokey/L&P/Pavlova）",
         transport="🚗 178km"),
    dict(date="2026-09-03", city="基督城", summary="奥克兰飞基督城,南岛开启",
         activities=["下午 航班 奥克兰→基督城", "15:00 机场取南岛车（核对全险:车窗/底盘/雪地）", "下午 国际南极中心（已定）"],
         accommodation="基督城市区民宿（2晚）",
         meals="市场与可颂 ★ Riverside Market（生蚝/拉面/可颂/咖啡） ○ Riccarton 广式点心 ○ Fiddlesticks 可颂（全城最酥）",
         transport="✈️ 航班"),
    dict(date="2026-09-04", city="基督城", summary="基督城全天游玩",
         activities=["全天 深度游玩（可加:植物园+雅芳河撑船）"],
         accommodation="基督城市区民宿（同上）",
         meals="同 DAY 6 ★ Riverside Market 二刷 ○ 中餐/可颂补漏",
         transport="🚗 市内"),
    dict(date="2026-09-05", city="但尼丁", summary="基督城 → 蒂马鲁 → 奥马鲁 → 但尼丁",
         activities=["8:30 Lyttelton 农贸市场（周六限定）", "11:00 出发", "13:00-14:00 蒂马鲁午餐（奶站 40-60min）",
                     "15:00-16:30 奥马鲁老街+蒸汽朋克", "17:45 到企鹅中心,18:15 入场小蓝企鹅归巢", "20:15 出发 → 21:45 到但尼丁"],
         accommodation="但尼丁民宿（2晚）",
         meals="海鲜名店 ★ Fleur's Place（港口木屋海鲜,蓝鳕鱼/青口） △ 蒂马鲁奶站打卡即可 ○ 问 Bluff 生蚝（季末冰鲜）",
         transport="🚗 361km"),
    dict(date="2026-09-06", city="但尼丁", summary="但尼丁",
         activities=["9:00 火车站彩窗打卡", "11:00 Peninsula Encounters+Albatross 套票（6.5-7h:信天翁/海狮/OPERA 企鹅）",
                     "17:30-18:00 结束", "傍晚 火车站夜景+八角广场+晚饭"],
         accommodation="但尼丁民宿（2晚）",
         meals="意餐+精酿 ○ Etrusco（墨鱼面,本地人约会地） ○ Emerson's 啤酒厂（精酿+炸鱼薯） ○ Bluff 生蚝（季末碰运气）+鹿肉排",
         transport="🚗 1.6km"),
    dict(date="2026-09-07", city="蒂阿瑙", summary="但尼丁 → 蒂阿瑙",
         activities=["8:00-10:00 隧道海滩（可选,天气差删）", "10:30 出发 → 14:30 蒂阿瑙", "下午 湖边散步（可选:蒂阿瑙萤火虫洞）"],
         accommodation="蒂阿瑙湖景酒店（1晚）",
         meals="森林牛排 ○ Redcliff Café（超厚牛排+森林小屋氛围,获奖）",
         transport="🚗 287km"),
    dict(date="2026-09-08", city="皇后镇", summary="蒂阿瑙 → 米尔福德峡湾 → 皇后镇",
         activities=["10:00 Southern Discoveries 大巴往返（镜湖/荷马隧道+中午游船）", "17:00 回蒂阿瑙",
                     "17:30 自驾 171km", "20:00 到皇后镇（车留蒂阿瑙,非单向线）", "21:45 Onsen Hot Pools（已定,21:30）"],
         accommodation="皇后镇民宿（2晚）",
         meals="夜宵汉堡 ★ Fergburger 打包带走（泡 Onsen 前买好,回民宿微波炉加热）",
         transport="🚗 171km + 峡湾大巴"),
    dict(date="2026-09-09", city="皇后镇", summary="皇后镇全天休闲",
         activities=["白天 Skyline 三选一（缆车+山顶餐/滑板车/观星）", "下午 TSS 蒸汽船游瓦卡蒂普湖（RealNZ 小程序）", "其余自由休整"],
         accommodation="皇后镇民宿（2晚）",
         meals="蜜月食单 ★ Patagonia 冰淇淋（湖边巧克力） ○ Blue Kanu（亚洲融合,咖喱羊肉） ○ Fergbaker（肉派早餐） △ Skyline 自助餐性价比低 ★ 鹿肉+黑皮诺晚餐（Blue Kanu/Rata）",
         transport="🚗 市内"),
    dict(date="2026-09-10", city="库克山", summary="皇后镇 → 库克山",
         activities=["9:30 出发（走克伦威尔,避开瓦纳卡）", "10:15 克伦威尔", "11:00-12:30 Rose Creek 农场（已定 1.5h）",
                     "中途 普卡基湖拍照", "16:00 库克山入住"],
         accommodation="库克山村酒店（1晚）",
         meals="三文鱼必停 ★ High Country Salmon（特威泽尔,高山三文鱼刺身,顺手打包冰川午餐） ○ 克伦威尔水果店（干果/蜂蜜） ○ 克伦威尔酒庄品黑皮诺 20 分钟 △ Hermitage 自助餐别期待",
         transport="🚗 269km"),
    dict(date="2026-09-11", city="库克山", summary="库克山",
         activities=["8:00 Alpine Guides 签到:Tasman Glacier Ice Adventure（7h,两次直升机,自备午餐）",
                     "注意:仅 08:00 一场/每天 4 名额/最低 3 人成团——出发前确认", "天气取消全额退款"],
         accommodation="库克山村酒店（1晚）",
         meals="自备午餐 ★ 冰川日午餐=High Country Salmon 三明治+能量棒 △ 晚餐 Hermitage 自助/自热饭",
         transport="🚗 市内"),
    dict(date="2026-09-12", city="特卡波湖", summary="库克山 → 特卡波湖（暗夜观星）",
         activities=["上午 留白（DAY 14 取消可补场）", "13:00 出发 → 14:30 特卡波（103km）", "傍晚 好牧羊人教堂",
                     "21:00 Mt John 观星（已定 Summit Experience 1h45m,注意保暖）"],
         accommodation="特卡波湖民宿（1晚）",
         meals="日料湖景 ★ Kohan 日式餐厅（湖景日料,观星前吃,要订） ○ Astro Café（Mt John 山顶咖啡）",
         transport="🚗 103km"),
    dict(date="2026-09-13", city="基督城", summary="特卡波湖 → 基督城返程",
         activities=["上午 湖边散步", "13:00 出发 → 16:00 基督城", "15:30-16:00 还车（柜台营业时间内）",
                     "下午 最后一波购物,入住机场酒店"],
         accommodation="基督城机场隔壁酒店（1晚）",
         meals="收尾二刷 ○ Riverside Market 最后一顿 △ 机场酒店附近简餐",
         transport="🚗 235km"),
]


def strip_urls(s: str) -> str:
    import re
    return re.sub(r"https?://\S+|www\.\S+", "", s).strip()


def osrm_route(coords):
    """OSRM driving polyline (geojson)。coords = [(lat, lon), ...]

    注意:urllib 的 TLS 握手在本网络被拦(SSL HANDSHAKE_FAILURE),curl 可通,
    故用 subprocess 调 curl。
    """
    import subprocess
    pts = ";".join(f"{lon},{lat}" for lat, lon in coords)
    url = (f"https://router.project-osrm.org/route/v1/driving/{pts}"
           f"?overview=full&geometries=geojson")
    for attempt in range(3):
        try:
            out = subprocess.run(
                ["curl", "-s", "-m", "30", url],
                capture_output=True, text=True, timeout=35,
            ).stdout
            d = json.loads(out)
            if d.get("code") == "Ok" and d.get("routes"):
                return d["routes"][0]["geometry"]["coordinates"]  # [[lon, lat], ...]
        except Exception:
            pass
    return None


def decimate(coords, target=250):
    """抽稀折线到约 target 个点(保持路形,控制 JSON 体积)。"""
    n = len(coords)
    if n <= target:
        return coords
    step = n / target
    return [coords[int(i * step)] for i in range(target)] + [coords[-1]]


def main():
    import re

    # 1. days
    days = []
    for i, d in enumerate(DAYS, 1):
        dt = date.fromisoformat(d["date"])
        en, lat, lon = CITIES[d["city"]]
        days.append({
            "day": i,
            "date": d["date"],
            "weekday": "周" + "一二三四五六日"[dt.weekday()],
            "city": d["city"],
            "city_en": en,
            "lat": lat,
            "lon": lon,
            "summary": strip_urls(d["summary"]),
            "activities": [strip_urls(a) for a in d["activities"]],
            "accommodation": strip_urls(d["accommodation"]),
            "meals": strip_urls(d["meals"]),
            "transport": strip_urls(d["transport"]),
            "status": "booked",
            "photos": [],
        })

    # 2. routes(相邻日期城市间自驾;航班段跳过)
    legs = [
        (1, 2), (2, 3), (3, 4), (4, 5),        # 北岛
        (7, 8), (9, 10), (10, 11),            # 南岛(5→6 航班跳过,6→7/8→9/11→12/13→14 市内)
        (12, 13), (14, 15), (15, 16),
    ]
    routes = []
    for a, b in legs:
        ca, cb = days[a - 1], days[b - 1]
        key = f"leg{a}"
        via = VIA.get(key, [])
        coords = [(ca["lat"], ca["lon"])] + via + [(cb["lat"], cb["lon"])]
        geom = osrm_route(coords)
        line = decimate(geom) if geom else coords
        routes.append({
            "from_day": a,
            "to_day": b,
            "name": f"{ca['city']} → {cb['city']}",
            "coords": [[p[1], p[0]] for p in line],
        })
        print(f"route {a}→{b}: {routes[-1]['name']} "
              f"({'OSRM ' + str(len(routes[-1]['coords'])) + ' pts' if geom else '直线退化'})")

    trip = {
        "meta": {
            "title": "新西兰蜜月之旅",
            "subtitle": "2026.08.29 - 09.13 · 南北岛 16 天",
            "departure": "2026-08-29",
            "return": "2026-09-13",
            "updated_at": "2026-08-10T15:20:00+08:00",
        },
        "days": days,
        "routes": routes,
    }
    json.dump(trip, open(OUT_TRIP, "w", encoding="utf-8"), ensure_ascii=False, indent=2)

    index = [{
        "id": "nz2026",
        "title": "新西兰蜜月 2026",
        "subtitle": "南北岛自驾 16 天",
        "departure": "2026-08-29",
        "return": "2026-09-13",
        "updated_at": trip["meta"]["updated_at"],
    }]
    json.dump(index, open(OUT_INDEX, "w", encoding="utf-8"), ensure_ascii=False, indent=2)
    print(f"written {OUT_TRIP} ({len(days)} days, {len(routes)} routes) + {OUT_INDEX}")


if __name__ == "__main__":
    main()
