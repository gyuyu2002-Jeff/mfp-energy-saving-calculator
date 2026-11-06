#!/usr/bin/env python3
"""Snapshot MOEA copier/printer records without substituting limits for measured TEC.

Requires beautifulsoup4. Run normally to refresh, or --offline to rebuild JSON
from the committed, hashed HTML evidence. Conflicting certificates remain separate.
"""

import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import datetime, timezone
import gzip
import hashlib
import io
import json
import math
from pathlib import Path
import re
import time
from urllib.parse import parse_qs, unquote, urljoin, urlparse
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup


ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data" / "energylabel-evidence"
OUTPUT = ROOT / "data" / "energylabel-verified.json"
BASE = "https://ea03.moeaea.gov.tw/e0410/01/purchasing/product/"
LISTS = [(32, "影印機"), (33, "印表機")]


def compact(text):
    return re.sub(r"\s+", " ", text).strip()


def download(url, name):
    for attempt in range(3):
        try:
            request = Request(url, headers={"User-Agent": "MFP-Energy-Data-Audit/1.0"})
            # urllib's default SSL context validates certificates and host names.
            with urlopen(request, timeout=30) as response:
                body = response.read()
                final_url = response.url
            break
        except OSError:
            if attempt == 2:
                raise
            time.sleep(attempt + 1)
    content = body.decode("utf-8-sig")
    is_csv = name.endswith(".csv.gz")
    if (is_csv and "測試報告能源效率" not in content) or (not is_csv and "節能" not in BeautifulSoup(content, "html.parser").get_text()):
        raise ValueError(f"Unexpected source page: {url}")
    (EVIDENCE / name).write_bytes(gzip.compress(body, mtime=0))
    return {
        "url": url,
        "finalUrl": final_url,
        "file": name,
        "sha256": hashlib.sha256(body).hexdigest(),
        "fetchedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


def read_bytes(entry):
    body = gzip.decompress((EVIDENCE / entry["file"]).read_bytes())
    if hashlib.sha256(body).hexdigest() != entry["sha256"]:
        raise ValueError(f"Evidence hash mismatch: {entry['file']}")
    return body


def read_evidence(entry):
    return BeautifulSoup(read_bytes(entry).decode("utf-8-sig"), "html.parser")


def list_items(entry, category, category_name):
    items = []
    soup = read_evidence(entry)
    for row in soup.select("table tr"):
        cells = row.find_all(["td", "th"], recursive=False)
        if len(cells) < 2:
            continue
        for link in cells[1].select('a[href*="itemp0="]'):
            url = urljoin(entry["url"], link["href"])
            item_id = parse_qs(urlparse(url).query)["itemp0"][0]
            items.append({
                "model": compact(link.get_text()),
                "company": compact(cells[0].get_text()),
                "category": category,
                "categoryName": category_name,
                "id": item_id,
                "url": url,
            })
    if not items:
        raise ValueError(f"No product details found in category {category}")
    return items


def number(text):
    text = text.strip().replace(",", "")
    if not re.fullmatch(r"\d+(?:\.\d+)?", text):
        return None
    value = float(text)
    return value if math.isfinite(value) else None


def brand_name(raw):
    aliases = {
        "RICOH": "Ricoh", "EPSON": "Epson", "CANON": "Canon",
        "KYOCERA": "KYOCERA", "SHARP": "Sharp", "TOSHIBA": "Toshiba",
        "KONICA MINOLTA": "Konica Minolta", "FUJIFILM": "FUJIFILM",
        "FUJI XEROX": "FUJIFILM", "HP": "HP", "DEVELOP": "DEVELOP",
        "台灣愛普生(EPSON)": "Epson", "東芝(TOSHIBA)": "Toshiba",
    }
    return aliases.get(compact(raw).upper(), compact(raw))


def parse_detail(item, evidence):
    soup = read_evidence(evidence)
    fields = {}
    for title in soup.select(".dtitle"):
        sibling = title.find_next_sibling("div")
        if sibling is not None:
            key = re.sub(r"[\s：:]", "", title.get_text())
            fields[key] = compact(sibling.get_text(" ", strip=True))
    if not fields.get("型號") or not fields.get("證書號碼"):
        raise ValueError(f"Product detail layout changed: {item['url']}")
    tec = number(fields.get("典型用電量TEC(度/週)實測值", ""))
    dates = re.findall(r"\d{4}/\d{2}/\d{2}", fields.get("證書有效期限", ""))
    product_type = fields.get("影印機種類", "") or fields.get("印表機種類", "")
    technology = fields.get("顯像技術", "") or fields.get("符合之顯像技術", "")
    tech = None
    if re.search(r"(?<![A-Z])EP(?![A-Z])", technology):
        tech = "EP"
    elif re.search(r"HPIJ|高效能噴墨", technology):
        tech = "HPIJ"
    elif re.search(r"(?<![A-Z])IJ(?![A-Z])|噴墨", technology):
        tech = "IJ"
    record = {
        "brand": brand_name(fields.get("廠牌名稱", "")),
        "model": fields["型號"],
        "tec": tec,
        "unit": "kWh/week",
        "source": "moea",
        "sourceUrl": item["url"],
        "sourceRecordId": item["id"],
        "standard": fields.get("試驗標準") or fields.get("測試標準") or None,
        "voltage": fields.get("試驗電壓") or fields.get("測試電壓") or None,
        "certificate": fields["證書號碼"],
        "validFrom": dates[0].replace("/", "-") if dates else None,
        "validUntil": dates[-1].replace("/", "-") if len(dates) > 1 else None,
        "checkedAt": evidence["fetchedAt"],
        "notes": ["採用官方明細的典型用電量 TEC 實測值；能源效率基準未用於計算。",
                  "明細未直接載明測試版本或電壓時保留空值，不由證書年份、DFE 欄位或品牌推定。"],
        "color": "Color" if "彩色" in product_type else "Mono" if any(x in product_type for x in ("單色", "黑白")) else None,
        "speed": number(fields.get("產品速度(ipm)", "")),
        "tech": tech,
        "a3": {"是": True, "否": False}.get(fields.get("是否具備A3紙張輸出能力")),
        "category": item["category"],
        "company": item["company"],
        "evidencePath": "data/energylabel-evidence/" + evidence["file"],
        "evidenceSha256": evidence["sha256"],
        "rawFields": fields,
    }
    if tec is None or tec <= 0:
        record["reason"] = "官方產品明細未提供可用的正數 TEC 實測值；未以待機功率、門檻或原廠數字替代。"
        return None, record
    return record, None


def fetch_csvs():
    index = download("https://ea03.moeaea.gov.tw/e0410/01/other/opendata/list.aspx", "opendata-index.html.gz")
    soup = read_evidence(index)
    entries = []
    for category, name in LISTS:
        link = next((a for a in soup.select("a[href]")
                     if f"_{name}節能標章有效獲證資訊.csv" in unquote(a["href"])), None)
        if link is None:
            raise ValueError(f"No official CSV link for category {category}")
        evidence = download(urljoin(index["url"], link["href"]), f"category-{category}.csv.gz")
        evidence.update(category=category, categoryName=name)
        entries.append(evidence)
    return index, entries


def crosscheck_csvs(entries, records, missing):
    """Check matching certificates and retain CSV-only products without guessing specs."""
    key_of = lambda model, certificate: (re.sub(r"\s+", "", model), certificate)
    by_key = {key_of(r["model"], r["certificate"]): r for r in records + missing}
    discrepancies = []
    matched = 0
    for evidence in entries:
        rows = csv.DictReader(io.StringIO(read_bytes(evidence).decode("utf-8-sig")))
        for row in rows:
            model, certificate = row["產品型號"].strip(), row["合約編號"].strip()
            match = re.search(r"(?:^|[，,])\s*TEC(?:實測值\(度/週\))?\s*=\s*(\d+(?:\.\d+)?)", row["測試報告能源效率"])
            tec = float(match[1]) if match else None
            key = key_of(model, certificate)
            if key in by_key:
                matched += 1
                target = by_key[key]
                target["csvEvidencePath"] = "data/energylabel-evidence/" + evidence["file"]
                if target["tec"] != tec:
                    discrepancies.append({"model": model, "certificate": certificate, "detailTec": target["tec"], "csvTec": tec})
                    target["needsReview"] = True
                    target["sourceConflict"] = {"detailTec": target["tec"], "csvTec": tec}
                    target["notes"].append("官方明細與 CSV 的 TEC 不一致，需人工查核。")
                continue
            dates = [row.get(k, "").strip() for k in ("起約日期", "迄約日期")]
            dates = [f"{d[:4]}-{d[4:6]}-{d[6:]}" if re.fullmatch(r"\d{8}", d) else None for d in dates]
            target = {
                "brand": brand_name(row["商標名稱"]), "model": model, "tec": tec,
                "unit": "kWh/week", "source": "moea", "sourceUrl": evidence["url"],
                "sourceRecordId": f"csv:{evidence['category']}:{certificate}:{model}",
                "standard": None, "voltage": None, "certificate": certificate,
                "validFrom": dates[0], "validUntil": dates[1], "checkedAt": evidence["fetchedAt"],
                "notes": ["此筆見於官方 CSV，未見同日產品明細清單；只採用測試報告能源效率的 TEC 實測值，其他規格未知。"],
                "color": None, "speed": None, "tech": None, "a3": None,
                "category": evidence["category"], "company": row["標示使用公司"],
                "evidencePath": "data/energylabel-evidence/" + evidence["file"],
                "evidenceSha256": evidence["sha256"], "rawFields": row,
            }
            if tec is None or tec <= 0:
                target["reason"] = "官方 CSV 未提供可用的正數 TEC 實測值。"
                missing.append(target)
            else:
                records.append(target)
    return {"matchedCertificateRecords": matched, "discrepancies": discrepancies}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true", help="Rebuild using saved HTML, without network access")
    args = parser.parse_args()
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    manifest_path = EVIDENCE / "manifest.json"
    if args.offline:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    else:
        manifest = {"lists": [], "items": []}
        items = []
        for category, category_name in LISTS:
            url = BASE + f"upt.aspx?p0={category}&pageno=0"
            entry = download(url, f"category-{category}.html.gz")
            entry.update(category=category, categoryName=category_name)
            manifest["lists"].append(entry)
            items.extend(list_items(entry, category, category_name))
        # Keep distinct certificates; never resolve duplicates by choosing minimum TEC.
        unique = {item["id"]: item for item in items}
        print(f"Fetching {len(unique)} official details (4 concurrent requests).", flush=True)
        def fetch_item(item):
            evidence = download(item["url"], f"item-{item['id']}.html.gz")
            return {"item": item, "evidence": evidence}
        with ThreadPoolExecutor(max_workers=4) as executor:
            for count, result in enumerate(executor.map(fetch_item, unique.values()), 1):
                manifest["items"].append(result)
                if count % 50 == 0:
                    print(f"Fetched {count}/{len(unique)} details.", flush=True)
        manifest["opendataIndex"], manifest["csvs"] = fetch_csvs()
        manifest["checkedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    records, missing = [], []
    for entry in manifest["items"]:
        record, unavailable = parse_detail(entry["item"], entry["evidence"])
        (records if record else missing).append(record or unavailable)
    crosscheck = crosscheck_csvs(manifest["csvs"], records, missing)
    output = {
        "checkedAt": manifest["checkedAt"],
        "sources": [{"source": "moea", "url": x["url"], "category": x["category"],
                     "evidencePath": "data/energylabel-evidence/" + x["file"], "sha256": x["sha256"]}
                    for x in manifest["lists"] + manifest["csvs"]],
        "crosscheck": crosscheck,
        "records": sorted(records, key=lambda x: (x["brand"], x["model"], x["sourceRecordId"])),
        "missing": sorted(missing, key=lambda x: (x["brand"], x["model"], x["sourceRecordId"])),
        "limitations": [
            "本快照涵蓋擷取日類別 32 與 33 的有效獲證清單，並非全部歷史機型；查無紀錄不代表未曾獲證。",
            "保留同型號的不同證書紀錄，未選取最低 TEC；若數值不同，應由使用者依證書與設備版本選擇。",
            "未公開逐筆測試版本與電壓者保留 null；不得將政府值標成 ENERGY STAR v3.0 或 110V 實測。",
            "missing 僅列出官方清單中無可用 TEC 的紀錄；未出現在有效清單的舊型號需另查 ENERGY STAR。",
            "CSV 與產品明細清單可能有更新時間差；CSV 獨有紀錄保留，但未刊載的產品規格不推定。",
        ],
    }
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(records)} measured TEC records; {len(missing)} records without usable TEC.")


if __name__ == "__main__":
    main()
