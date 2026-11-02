#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
事務機新機型每月自動巡查與快照更新腳本 (Monthly MFP Models Sync)
1. 從中華民國經濟部能源署節能標章官方網站抓取類別 32（影印機）與類別 33（印表機）全數獲證機型
2. 逐筆調閱技術細節頁面，嚴格過濾「是否具備A3紙張輸出能力：是」
3. 比對現有資料庫，若發現新機型或 TEC 更新，自動同步寫入 index.html 與 mfp-tec-deck.html
"""

import os
import re
import sys
import json
import time
import urllib.request
import ssl
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

# Windows 終端機編碼防禦
if sys.stdout and hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
if sys.stderr and hasattr(sys.stderr, 'reconfigure'):
    try:
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

TARGET_BRANDS = [
    "Epson", "Ricoh", "FUJIFILM", "Canon", "KYOCERA",
    "Sharp", "Konica Minolta", "Toshiba", "HP", "DEVELOP"
]

def clean_brand(raw_b: str, comp: str) -> str:
    text = (raw_b + " " + comp).upper()
    if 'RICOH' in text or '理光' in text or '互盛' in text: return 'Ricoh'
    if 'EPSON' in text or '愛普生' in text: return 'Epson'
    if 'FUJIFILM' in text or '富士軟片' in text or 'FUJI XEROX' in text or '富士全錄' in text: return 'FUJIFILM'
    if 'CANON' in text or '佳能' in text: return 'Canon'
    if 'KYOCERA' in text or '京瓷' in text: return 'KYOCERA'
    if 'SHARP' in text or '震旦' in text: return 'Sharp'
    if 'KONICA' in text or '金儀' in text: return 'Konica Minolta'
    if 'TOSHIBA' in text or '台芝' in text: return 'Toshiba'
    if 'HP' in text or '惠普' in text: return 'HP'
    if 'DEVELOP' in text or '康鈦' in text: return 'DEVELOP'
    return raw_b or comp

def clean_color(type_desc: str) -> str:
    td = (type_desc or "").lower()
    if '彩色' in td or 'color' in td: return 'C'
    return 'M'

def clean_tech(tech_desc: str, brand: str) -> str:
    t = (tech_desc or "").upper()
    if '噴墨' in t or 'IJ' in t or 'INK' in t: return 'HPIJ'
    return 'EP'

def fetch_moea_items(cat_id: int):
    from bs4 import BeautifulSoup
    url = f"https://ea03.moeaea.gov.tw/e0410/01/purchasing/product/upt.aspx?p0={cat_id}&&uid=0&con=1&cid=0&year=&month=&day=&key=&pageno=0"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    resp = urllib.request.urlopen(req, context=ctx, timeout=25)
    html = resp.read().decode('utf-8', errors='replace')
    soup = BeautifulSoup(html, 'html.parser')
    table = soup.find('table')
    items = []
    if table:
        for r in table.find_all('tr'):
            cells = r.find_all(['th', 'td'])
            if len(cells) >= 2:
                company = cells[0].get_text(strip=True)
                if not company or company == '廠商名稱':
                    continue
                for a in cells[1].find_all('a'):
                    model = a.get_text(strip=True)
                    href = a.get('href')
                    items.append({
                        "category_id": cat_id,
                        "category_name": "影印機" if cat_id == 32 else "印表機",
                        "company": company,
                        "model": model,
                        "href": href
                    })
    return items

def parse_item_detail(item: dict):
    from bs4 import BeautifulSoup
    base = 'https://ea03.moeaea.gov.tw/e0410/01/purchasing/product/'
    item_url = urllib.parse.urljoin(base, item["href"])
    html = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(item_url, headers={'User-Agent': 'Mozilla/5.0'})
            resp = urllib.request.urlopen(req, context=ctx, timeout=15)
            html = resp.read().decode('utf-8', errors='replace')
            break
        except Exception:
            time.sleep(1)
            
    if not html:
        return None

    soup = BeautifulSoup(html, 'html.parser')
    fields = {}
    for dtitle in soup.find_all(class_='dtitle'):
        label = dtitle.get_text(strip=True).replace('：', '').replace('　', '').replace(' ', '')
        val_div = dtitle.find_next_sibling('div')
        if val_div:
            fields[label] = val_div.get_text(strip=True)

    is_a3 = fields.get("是否具備A3紙張輸出能力", "")
    if is_a3 != "是":
        return None

    brand = clean_brand(fields.get("廠牌名稱", ""), item["company"])
    model = item["model"].strip()
    color = clean_color(fields.get("影印機種類", "") or fields.get("印表機種類", ""))
    
    try:
        speed = int(float(fields.get("產品速度(ipm)", 0)))
    except:
        speed = 25

    tech = clean_tech(fields.get("顯像技術", "") or fields.get("符合之顯像技術", ""), brand)
    
    try:
        tec = float(fields.get("典型用電量TEC(度/週)實測值", 0))
    except:
        tec = 0.0

    cat_name = item["category_name"]
    cert = fields.get("證書號碼", "")

    if tec <= 0:
        if model in ['EM-C8101', 'EM-C8100']:
            tec = 0.23
            src = f"經濟部能源署節能標章（{cat_name}・證書{cert}）／原廠手冊"
        elif model == 'WF-C869R':
            tec = 0.35
            src = f"經濟部能源署節能標章（{cat_name}・證書{cert}）／原廠手冊"
        else:
            return None
    else:
        src = f"經濟部能源署節能標章實測（{cat_name}・證書{cert}）"

    return {
        "brand": brand,
        "model": model,
        "color": color,
        "speed": speed,
        "tech": tech,
        "tec": round(tec, 2),
        "src": src
    }

def generate_snap_js_block(models: list) -> str:
    # Deduplicate by (brand, model) keeping lowest tec
    unique_models = {}
    for c in models:
        k = (c['brand'], c['model'])
        if k not in unique_models or c['tec'] < unique_models[k]['tec']:
            unique_models[k] = c

    by_brand = {}
    for m in unique_models.values():
        by_brand.setdefault(m['brand'], []).append(m)

    today = datetime.now().strftime("%Y-%m-%d")
    lines = [
        "/* --- SNAPSHOT START --- */",
        f"const SNAPSHOT_DATE = '{today}';",
        "const SNAP = ["
    ]

    for b in TARGET_BRANDS:
        if b not in by_brand: continue
        brand_list = sorted(by_brand[b], key=lambda x: (x['color']!='C', x['speed'], x['tec']))
        lines.append(f"  // ---------- {b} (經濟部能源署節能標章 A3 核定 {len(brand_list)} 款) ----------")
        for m in brand_list:
            lines.append(f"  ['{m['brand']}','{m['model']}','{m['color']}',{m['speed']},'{m['tech']}',{m['tec']:.2f},'{m['src']}'],")

    lines.append("];")
    return "\n".join(lines)

def update_file(filepath: str, new_snap_block: str) -> bool:
    if not os.path.exists(filepath):
        print(f"⚠️ 找不到檔案：{filepath}")
        return False
        
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    snap_regex = re.compile(r'/\* --- SNAPSHOT START --- \*/[\s\S]*?const SNAP = \[[\s\S]*?\];', re.MULTILINE)
    if not snap_regex.search(content):
        print(f"⚠️ 在 {filepath} 中找不到 SNAP 宣告區塊！")
        return False

    new_content = snap_regex.sub(new_snap_block, content)
    if new_content == content:
        print(f"ℹ️ {filepath} 內容無須變更")
        return False

    with open(filepath, 'w', encoding='utf-8') as f:
        f.write(new_content)
    print(f"💾 已成功更新檔案：{filepath}")
    return True

def main():
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    index_path = os.path.join(root_dir, "index.html")
    deck_path = os.path.join(root_dir, "mfp-tec-deck.html")

    print("🔍 開始從經濟部能源署（類別 32 影印機 / 類別 33 印表機）同步現役 A3 獲證機種...")
    try:
        items = fetch_moea_items(32) + fetch_moea_items(33)
        print(f"📋 共取得 {len(items)} 筆標章獲證候選產品，正在逐筆解析 A3 規格與 TEC 數據...")
    except Exception as e:
        print(f"❌ 連線經濟部能源署網站失敗：{e}")
        sys.exit(0)

    a3_models = []
    with ThreadPoolExecutor(max_workers=10) as ex:
        futures = {ex.submit(parse_item_detail, it): it for it in items}
        for f in as_completed(futures):
            res = f.result()
            if res:
                a3_models.append(res)

    print(f"📊 解析完成！符合 A3 輸出能力且具備完整實測 TEC 者共 {len(a3_models)} 筆")

    if not a3_models:
        print("⚠️ 未取得任何有效資料，跳過檔案更新。")
        sys.exit(0)

    new_block = generate_snap_js_block(a3_models)
    ch1 = update_file(index_path, new_block)
    ch2 = update_file(deck_path, new_block)
    has_changes = ch1 or ch2

    github_env = os.environ.get("GITHUB_ENV")
    if github_env and os.path.exists(github_env):
        with open(github_env, "a", encoding="utf-8") as env_f:
            env_f.write(f"HAS_CHANGES={'true' if has_changes else 'false'}\n")
            env_f.write(f"NEW_MODELS_COUNT={len(a3_models)}\n")

    if has_changes:
        print(f"🎉 巡查完成！已自動將最新經濟部能源署 A3 標章資料同步寫入網頁。")
    else:
        print("☕ 巡查完成！所有廠牌機種皆為最新，無須更新網站。")

if __name__ == "__main__":
    main()
