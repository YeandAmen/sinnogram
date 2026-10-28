import unittest,runpy,pathlib
extract=runpy.run_path(str(pathlib.Path(__file__).resolve().parents[1]/'scripts'/'extract_building_leads.py'))['extract']
def row(address,name='Tenant',identity='overture/one'):
 return {'id':identity,'name':name,'address':address,'lat':9.1,'lng':7.4,'license':'CDLA-Permissive-2.0','sources':[{'dataset':'meta','record_id':'tenant-source'}]}
class BuildingLeadTest(unittest.TestCase):
 def test_extracts_building_from_tenant_but_never_reuses_tenant_pin(self):
  rs=extract({'records':[row('Suite 201, GCL Plaza, 38 Aminu Kano Crescent, Wuse II, Abuja')]})
  self.assertEqual(rs[0]['name'],'GCL Plaza');self.assertEqual(rs[0]['precision'],'address');self.assertNotIn('lat',rs[0]);self.assertNotIn('lng',rs[0]);self.assertEqual(rs[0]['source_record_ids'],['overture/one']);self.assertIn('38 Aminu Kano',rs[0]['address'])
 def test_does_not_turn_nearby_reference_into_own_building(self):
  self.assertFalse(extract({'records':[row('12 Test Street, Opposite GCL Plaza, Wuse 2, Abuja')]}))
 def test_collapses_case_and_roman_district_variants_without_merging_branches(self):
  rs=extract({'records':[row('GCL Plaza, Wuse II, Abuja'),row('Gcl plaza, Wuse 2, Abuja',identity='overture/two'),row('GCL Plaza, Garki, Abuja',identity='overture/three')]})
  self.assertEqual(len(rs),2);self.assertEqual(max(len(r['source_record_ids']) for r in rs),2)
 def test_strips_unit_and_floor_labels_but_retains_numeric_building_brand(self):
  rs=extract({'records':[row('7th Floor Nusaiba Towers, Abuja'),row('A206 Soar Plaza, Abuja',identity='overture/two'),row('2XL Mall, Gwarinpa',identity='overture/three')]})
  self.assertEqual({r['name'] for r in rs},{'Nusaiba Towers','Soar Plaza','2XL Mall'})
if __name__=='__main__':unittest.main()
