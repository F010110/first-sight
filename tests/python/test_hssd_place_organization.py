import unittest
from sim.hssd.hssd_place_organization_trial import candidate_pairs,validate_pair,validate_anchor


class OrganizationTests(unittest.TestCase):
    def test_pairs_are_bounded_and_identical_for_both_arms(self):
        for n in [23,38,40]:
            pairs=candidate_pairs(n)
            self.assertEqual(len(pairs),8)
            self.assertTrue(all(0<=a<b<n for a,b,_ in pairs))

    def test_same_requires_both_target_evidence(self):
        answer={'relation':'same-local-place','physicalScope':'unknown','boundaryA':'interior','boundaryB':'interior','reason':'example','evidence':[{'ref':'TARGET_A','detail':'desk'}]}
        with self.assertRaises(ValueError):validate_pair(answer,{'TARGET_A','TARGET_B'})
        answer['evidence'].append({'ref':'TARGET_B','detail':'same desk/window arrangement'})
        validate_pair(answer,{'TARGET_A','TARGET_B'})

    def test_anchor_grounding_and_coverage(self):
        answer={'anchors':[{'observationId':'o1','status':'grounded','scope':'local-place','name':'desk corner','instances':['desk','window'],'observerSide':'inside','reason':'visible'}]}
        validate_anchor(answer,['o1'])
        with self.assertRaises(ValueError):validate_anchor(answer,['o1','o2'])


if __name__=='__main__':unittest.main()
