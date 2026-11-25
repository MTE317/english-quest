"""measure.mjs の4出力を集計。既定パスはREADMEのコマンドと対応。"""
import json, re
from pathlib import Path
b=json.loads(Path('/tmp/gold-before.json').read_text())
out={'base':'72b13f28667390d0791aca44806ac5cce03898ed','conditions':{'seed':112501,'trials':64,'successfulRunsPerTrial':15,'shopQuotes':len(b['quotes']),'otherQuotes':len(b['otherQuotes'])},'candidates':[],'sampleBefore':b['progression'][0],'examplesBefore':b['examples'],'baselineProfitableResales':sum(q.get('profit',0)>0 for q in b['quotes']),'baselineEngineHash':b['engineHash'],'baselineDataHash':b['sourceHash']}
for name in ['after','100','2digit']:
 a=json.loads(Path('/tmp/gold-'+name+'.json').read_text());scale=a['scale'];errs=[y['buy']/scale/x['buy']-1 for x,y in zip(b['quotes'],a['quotes']) if x['buy']];cash=[];changes=0
 assert len(a['quotes'])==len(b['quotes'])
 for x,y in zip(b['quotes'],a['quotes']): assert (x['id'],x['rank'])==(y['id'],y['rank'])
 for x,y in zip(b['progression'],a['progression']):
  for p,q in zip(x['ledger'],y['ledger']):cash.append(q['after']/scale/p['after']-1);changes+=p['affordableWeapons']!=q['affordableWeapons']
 oe=[{'type':x['type'],'id':x['id'],'before':x['gold'],'after':y['gold'],'deltaRatio':y['gold']/scale/x['gold']-1} for x,y in zip(b['otherQuotes'],a['otherQuotes']) if x['gold']]
 out['candidates'].append({'name':name,'scale':scale,'digits':a['digits'],'engineHash':a['engineHash'],'dataHash':a['sourceHash'],'harnessHash':a['harnessHash'],'unchanged':a['sourceUnchangedAtCompletion'],'shopRelativeError':[min(errs),max(errs)],'cashRelativeError':[min(cash),max(cash)],'differentAffordableCounts':changes,'profitableResales':sum(q.get('profit',0)>0 for q in a['quotes']),'newBuySellArbitrage':sum(y.get('profit',0)>0 and x.get('profit',0)<=0 for x,y in zip(b['quotes'],a['quotes'])),'otherQuotes':oe,'sample':a['progression'][0],'finalBalances':[x['ledger'][-1]['after'] for x in a['progression']]})
 if name=='after':out['examplesAfter']=a['examples']
Path('game/verification/gold/results.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
