import json
import pathlib
import runpy
import unittest

collector=runpy.run_path(str(pathlib.Path(__file__).resolve().parents[1]/'scripts'/'collect_public_places.py'))

class PublicPlaceCollectionTest(unittest.TestCase):
    def test_structured_school_address_aliases_and_provenance_are_retained_without_entrance_claims(self):
        data={'@context':'https://schema.org','@graph':[{'@type':'School','name':'Test Fine Trust Academy','alternateName':['Finetrust Test','FTA Test'],
            'address':{'streetAddress':'12 Test Road','addressLocality':'Jikwoyi Phase 3','addressRegion':'FCT','addressCountry':'NG'},'geo':{'latitude':8.984,'longitude':7.568}}]}
        records,_=collector['extract']('<script type="application/ld+json">'+json.dumps(data)+'</script>','https://school.example/contact')
        self.assertEqual(len(records),1);record=records[0]
        self.assertEqual(record['district'],'Jikwoyi Phase 3');self.assertEqual(record['location']['lat'],8.984)
        self.assertEqual(record['source_urls'],['https://school.example/contact']);self.assertIn('Finetrust Test',record['aliases'])
        self.assertNotIn('entrance',record);self.assertNotIn('verification',record)

    def test_missing_and_out_of_fct_coordinates_remain_address_leads(self):
        entity={'@type':'LocalBusiness','name':'A public test clinic','address':'Test Street, Abuja','geo':{'latitude':9.183,'longitude':7.18}}
        draft=collector['draft_from_entity'](entity,'https://clinic.example','Jikwoyi')
        self.assertNotIn('location',draft);self.assertEqual(draft['district'],'Jikwoyi')

    def test_same_name_branches_are_kept_and_people_are_not_collected_as_places(self):
        entries=[{'@type':'School','name':'Test Academy','address':'12 Test Road'},{'@type':'School','name':'Test Academy','address':'14 Test Road'},
                 {'@type':'Person','name':'Test teacher','address':'Private address'}]
        records,_=collector['extract']('<script type="application/ld+json">'+json.dumps(entries)+'</script>','https://school.example','Jikwoyi')
        self.assertEqual(len(records),2)

    def test_html_address_fallback_is_marked_for_review(self):
        records,links=collector['extract']('<h1>Public Test Clinic</h1><address>12 Test Road, Jikwoyi</address><a href="/contact">Contact</a>','https://clinic.example','Jikwoyi')
        self.assertEqual(records[0]['name'],'Public Test Clinic');self.assertNotIn('location',records[0]);self.assertIn('confirm',records[0]['notes']);self.assertEqual(links,['/contact'])

    def test_invalid_structured_metadata_does_not_invent_places(self):
        records,_=collector['extract']('<script type="application/ld+json">{broken</script><p>A lot of prose about schools</p>','https://school.example','Jikwoyi')
        self.assertFalse(records)

if __name__=='__main__':unittest.main()
