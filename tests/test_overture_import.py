import unittest, runpy, pathlib
normalize=runpy.run_path(str(pathlib.Path(__file__).resolve().parents[1]/'scripts'/'import_overture_places.py'))['normalize']
def feature(identity='one',name='Test Cafe',lat=9.07,lng=7.47,dataset='meta',license='CDLA-Permissive-2.0'):
 return {'id':identity,'type':'Feature','geometry':{'type':'Point','coordinates':[lng,lat]},'properties':{'names':{'primary':name},'confidence':0.8,'addresses':[{'freeform':'1 Test Street','locality':'Abuja','country':'NG'}],'sources':[{'dataset':dataset,'license':license,'record_id':'source-id'}]}}
class ImportTest(unittest.TestCase):
 def test_retains_coordinates_and_source_identity(self):
  rows,unknown=normalize([feature()]);self.assertEqual(len(rows),1);self.assertEqual(rows[0]['id'],'overture/one');self.assertEqual(rows[0]['lat'],9.07);self.assertEqual(rows[0]['sources'][0]['record_id'],'source-id');self.assertFalse(unknown)
 def test_rejects_missing_coordinates_unsupported_license_and_outside_bbox(self):
  missing=feature();missing['geometry']['coordinates']=[None,None]
  rows,_=normalize([missing,feature(lat=11),feature(license='unapproved-license')]);self.assertFalse(rows)
 def test_deduplicates_nearby_same_name_without_merging_branches_or_organisations(self):
  rows,_=normalize([feature(),feature(identity='duplicate'),feature(identity='branch',lat=9.1),feature(identity='other',name='Other Cafe')]);self.assertEqual(len(rows),3)
 def test_does_not_import_explicitly_closed_locations(self):
  closed=feature();closed['properties']['operating_status']='permanently_closed';self.assertFalse(normalize([closed])[0])
 def test_fct_polygon_keeps_abaji_and_excludes_neighbouring_suleja(self):
  rows,_=normalize([feature(lat=8.477,lng=6.947),feature(identity='outside',lat=9.183,lng=7.18)])
  self.assertEqual(len(rows),1);self.assertEqual(rows[0]['area_council'],'Abaji')
if __name__=='__main__':unittest.main()
