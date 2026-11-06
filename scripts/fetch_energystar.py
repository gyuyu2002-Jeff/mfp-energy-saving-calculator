#!/usr/bin/env python3
"""Fetch official ENERGY STAR weekly TEC evidence; never infer TEC from watts.

Requires openpyxl for EPA's archived workbook. Run with --offline to reproduce
the normalized JSON from the preserved evidence without refreshing sources.
"""

import argparse
import hashlib
import json
import math
import re
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

import openpyxl

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "data" / "energystar-evidence"
OUTPUT = ROOT / "data" / "energystar-verified.json"
SCHEMA_URL = "https://data.energystar.gov/api/views/t2v6-g4nf.json"
API_URL = "https://data.energystar.gov/resource/t2v6-g4nf.json"
ARCHIVE_URL = "https://www.energystar.gov/sites/default/files/asset/document/ImagingEquipment_V2.0_Archived_0.xlsx"
PARTNERS_URL = "https://www.energystar.gov/products/imaging_equipment/partners"
TEC_FIELD = "typical_electricity_consumption_tec_kwh_wk"
BRANDS = {b.casefold(): b for b in (
    "Epson", "Ricoh", "FUJIFILM", "Canon", "KYOCERA", "Sharp",
    "Konica Minolta", "Toshiba", "HP", "DEVELOP",
)}
BRANDS.update({"fuji xerox": "FUJIFILM", "hp inc.": "HP"})
TECH = {"Electro-photographic (EP)": "EP", "High Performance IJ": "HPIJ", "Ink Jet (IJ)": "IJ"}


def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def get(url):
    request = urllib.request.Request(url, headers={"User-Agent": "MFP-TEC-Evidence/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def fetch():
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    checked = datetime.now(timezone.utc).isoformat(timespec="seconds")
    files = []
    for name, url in [("schema.json", SCHEMA_URL), ("historical-v2.xlsx", ARCHIVE_URL)]:
        raw = get(url)
        (EVIDENCE / name).write_bytes(raw)
        files.append({"file": name, "url": url, "sha256": hashlib.sha256(raw).hexdigest()})
    rows = []
    offset = 0
    while True:
        url = API_URL + "?" + urllib.parse.urlencode({"$limit": 10000, "$offset": offset, "$order": "pd_id"})
        raw = get(url)
        page = json.loads(raw)
        if not isinstance(page, list):
            raise ValueError("ENERGY STAR API did not return a row list")
        name = f"current-page-{offset:05d}.json"
        (EVIDENCE / name).write_bytes(raw)
        files.append({"file": name, "url": url, "sha256": hashlib.sha256(raw).hexdigest()})
        rows.extend(page)
        if len(page) < 10000:
            break
        offset += len(page)
    if not rows:
        raise ValueError("Empty official dataset; previous normalized output has not been replaced")
    dump(EVIDENCE / "current-raw.json", rows)
    dump(EVIDENCE / "manifest.json", {"checkedAt": checked, "files": files})


def number(value):
    try:
        value = float(value)
        return value if math.isfinite(value) and value > 0 else None
    except (TypeError, ValueError):
        return None


def norm(value):
    # Preserve suffixes and punctuation: C2503 is not C2503SP, nor C2500G C2500.
    return re.sub(r"\s+", " ", str(value or "").strip()).casefold()


def requested_models():
    inventory = ROOT / 'data' / 'requested-models.json'
    if inventory.exists():
        return json.loads(inventory.read_text(encoding='utf-8'))
    path = EVIDENCE / "requested-models.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    app = ROOT / "assets" / "app.js"
    text = (app if app.exists() else ROOT / "index.html").read_text(encoding="utf-8")
    pairs = set(re.findall(r"\['([^']+)'\s*,\s*'([^']+)'\s*,\s*'[CM]'", text))
    legacy = re.search(r"const LEGACY_MODELS = \{([\s\S]*?)\n\};", text)
    if legacy:
        brand = None
        for line in legacy.group(1).splitlines():
            match = re.match(r"\s*(?:'([^']+)'|([\w]+)):\s*\[", line)
            if match:
                brand = match.group(1) or match.group(2)
            model = re.search(r"model:\s*'([^']+)'", line)
            if model and brand and brand != "PRESET":
                pairs.add((brand, model.group(1)))
    result = [{"brand": b, "model": m} for b, m in sorted(pairs)]
    if not result:
        raise ValueError("No original site model inventory found")
    dump(path, result)
    return result


def historical_rows():
    workbook = openpyxl.load_workbook(EVIDENCE / "historical-v2.xlsx", read_only=True, data_only=True)
    sheet = workbook.active
    header = next(sheet.iter_rows(min_row=4, max_row=4, values_only=True))
    expected = {0: "PD_ID", 2: "Brand Name", 12: "Typical Electricity Consumption (TEC) (kWh/wk)"}
    if any(header[index] != value for index, value in expected.items()):
        raise ValueError("Historical workbook schema changed")
    mapping = {
        0: "pd_id", 2: "brand_name", 3: "model_name", 4: "model_number",
        5: "additional_model_information", 6: "product_type", 7: "size_format",
        8: "marking_technology", 9: "color_capability", 10: "monochrome_product_speed_ipm_or_mppm",
        12: TEC_FIELD, 13: "typical_electricity_consumption_tec_kwh_yr",
        14: "power_in_sleep_w", 29: "markets", 30: "energy_star_model_identifier",
    }
    result = []
    for row_number, row in enumerate(sheet.iter_rows(min_row=5, values_only=True), 5):
        if row[0] is not None:
            result.append({**{key: row[index] for index, key in mapping.items()}, "archiveRow": row_number})
    workbook.close()
    return result


def normalize(row, dataset, checked):
    brand = BRANDS.get(norm(row.get("brand_name")))
    if not brand:
        return None
    tec = number(row.get(TEC_FIELD))
    model = str(row.get("model_name") or row.get("model_number") or "").strip()
    if not model:
        return None
    aliases = list(dict.fromkeys(str(row[k]).strip() for k in ("model_name", "model_number") if row.get(k)))
    historical = dataset == "historical-v2"
    record_id = str(row["pd_id"])
    standard = "ENERGY STAR v2.0 (archived list)" if historical else "ENERGY STAR v3.0/v3.1/v3.2 (individual version unpublished)"
    notes = [
        "Official dataset does not publish test voltage; do not assume Taiwan 110 V/60 Hz.",
        "ENERGY STAR Standard media format includes A3 and A4; A3 capability is not established by this record.",
    ]
    if historical:
        notes.append("Historical list posted before 2019-10-11; not evidence of current certification. Retain published weekly precision without annual-value conversion.")
    else:
        notes.append("The API names this measured field TEC (kWh/wk), not a separate TEC_2018 column. Per-record v3.0/v3.1/v3.2 is not disclosed.")
    if row.get("additional_model_information"):
        notes.append("Additional family descriptions are preserved in raw evidence and are not automatically treated as exact model aliases.")
    return {
        "brand": brand, "sourceBrand": row.get("brand_name"), "model": model, "modelAliases": aliases,
        "tec": tec, "unit": "kWh/week", "source": "energystar",
        "sourceUrl": ARCHIVE_URL if historical else API_URL + "?" + urllib.parse.urlencode({"pd_id": record_id}),
        "sourceRecordId": record_id, "sourceDataset": dataset,
        "sourceField": "Typical Electricity Consumption (TEC) (kWh/wk)" if historical else TEC_FIELD,
        "standard": standard, "voltage": None,
        "certificate": row.get("energy_star_model_identifier") or None, "validUntil": None,
        "checkedAt": checked, "notes": notes,
        "color": {"Color": "Color", "Monochrome": "Mono"}.get(row.get("color_capability")),
        "speed": number(row.get("monochrome_product_speed_ipm_or_mppm")),
        "tech": TECH.get(row.get("marking_technology")), "a3": None,
        "markets": row.get("markets") or None, "productType": row.get("product_type"),
        "sizeFormat": row.get("size_format"), "archived": historical,
        "remanufactured": str(row.get('remanufactured_product', '')).lower() == 'yes',
        **({"archiveRow": row["archiveRow"]} if historical else {}),
    }


def build():
    manifest = json.loads((EVIDENCE / "manifest.json").read_text(encoding="utf-8"))
    checked = manifest["checkedAt"]
    schema = json.loads((EVIDENCE / "schema.json").read_text(encoding="utf-8"))
    fields = {column["fieldName"]: column for column in schema["columns"]}
    if fields.get(TEC_FIELD, {}).get("name") != "Typical Electricity Consumption (TEC) (kWh/wk)":
        raise ValueError("Official measured weekly TEC schema changed; refusing to guess a replacement field")
    current = json.loads((EVIDENCE / "current-raw.json").read_text(encoding="utf-8"))
    historical = historical_rows()
    all_records = []
    for dataset, rows in [("t2v6-g4nf", current), ("historical-v2", historical)]:
        for row in rows:
            item = normalize(row, dataset, checked)
            if item:
                all_records.append(item)
    records = [record for record in all_records if record["tec"] is not None]
    groups = defaultdict(list)
    for record in records:
        groups[(norm(record["brand"]), norm(record["model"]))].append(record)
    for group in groups.values():
        variants = {(r["tec"], r["standard"], r["markets"]) for r in group}
        if len(variants) > 1:
            note = "Multiple official records exist for this exact brand/model; all are preserved. Do not choose the minimum TEC or silently merge standards/markets."
            for record in group:
                record["notes"].append(note)
                record["ambiguous"] = True
    index = defaultdict(list)
    for record in all_records:
        for alias in record["modelAliases"]:
            index[(norm(record["brand"]), norm(alias))].append(record)
    missing = []
    requests = requested_models()
    for request in requests:
        matches = index[(norm(request["brand"]), norm(request["model"]))]
        if not any(record["tec"] is not None for record in matches):
            missing.append({
                **request,
                "reason": "Official exact-match records do not publish measured weekly TEC (OM watts are not TEC)." if matches else "No exact model/brand match in current or archived official datasets. No suffix or regional-model substitution was made.",
                "sourceRecordIds": list(dict.fromkeys(r["sourceRecordId"] for r in matches)),
            })
    result = {
        "checkedAt": checked,
        "sources": [
            {"id": "t2v6-g4nf", "url": API_URL, "schemaUrl": SCHEMA_URL, "description": schema.get("description"), "rawFile": "energystar-evidence/current-raw.json", "rowCount": len(current)},
            {"id": "historical-v2", "url": ARCHIVE_URL, "linkedFrom": PARTNERS_URL, "rawFile": "energystar-evidence/historical-v2.xlsx", "rowCount": len(historical)},
        ],
        "records": sorted(records, key=lambda r: (r["brand"], r["model"], r["archived"], r["sourceRecordId"])),
        "missing": missing,
        "limitations": [
            "Only positive measured weekly TEC values are normalized. OM sleep/off watts, DFE TEC, annual TEC, requirements and maximum limits are never substituted.",
            "Current API covers versions 3.0, 3.1 and 3.2 but does not disclose per-record version, voltage or expiry. Missing fields remain null; certification identifiers are ENERGY STAR CB identifiers, not Taiwan certificates.",
            "A3 capability is not published: Standard media can mean A4 or A3. All a3 values remain null and require independent official confirmation before an A3-only list.",
            "All distinct current and archived records are retained, including conflicting weekly TEC/market/standard variants. No minimum-value deduplication or regional/suffix alias guessing is performed.",
            "Archive heading identifies v2.0 but may contain transition-era records overlapping current ESUIDs; preserve the dataset provenance and do not assume cross-version comparability.",
            "Historical weekly values can have lower published precision than annual values; no extra precision is invented by dividing annual TEC by 52.",
            "Model matching uses exact names/numbers after case and whitespace normalization. Additional family descriptions and similar regional model names require manual review.",
        ],
        "coverage": {"requestedModels": len(requests), "withExactMeasuredTec": len(requests) - len(missing), "missing": len(missing)},
    }
    dump(OUTPUT, result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--offline", action="store_true")
    args = parser.parse_args()
    if not args.offline:
        fetch()
    result = build()
    print(json.dumps({"records": len(result["records"]), **result["coverage"]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
