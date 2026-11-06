import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('catalog', Path(__file__).resolve().parents[1] / 'scripts/build_tec_catalog.py')
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)

def row(source, value, record_id, **extras):
    return {'brand':'Ricoh','model':'IM C2010','tec':value,'source':source,'sourceRecordId':record_id,'sourceUrl':'https://example.invalid/record/'+record_id,'a3':True,'unit':'kWh/week',**extras}

class CatalogTests(unittest.TestCase):
    def build(self, government, es, missing=None):
        return catalog.build_catalog({'checkedAt':'2026-11-06','records':government,'missing':missing or []},{'checkedAt':'2026-11-06','records':es},[{'brand':'Ricoh','model':'IM C2010'}])

    def test_husheng_certificate_wins_over_lower_taiwan_ricoh_tec(self):
        husheng=row('moea',1.3,'h',company='互盛公司(互盛股份有限公司)',certificate='1120711續1',validUntil='2027-09-21')
        taiwan=row('moea',0.7,'t',company='台灣理光(台灣理光股份有限公司)',certificate='1150300')
        result=self.build([taiwan,husheng],[row('energystar',0.2,'es')])
        self.assertEqual([(m['sourceRecordId'],m['tec'],m['company']) for m in result['models']],[('h',1.3,husheng['company'])])
        self.assertIn('互盛有效節能標章',result['excluded'][0]['reason'])
        self.assertEqual(result['excluded'][0]['company'],taiwan['company'])

    def test_taiwan_ricoh_remains_when_no_husheng_certificate_exists(self):
        result=self.build([row('moea',0.7,'t',company='台灣理光股份有限公司',certificate='1150300')],[])
        self.assertEqual([m['sourceRecordId'] for m in result['models']],['t'])

    def test_expired_or_future_husheng_certificate_does_not_block_taiwan_ricoh(self):
        taiwan=row('moea',0.7,'t',company='台灣理光股份有限公司',certificate='1150300')
        for dates in [{'validUntil':'2026-11-05'},{'validFrom':'2026-11-07'}]:
            with self.subTest(dates=dates):
                husheng=row('moea',1.3,'h',company='互盛股份有限公司',certificate='1120711續1',**dates)
                result=self.build([husheng,taiwan],[])
                self.assertEqual([m['sourceRecordId'] for m in result['models']],['t'])

    def test_husheng_conflict_stays_unresolved_instead_of_using_another_company(self):
        husheng=row('moea',1.3,'h',company='互盛股份有限公司',certificate='1120711續1',needsReview=True)
        taiwan=row('moea',0.7,'t',company='台灣理光股份有限公司',certificate='1150300')
        result=self.build([husheng,taiwan],[row('energystar',0.2,'es')])
        self.assertEqual(result['models'],[])
        self.assertIn('互盛已有有效節能標章',result['unresolved'][0]['reason'])

    def test_husheng_certificate_without_tec_is_also_respected(self):
        husheng=row('moea',None,'h',company='互盛股份有限公司',certificate='1120711續1')
        taiwan=row('moea',0.7,'t',company='台灣理光股份有限公司',certificate='1150300')
        result=self.build([taiwan],[row('energystar',0.2,'es')],missing=[husheng])
        self.assertEqual(result['models'],[])
        self.assertIn('互盛已有有效節能標章',result['unresolved'][0]['reason'])

    def test_company_preference_does_not_merge_different_model_suffixes(self):
        husheng=row('moea',1.3,'h',model='IM C2010A',company='互盛股份有限公司',certificate='h-cert')
        taiwan=row('moea',0.7,'t',company='台灣理光股份有限公司',certificate='t-cert')
        result=self.build([husheng,taiwan],[])
        self.assertEqual({m['sourceRecordId'] for m in result['models']},{'h','t'})

    def test_government_wins_even_when_energy_star_is_lower(self):
        result=self.build([row('moea',1.3,'a'),row('moea',0.7,'b')],[row('energystar',0.2,'c')])
        self.assertEqual([m['tec'] for m in result['models']],[1.3,0.7])

    def test_fallback_only_without_government_tec(self):
        result=self.build([],[row('energystar',0.2,'c')])
        self.assertEqual(result['models'][0]['source'],'energystar')
        self.assertIn('fallbackReason',result['models'][0])

    def test_conflict_does_not_silently_choose_lowest_or_fallback(self):
        result=self.build([row('moea',1.3,'a',needsReview=True)],[row('energystar',0.2,'c')])
        self.assertEqual(result['models'],[])
        self.assertEqual(len(result['excluded']),1)

    def test_current_es_precedes_archive_without_dropping_regional_suffixes(self):
        result=self.build([],[row('energystar',0.3,'old',archived=True),row('energystar',0.2,'current')])
        self.assertEqual(len(result['models']),1)
        self.assertNotEqual(catalog.identity('Ricoh','IM C2010'),catalog.identity('Ricoh','IM C2010A'))

    def test_refurbished_variant_keeps_original_history(self):
        refurbished=row('energystar',0.4,'refurb',model='GreenLine IM C2010',modelAliases=['IM C2010'],remanufactured=True)
        result=self.build([],[row('energystar',0.9,'old',archived=True),refurbished])
        self.assertEqual(len(result['models']),2)
        self.assertIn('GreenLine IM C2010',[m['model'] for m in result['models']])

    def test_removed_greenline_record_keeps_both_original_im_c3000_records(self):
        records=[
            row('energystar',0.43,'2634757',model='GreenLine IM C3000',modelAliases=['IM C3000'],sourceDataset='t2v6-g4nf',remanufactured=True),
            row('energystar',1.1,'2325462',model='IM C3000',sourceDataset='historical-v2',archived=True),
            row('energystar',0.3,'2345187',model='IM C3000',sourceDataset='historical-v2',archived=True)
        ]
        result=catalog.build_catalog({'checkedAt':'2026-11-06','records':[],'missing':[]},
            {'checkedAt':'2026-11-06','records':records},[{'brand':'Ricoh','model':'IM C3000'}])
        self.assertEqual({m['sourceRecordId']:m['tec'] for m in result['models']},{'2325462':1.1,'2345187':0.3})
        self.assertEqual(result['unresolved'],[])
        self.assertEqual(len(result['excluded']),1)
        self.assertIn('2634757',result['excluded'][0]['reason'])

    def test_official_alias_replaces_generic_name_but_not_specific_names(self):
        generic=row('energystar',0.7,'generic',model='MFP (Multi Function Printer)',modelAliases=['IM C2010'],ambiguous=True)
        result=self.build([],[generic])
        self.assertEqual(result['models'][0]['model'],'IM C2010')
        self.assertTrue(result['models'][0]['ambiguous'])

if __name__=='__main__':
    unittest.main()
