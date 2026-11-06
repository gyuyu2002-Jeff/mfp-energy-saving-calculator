import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('catalog', Path(__file__).resolve().parents[1] / 'scripts/build_tec_catalog.py')
catalog = importlib.util.module_from_spec(spec)
spec.loader.exec_module(catalog)

def row(source, value, record_id, **extras):
    return {'brand':'Ricoh','model':'IM C2010','tec':value,'source':source,'sourceRecordId':record_id,'sourceUrl':'https://example.invalid/record/'+record_id,'a3':True,'unit':'kWh/week',**extras}

class CatalogTests(unittest.TestCase):
    def build(self, government, es):
        return catalog.build_catalog({'checkedAt':'2026-11-06','records':government,'missing':[]},{'checkedAt':'2026-11-06','records':es},[{'brand':'Ricoh','model':'IM C2010'}])

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

    def test_official_alias_replaces_generic_name_but_not_specific_names(self):
        generic=row('energystar',0.7,'generic',model='MFP (Multi Function Printer)',modelAliases=['IM C2010'],ambiguous=True)
        result=self.build([],[generic])
        self.assertEqual(result['models'][0]['model'],'IM C2010')
        self.assertTrue(result['models'][0]['ambiguous'])

if __name__=='__main__':
    unittest.main()
