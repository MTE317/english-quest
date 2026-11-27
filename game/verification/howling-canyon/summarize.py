import json,statistics,sys,collections
r=json.load(open(sys.argv[1]));out=[]
for level in [10,15]:
 for a in [.65,.8,.95]:
  x=[v for v in r if v['level']==level and v['accuracy']==a and v['mode']=='material'];trips=[t for v in x for t in v['results'] if t.get('reached')];wins=[b for t in trips for b in t['battles']if b['result']=='win']; q=sorted(b['questions']for b in wins)
  row=dict(level=level,accuracy=a,N=len(x),trips=len(trips),wins=len(wins),materialsByTrip=[sum(v['materialAfter']>v['materialBefore']and len(v['results'])<=i for v in x)for i in [1,2,3]],questionsMean=round(statistics.mean(q),2),questionsP50=statistics.median(q),questionsP90=q[int((len(q)-1)*.9)],actualAccuracy=round(sum(t['correct']for t in trips)/sum(t['questions']for t in trips),4),goldNetMean=round(statistics.mean(sum(t['after']['gold']-t['prep']['goldBefore']for t in v['results']if t.get('reached'))for v in x)),xpFirstMemberMean=round(statistics.mean(b['growth'][0]['xp']for b in wins if b.get('growth')),2),apFirstMemberMean=round(statistics.mean(b['growth'][0]['ap']for b in wins if b.get('growth')),2),itemsUsed=dict(collections.Counter({key:sum(b['itemsBefore'].get(key,0)-b['itemsAfter'].get(key,0)for t in trips for b in t['battles'])for key in ['potion','ether','revive_salts','antidote']})))
  boss=[v for v in r if v['level']==level and v['accuracy']==a and v['mode']=='boss'];row['fullRoute']=dict(N=len(boss),cleared=sum(any(t.get('clear')for t in v['results'])for v in boss),lossFloors=dict(collections.Counter(str(t['battles'][-1]['floor'])for v in boss for t in v['results']if t.get('failure')and t['battles'])))
  out.append(row)
print(json.dumps(out,indent=2))
