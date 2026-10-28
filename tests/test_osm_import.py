import unittest,runpy,pathlib
normalize=runpy.run_path(str(pathlib.Path(__file__).resolve().parents[1]/'scripts'/'import_locations.py'))['normalize']
def element(identity,tags):return {'type':'node','id':identity,'lat':9.07,'lon':7.46,'tags':tags}
class OSMImportTest(unittest.TestCase):
 def test_named_landmark_without_old_category_tags_is_retained(self):
  rs=normalize({'elements':[element(1,{'name':'Named Plaza'}),element(2,{'name':'Public Park','leisure':'park'})]})['records']
  self.assertEqual(len(rs),2);self.assertEqual(rs[1]['category'],'park')
 def test_bus_stop_is_a_point_but_road_requires_an_entrance_pin(self):
  rs=normalize({'elements':[element(1,{'name':'Wuse stop','highway':'bus_stop'}),element(2,{'name':'Aminu Kano Crescent','highway':'residential'})]})['records']
  self.assertEqual(rs[0]['precision'],'mapped');self.assertEqual(rs[1]['precision'],'street')
 def test_explicit_private_and_disused_features_remain_excluded(self):
  self.assertFalse(normalize({'elements':[element(1,{'name':'Private','access':'private'}),element(2,{'name':'Disused','disused':'yes'})]})['records'])
if __name__=='__main__':unittest.main()
