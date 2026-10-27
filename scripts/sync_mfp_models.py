#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
事務機新機型每月自動巡查與快照更新腳本 (Monthly MFP Models Sync)
1. 從美國能源之星 (ENERGY STAR) SODA API 抓取各品牌最新認證多功能事務機 (MFD)
2. 比對現有資料庫，保留台灣各原廠官網規格（如 Epson EM-C8101、AM-C4000 等）
3. 若發現新機型或 TEC 更新，自動同步寫入 index.html 與 mfp-tec-deck.html
"""

import os
import re
import sys
import json
import urllib.request
import urllib.parse
from datetime import datetime

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

API_URL = "https://data.energystar.gov/resource/t2v6-g4nf.json"
TARGET_BRANDS = [
    "RICOH", "EPSON", "FUJIFILM", "FUJI XEROX", "CANON",
    "HP", "KONICA MINOLTA", "SHARP", "KYOCERA", "TOSHIBA", "BROTHER"
]

def standardize_brand(raw_brand: str) -> str:
    b = (raw_brand or "").strip().upper()
    if "RICOH" in b: return "Ricoh"
    if "EPSON" in b: return "Epson"
    if "FUJIFILM" in b or "FUJI XEROX" in b: return "FUJIFILM"
    if "CANON" in b: return "Canon"
    if "HP" in b or "HEWLETT" in b: return "HP"
    if "KONICA" in b: return "Konica Minolta"
    if "SHARP" in b: return "Sharp"
    if "KYOCERA" in b: return "KYOCERA"
    if "TOSHIBA" in b: return "Toshiba"
    if "BROTHER" in b: return "Brother"
    return (raw_brand or "").strip().title()

def fetch_energy_star_models():
    # 注意：ENERGY STAR SODA API 資料集欄位 product_type 為複數 'Multifunction Devices (MFD)'
    where_clause = "product_type = 'Multifunction Devices (MFD)' AND typical_electricity_consumption_tec_kwh_wk IS NOT NULL"
    params = {
        "$limit": "3000",
        "$where": where_clause,
        "$order": "typical_electricity_consumption_tec_kwh_wk ASC"
    }
    url = f"{API_URL}?{urllib.parse.urlencode(params)}"
    print(f"📡 正在連線能源之星 API 巡查最新認證機種...")
    
    req = urllib.request.Request(url, headers={"User-Agent": "MFP-Sync-Bot/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        if resp.status != 200:
            raise RuntimeError(f"API 回應狀態碼異常：{resp.status}")
        data = json.loads(resp.read().decode('utf-8'))
    print(f"✅ 成功自能源之星取得 {len(data)} 筆認證記錄")
    return data

def extract_current_snap(content: str):
    m = re.search(r"const\s+SNAP\s*=\s*\[(.*?)\];\s*\n/\*", content, re.DOTALL)
    if not m:
        m = re.search(r"const\s+SNAP\s*=\s*\[(.*?)\];", content, re.DOTALL)
    if not m:
        return []
    
    raw = m.group(1)
    models = []
    # 逐行提取每條記錄 ['Brand','Model','C',Speed,'Tech',TEC,'Src']
    pattern = re.compile(r"\[\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*(\d+(?:\.\d+)?)\s*,\s*'([^']+)'\s*,\s*(\d+(?:\.\d+)?)\s*,\s*'([^']+)'\s*\]")
    for item in pattern.finditer(raw):
        models.append({
            "brand": item.group(1),
            "model": item.group(2),
            "color": item.group(3),
            "speed": int(float(item.group(4))),
            "tech": item.group(5),
            "tec": float(item.group(6)),
            "src": item.group(7)
        })
    return models

def build_new_snap_list(existing_models, api_data):
    master = {}
    
    # 1. 保留所有官網撈取及手動認證之特有機種（如 Epson EM-C8101, EM-C8100, WF-C878R, AM-C4000 等）
    for m in existing_models:
        k = (m["brand"].upper(), m["model"].upper())
        master[k] = m

    new_count = 0
    # 2. 融合 API 抓取之最新機種
    for row in api_data:
        raw_b = row.get("brand_name", "")
        brand = standardize_brand(raw_b)
        if brand.upper() not in TARGET_BRANDS:
            continue
            
        model = (row.get("model_name") or row.get("model_number") or "").strip()
        if not model:
            continue
            
        try:
            tec = float(row.get("typical_electricity_consumption_tec_kwh_wk", 0))
            if tec <= 0 or tec > 15:
                continue
        except (ValueError, TypeError):
            continue

        color_type = "C" if "COLOR" in (row.get("print_color", "") or "").upper() else "M"
        
        speed = 25
        try:
            s_val = (
                row.get("monochrome_product_speed_ipm_or_mppm") or 
                row.get("monochrome_speed_ipm") or 
                row.get("speed_ipm") or 
                row.get("color_speed_ipm")
            )
            if s_val:
                speed = int(float(s_val))
        except (ValueError, TypeError):
            pass

        tech = row.get("marking_technology", "EP")
        if "INK" in tech.upper():
            tech = "HPIJ"
        else:
            tech = "EP"

        k = (brand.upper(), model.upper())
        if k not in master:
            master[k] = {
                "brand": brand,
                "model": model,
                "color": color_type,
                "speed": speed,
                "tech": tech,
                "tec": round(tec, 2),
                "src": "ENERGY STAR 官方認證"
            }
            new_count += 1
            print(f"✨ 發現新機種加入：{brand} {model} (TEC {tec:.2f}, {speed} ipm)")

    # 3. 排序輸出
    brand_order = ["Epson", "Ricoh", "FUJIFILM", "Canon", "HP", "Konica Minolta", "Sharp", "KYOCERA", "Toshiba", "Brother"]
    def sort_key(m):
        # 置頂指標機種
        if m["model"] in ("EM-C8101", "IM C2010"): return (-100, m["tec"])
        if m["model"] == "AM-C4000": return (-95, m["tec"])
        b_idx = brand_order.index(m["brand"]) if m["brand"] in brand_order else 99
        return (b_idx, m["tec"])

    sorted_list = sorted(master.values(), key=sort_key)
    return sorted_list, new_count

def generate_snap_js_block(snap_list):
    today_str = datetime.now().strftime("%Y-%m-%d")
    lines = [
        "/* --- SNAPSHOT START --- */",
        f"const SNAPSHOT_DATE = '{today_str}';",
        "const SNAP = ["
    ]
    
    current_brand = None
    for m in snap_list:
        b = m["brand"]
        if b != current_brand:
            current_brand = b
            lines.append(f"  // ---------- {b} ----------")
        item_str = f"  ['{m['brand']}','{m['model']}','{m['color']}',{m['speed']},'{m['tech']}',{m['tec']:.2f},'{m['src']}'],"
        lines.append(item_str)
        
    lines.append("];")
    lines.append("/* --- SNAPSHOT END --- */")
    return "\n".join(lines)

def update_file(filepath, new_block):
    if not os.path.exists(filepath):
        print(f"⚠️ 找不到檔案：{filepath}")
        return False
        
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    pattern = re.compile(r"/\*\s*---\s*SNAPSHOT START\s*---\s*\*/.*?/\*\s*---\s*SNAPSHOT END\s*---\s*\*/", re.DOTALL)
    if not pattern.search(content):
        pattern = re.compile(r"const\s+SNAPSHOT_DATE\s*=\s*'[^']+';\s*\nconst\s+SNAP\s*=\s*\[.*?\n\];", re.DOTALL)
        if not pattern.search(content):
            print(f"⚠️ 在 {filepath} 中找不到 SNAP 宣告區塊！")
            return False

    new_content = pattern.sub(new_block, content)
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

    if not os.path.exists(index_path):
        print(f"❌ 找不到 index.html（路徑：{index_path}）")
        sys.exit(1)

    with open(index_path, 'r', encoding='utf-8') as f:
        index_content = f.read()

    existing_models = extract_current_snap(index_content)
    print(f"📋 目前資料庫共有 {len(existing_models)} 款基準機型")

    try:
        api_data = fetch_energy_star_models()
    except Exception as e:
        print(f"❌ 連線能源之星 API 失敗：{e}")
        sys.exit(0)

    updated_snap_list, new_count = build_new_snap_list(existing_models, api_data)
    print(f"📊 整合後資料庫共有 {len(updated_snap_list)} 款機型（本次新增：{new_count} 款）")

    has_changes = False
    if new_count > 0 or len(updated_snap_list) != len(existing_models):
        new_block = generate_snap_js_block(updated_snap_list)
        ch1 = update_file(index_path, new_block)
        ch2 = update_file(deck_path, new_block)
        has_changes = ch1 or ch2

    # 設定 GitHub Actions 環境變數輸出
    github_env = os.environ.get("GITHUB_ENV")
    if github_env and os.path.exists(github_env):
        with open(github_env, "a", encoding="utf-8") as env_f:
            env_f.write(f"HAS_CHANGES={'true' if has_changes else 'false'}\n")
            env_f.write(f"NEW_MODELS_COUNT={new_count}\n")

    if has_changes:
        print(f"🎉 巡查完成！共偵測到 {new_count} 款新機型，已自動同步更新網站原始碼。")
    else:
        print("☕ 巡查完成！所有廠牌機種皆為最新，無須更新網站。")

if __name__ == "__main__":
    main()
