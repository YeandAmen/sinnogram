import pathlib
import runpy
import unittest

fct=runpy.run_path(str(pathlib.Path(__file__).resolve().parents[1]/'scripts'/'fct.py'))
CENTRES={
    'Abaji':(8.477,6.947), 'Abuja Municipal':(9.07,7.46), 'Bwari':(9.283,7.383),
    'Gwagwalada':(8.943,7.088), 'Kuje':(8.878,7.228), 'Kwali':(8.883,7.019),
}

class FCTBoundaryTest(unittest.TestCase):
    def test_all_six_area_councils_including_south_and_west_are_inside_the_scope(self):
        self.assertEqual(len(fct['COUNCILS']),6)
        for council,point in CENTRES.items():
            with self.subTest(council=council):
                self.assertTrue(fct['contains'](*point))
                self.assertEqual(fct['area_council'](*point),council)

    def test_bounding_box_alone_does_not_admit_neighbouring_states(self):
        self.assertTrue(fct['in_bounds'](9.183,7.18,fct['BBOX']))
        self.assertFalse(fct['contains'](9.183,7.18))  # Suleja, Niger State
        self.assertFalse(fct['contains'](11,7.4))
        self.assertFalse(fct['contains'](float('nan'),7.4))

    def test_polygon_holes_and_boundary_edges_are_handled(self):
        geometry={'type':'Polygon','coordinates':[
            [[0,0],[10,0],[10,10],[0,10],[0,0]],
            [[3,3],[7,3],[7,7],[3,7],[3,3]],
        ]}
        self.assertTrue(fct['in_geometry'](0,5,geometry))
        self.assertTrue(fct['in_geometry'](2,2,geometry))
        self.assertFalse(fct['in_geometry'](5,5,geometry))

    def test_scope_is_versioned_and_carries_boundary_provenance(self):
        metadata=fct['snapshot_metadata']()
        self.assertEqual(len(metadata['boundary_sha256']),64)
        self.assertEqual(metadata['boundary_license'],'CC-BY-4.0')
        self.assertIn('six area councils',metadata['scope'])

if __name__=='__main__':unittest.main()
