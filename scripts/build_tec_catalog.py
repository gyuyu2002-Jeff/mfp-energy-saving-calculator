#!/usr/bin/env python3
"""Build the browser snapshot from checked official evidence, without network access."""
import json
import re
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

def identity(brand, model):
    # Normalize typography only. Never drop regional suffixes or infer equivalent models.
    return (re.sub(r'[^A-Z0-9]', '', brand.upper()), re.sub(r'[^A-Z0-9]', '', model.upper()))

def record_keys(record):
    return {identity(record['brand'], model) for model in [record['model'], *record.get('modelAliases', [])]}

def build_catalog(moea, energy_star, requested):
    requested_keys = {identity(m['brand'], m['model']) for m in requested}
    government_keys = set().union(*(record_keys(r) for r in moea['records']))
    missing_tec_keys = set().union(*(record_keys(r) for r in moea.get('missing', [])))
    today = date.fromisoformat(moea['checkedAt'][:10])
    selected = []
    excluded = []
    for record in moea['records']:
        relevant = record.get('a3') is True or bool(record_keys(record) & requested_keys)
        if not relevant or record.get('a3') is False:
            continue
        if record.get('sourceConflict') or record.get('needsReview'):
            excluded.append({**record, 'reason': '官方明細與開放資料實測值不一致，暫不自動採用'})
            continue
        if record.get('validUntil') and date.fromisoformat(record['validUntil']) < today:
            excluded.append({**record, 'reason': '證書已逾期，需重新核實'})
            continue
        selected.append(dict(record))

    eligible_es = [r for r in energy_star['records'] if record_keys(r) & requested_keys and not record_keys(r) & government_keys]
    current_keys = set().union(*(record_keys(r) for r in eligible_es if not r.get('archived') and not r.get('remanufactured')))
    for record in eligible_es:
        if record.get('archived') and record_keys(record) & current_keys:
            continue
        copy = dict(record)
        matched_alias = next((name for name in [record['model'], *record.get('modelAliases', [])] if identity(record['brand'], name) in requested_keys), record['model'])
        copy['sourceModel'] = record['model']
        copy['model'] = matched_alias if record['model'].lower() in ['mfp (multi function printer)', 'multifunction printer', 'mfp'] else record['model']
        has_listing = bool(record_keys(record) & missing_tec_keys)
        copy['fallbackReason'] = ('能源署有獲證紀錄，但未公布可用的每週 TEC；採 ENERGY STAR 實測' if has_listing else '已查能源署影印機／印表機有效清單，未找到同型號實測 TEC；採 ENERGY STAR')
        copy['moeaCheckedAt'] = moea['checkedAt']
        # Keep the exact original notes in the evidence JSON; browser notes are localized.
        copy['notes'] = ['官方紀錄未明列逐筆測試電壓；不得假定為台灣 110V/60Hz。', 'Standard 紙張規格同時涵蓋 A3/A4，本筆未確認 A3 能力。']
        if record.get('archived'):
            copy['notes'].append('歷史清單僅供過往實測參考，不代表目前仍有效認證。')
        if record.get('ambiguous'):
            copy['notes'].append('同型號存在不同 TEC 紀錄，請依資料編號、設備版本與市場核對後選擇；不自動取最低值。')
        if record.get('remanufactured'):
            copy['notes'].append('官方標示為再製／翻新品，不能當作同名原版設備的實測值。')
        selected.append(copy)

    fields = ['brand','model','sourceModel','modelAliases','ambiguous','remanufactured','tec','unit','source','sourceUrl','sourceRecordId','standard','voltage','certificate','validFrom','validUntil','checkedAt','notes','color','speed','tech','a3','markets','archived','fallbackReason','moeaCheckedAt','sourceDataset','archiveRow']
    models, seen = [], set()
    for record in selected:
        item = {key: record.get(key) for key in fields}
        item['id'] = f"{item['source']}:{record.get('sourceDataset', 'label')}:{item['sourceRecordId']}:{record.get('archiveRow', '')}"
        if item['id'] in seen:
            continue
        seen.add(item['id'])
        item['src'] = '經濟部能源署實測' if item['source'] == 'moea' else 'ENERGY STAR 官方實測'
        item['std'] = item['standard'] or '來源未明列測試版本'
        item['color'] = 'Monochrome' if item['color'] in ['Mono', 'M', 'Monochrome'] else item['color']
        item['variantLabel'] = ('證書 ' + str(item['certificate'])) if item['source'] == 'moea' else ('歷史紀錄 ' if item['archived'] else 'ESUID ') + str(item['sourceRecordId'])
        models.append(item)
    models.sort(key=lambda m: (m['source'] != 'moea', m['brand'], m['model'], m['id']))
    selected_keys = set().union(*(record_keys(r) for r in selected))
    unresolved = []
    for key in sorted(requested_keys - selected_keys):
        row = next(m for m in requested if identity(m['brand'], m['model']) == key)
        reason = '未取得可核實的每週 TEC；未沿用舊站數值'
        if key in missing_tec_keys:
            reason = '能源署未公布每週 TEC，ENERGY STAR 亦無可用同型號 TEC；不將睡眠功率 W 換成 kWh/週'
        elif key in government_keys:
            reason = '政府紀錄存在，但非 A3、已逾期或來源衝突；未以 ENERGY STAR 覆蓋'
        unresolved.append({'brand': row['brand'], 'model': row['model'], 'reason': reason})
    return {
        'checkedAt': min(moea['checkedAt'][:10], energy_star['checkedAt'][:10]),
        'policy': '能源署實測優先；查無同型號可用實測 TEC 時才採 ENERGY STAR；同型號多筆紀錄不取最低值。',
        'models': models,
        'unresolved': unresolved,
        'excluded': [{'brand': r['brand'], 'model': r['model'], 'certificate': r.get('certificate'), 'sourceUrl': r['sourceUrl'], 'reason': r['reason']} for r in excluded],
        'counts': {'moea': sum(m['source']=='moea' for m in models), 'energystar': sum(m['source']=='energystar' for m in models), 'unresolvedModels': len(unresolved)}
    }

def main():
    read = lambda name: json.loads((ROOT / 'data' / name).read_text(encoding='utf-8'))
    catalog = build_catalog(read('energylabel-verified.json'), read('energystar-verified.json'), read('requested-models.json'))
    if not catalog['models'] or not catalog['counts']['moea']:
        raise RuntimeError('No verified government records; refusing to overwrite the snapshot')
    (ROOT / 'data' / 'tec-catalog.json').write_text(json.dumps(catalog, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    encoded = json.dumps(catalog, ensure_ascii=False, separators=(',', ':')).replace('<', '\\u003c').replace('\u2028','\\u2028').replace('\u2029','\\u2029')
    (ROOT / 'assets' / 'tec-data.js').write_text('/* Generated by scripts/build_tec_catalog.py. */\nconst TEC_DATA = '+encoded+';\n', encoding='utf-8')
    print(json.dumps(catalog['counts']))

if __name__ == '__main__':
    main()
