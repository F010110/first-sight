"""Aggregate explicit visual adjudications, not annotation-label equality.

Place footprints and decisions are recorded below, including doubtful cases.
This is an assistant visual audit, not independent human gold.
"""
import json
from pathlib import Path

root=Path(__file__).resolve().parents[2]
out=root/'run/ulvn-place-quality-audit-v1'
pairs=json.loads((out/'pair-index.json').read_text())
groups=[
    ('station-continuity','continuity',[1,2,3],'Same station visit; height is not an identity test.'),
    ('hardware-first-exit','continuity',list(range(4,13)),'First visit exit and nearby movement, not a return.'),
    ('pawn-sidewalk','true', [14,15,16,17,19,20,22,23,24],'Same pawn-shop frontage after leaving its interior.'),
    ('park-road','true',list(range(25,43)),'Same park-side road section and restaurant intersection, different views/positions allowed.'),
    ('restaurant-exterior','true',list(range(44,51)),'Same restaurant exterior property after interior visit; facade orientation does not create another business.'),
    ('union-street','true',list(range(51,74)),'Same cash-store street segment with repeated layout.'),
    ('hardware-frontage','true',list(range(74,94))+list(range(100,119)),'Same shop-door frontage/corner, including mislabeled original frames58/92/93.'),
    ('hardware-room','true',list(range(94,100)),'Same green-table shop interior; not credited from exterior-only matches.'),
    ('bar-porch','true',[119,120,121],'Back on same covered wood porch after interior visit.'),
    ('gas-perimeter-continuity','continuity',[125,126,127,128],'Walking round gas perimeter without a separately established leave-and-return.'),
    ('elevator-cab-continuity','continuity',[137],'Images show same moving elevator enclosure; floor change alone does not imply false identity.'),
    ('gas-to-pawn','false',[124],'Different distant sites; matching facade/background is insufficient.'),
    ('laundry-alley-to-brick-backroom','false',[129],'Exterior alley versus unrelated indoor backroom; repeated brick/door texture.'),
    ('west-park-to-laundry-alley','false',[136],'Different occupied street/alley regions, despite background overlap.'),
    ('pawn-sidewalk-to-park-road','boundary',[13,18,21],'Current pawn frontage versus road/park-side source; do not certify occupied-region identity from common scenery.'),
    ('restaurant-terrace-to-road','boundary',[43],'Restaurant frontage/railing versus more distant road intersection.'),
    ('gas-street-to-bar-porch','boundary',[122,123],'Left porch and moved into crossing/street; porch remains visible.'),
    ('stone-side-to-laundry-frontage','boundary',list(range(130,136)),'Opposite frontage/crossing sees laundry; shared scenery does not establish same occupied sidewalk.'),
]
assigned=[i for _,_,ids,_ in groups for i in ids]
assert sorted(assigned)==list(range(1,138)), 'Every accepted pair must have exactly one adjudication'
records=[]
for name,status,ids,reason in groups:
    records.append({'claim':name,'decision':status,'pairIndices':ids,'reason':reason,
                    'sources':[[pairs[i-1]['current'],pairs[i-1]['historical']] for i in ids]})
targets=[{'place':name,'recalled':True} for name,status,_,_ in groups if status=='true']
targets.append({'place':'laundry-frontage','recalled':False,
                'basis':'603-606 initial frontage, return near 637-641 after laundry interior/backroom;641 has no accepted match. Later opposite-side matches not credited to frontage.'})
tp=sum(g['decision']=='true' for g in records)
fp=sum(g['decision'] in {'false','boundary'} for g in records)
result={'scope':'Unique visually reviewed place-to-place return claims. Repeated frames collapse; true continuity excluded. Boundary decisions retain occupied-region distinction, not label matching.',
        'authority':'Assistant inspection of 12 sheets covering all137 accepted pairs and5 timeline sheets; not independent human gold or complete system evaluation.',
        'placeGranularity':'Shop interior and exterior separate occupied regions; station interior may span levels; street segment may span views, but visible landmark does not merge opposing sidewalks. Same moving cab is one enclosure.',
        'truePlaceClaims':tp,'falsePlaceClaims':fp,'revisitedPlaces':len(targets),'recalledPlaces':tp,
        'precision':tp/(tp+fp),'recall':tp/len(targets),
        'unambiguousWrongPlaceClaims':3,'boundarySensitiveClaims':4,
        'sensitivity':'7/10=70% is precision only after excluding four boundary-sensitive claims, NOT whole-run precision. Independent review may change place footprints and counts; original labels unchanged.',
        'groups':records,'recallTargets':targets}
(out/'reviewed-place-report.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
print(json.dumps({k:v for k,v in result.items() if k not in {'groups','recallTargets'}},indent=2))
