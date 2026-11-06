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
    # The company preference is based on certification, even if its TEC needs review.
    husheng_keys = set().union(*(record_keys(r) for r in [*moea['records'], *moea.get('missing', [])]
        if r['brand'].upper() == 'RICOH' and r.get('company', '').startswith('互盛') and r.get('certificate')
        and (not r.get('validFrom') or date.fromisoformat(r['validFrom']) <= today)
        and (not r.get('validUntil') or date.fromisoformat(r['validUntil']) >= today)))
    selected = []
    excluded = []
    for record in moea['records']:
        relevant = record.get('a3') is True or bool(record_keys(record) & requested_keys)
        if not relevant or record.get('a3') is False:
            continue
        if record['brand'].upper() == 'RICOH' and record.get('company', '').startswith(('台灣理光', '臺灣理光')) and record_keys(record) & husheng_keys:
            excluded.append({**record, 'reason': '同型號已有互盛有效節能標章，依獲證公司優先規則不列入台灣理光紀錄'})
            continue
        if record.get('sourceConflict') or record.get('needsReview'):
            excluded.append({**record, 'reason': '官方明細與開放資料實測值不一致，暫不自動採用'})
            continue
        if record.get('validUntil') and date.fromisoformat(record['validUntil']) < today:
            excluded.append({**record, 'reason': '證書已逾期，需重新核實'})
            continue
        if record.get('validFrom') and date.fromisoformat(record['validFrom']) > today:
            excluded.append({**record, 'reason': '證書尚未生效，暫不自動採用'})
            continue
        selected.append(dict(record))

    eligible_es = []
    for record in energy_star['records']:
        if not record_keys(record) & requested_keys or record_keys(record) & (government_keys | husheng_keys):
            continue
        if record.get('sourceDataset') == 't2v6-g4nf' and str(record['sourceRecordId']) == '2634757':
            excluded.append({**record, 'reason': '依使用者指定移除 GreenLine IM C3000（ESUID 2634757），不列入試算選單'})
            continue
        eligible_es.append(record)
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

    fields = ['brand','model','company','sourceModel','modelAliases','ambiguous','remanufactured','tec','unit','source','sourceUrl','sourceRecordId','standard','voltage','certificate','validFrom','validUntil','checkedAt','notes','color','speed','tech','a3','markets','archived','fallbackReason','moeaCheckedAt','sourceDataset','archiveRow']
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
        item['variantLabel'] = ('證書 ' + str(item['certificate'])) if item['source'] == 'moea' else ('舊版認證資料 ' if item['archived'] else 'ESUID ') + str(item['sourceRecordId'])
        models.append(item)
    models.sort(key=lambda m: (m['source'] != 'moea', m['brand'], m['model'], m['id']))
    selected_keys = set().union(*(record_keys(r) for r in selected))
    unresolved = []
    for key in sorted(requested_keys - selected_keys):
        row = next(m for m in requested if identity(m['brand'], m['model']) == key)
        reason = '未取得可核實的每週 TEC；未沿用舊站數值'
        if key in husheng_keys:
            reason = '互盛已有有效節能標章，但 TEC 缺漏或資料待核實；依優先規則不改用台灣理光或 ENERGY STAR'
        elif key in missing_tec_keys:
            reason = '能源署未公布每週 TEC，ENERGY STAR 亦無可用同型號 TEC；不將睡眠功率 W 換成 kWh/週'
        elif key in government_keys:
            reason = '政府紀錄存在，但非 A3、已逾期或來源衝突；未以 ENERGY STAR 覆蓋'
        unresolved.append({'brand': row['brand'], 'model': row['model'], 'reason': reason})
    return {
        'checkedAt': min(moea['checkedAt'][:10], energy_star['checkedAt'][:10]),
        'policy': '能源署實測優先；Ricoh 同型號有互盛有效節能標章時優先互盛，無互盛有效標章才採台灣理光。互盛 TEC 缺漏或衝突時列待核實；其餘查無同型號可用實測 TEC 時才採 ENERGY STAR，不自動取最低值。',
        'models': models,
        'unresolved': unresolved,
        'excluded': [{'brand': r['brand'], 'model': r['model'], 'company': r.get('company'), 'certificate': r.get('certificate'), 'sourceUrl': r['sourceUrl'], 'reason': r['reason']} for r in excluded],
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
