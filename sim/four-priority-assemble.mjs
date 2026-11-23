import { readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const dir=new URL('./results/',import.meta.url);
const read=id=>JSON.parse(readFileSync(new URL(id+'.json',dir),'utf8'));
const write=(id,value)=>writeFileSync(new URL(id+'.json',dir),JSON.stringify(value)+'\n');
const keys={
  matrix:['matrix1','matrix6','matrix12'], swaps:['swapsA','swapsB'], teams:['teams'], encounters:['encounters'],
  niches:['niches'], tuning:['tuning'], draft:['draft'],
};
const raw=Object.fromEntries(Object.values(keys).flat().map(k=>[k,read('priority-'+k)]));
const {audit,catalog,jobs,fingerprint,seed,stride,node}=read('four-priority-audit');
const model=read('four-priority-model');
const protocol=read('four-priority-protocol');
const allRows=Object.fromEntries(Object.entries(keys).map(([segment,parts])=>[
  segment,parts.flatMap(k=>raw[k][({niches:'swaps',tuning:'swaps',draft:'teams'})[segment]??segment]),
]));
for(const [k,r] of Object.entries(raw)){
  assert.equal(r.fingerprint,fingerprint);
  assert.equal(r.seed,seed);
  assert.equal(r.stride,stride);
  assert.equal(r.memoized,true);
  assert.deepEqual(r.failures,[],k);
}
assert.equal(audit.size,1024);
assert.deepEqual(audit.invalid,[]);
assert.equal(allRows.matrix.length,81);
assert.equal(allRows.swaps.length,73);
assert.equal(allRows.niches.length,219);
assert.equal(allRows.tuning.length,12);
assert.equal(allRows.teams.length,6);
assert.equal(allRows.encounters.length,54);
assert.equal(allRows.draft.length,30);
assert.equal(catalog.length,100);
assert.equal(jobs.length,50);
assert.equal(protocol.quizChoices,4);
const probes=read('priority-existing-probes');
assert.equal(probes.passed,36);

const average=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
function paired(a,b){
  assert.equal(a.n,b.n);
  const n=a.n;
  return Object.fromEntries(['win','questions','damageTaken','mpNet'].map((key,j)=>{
    const xs=a.paired.map((row,i)=>row[j]-b.paired[i][j]);
    const mean=average(xs);
    const sd=Math.sqrt(xs.reduce((s,v)=>s+(v-mean)**2,0)/Math.max(1,n-1));
    const half=1.96*sd/Math.sqrt(n);
    return [key,{mean,normalCI95:[mean-half,mean+half]}];
  }));
}
const base=allRows.swaps.find(x=>x.id==='baseline');
const compact=r=>({n:r.n,wins:r.wins,clearQuestions:r.clear?.questions.mean??null,
  questions:r.all.questions.mean,rounds:r.all.rounds.mean,damageTaken:r.all.damageTaken.mean,
  hpNet:r.all.hpNet.mean,mpNet:r.all.mpNet.mean,hits:r.all.hits.mean,cpuMs:r.all.cpuMs.mean,
  primarySupport:r.all.primarySupport.mean,primarySkills:r.primarySkills,setupPrice:r.fixture.primaryJobChangeJp,
  slotUse:r.fixture.primaryLoadoutCost});
const tiers=['multi','boss','armored'];
const baselines=Object.fromEntries(tiers.map(k=>[k,allRows.niches.find(r=>r.scenario===k&&r.id==='baseline')]));
const buildList=catalog.map(b=>{
  if (b.no>36) {
    const p=model.builds.find(m=>m.id===b.id);
    return {...b,evaluation:'暫定モデル',unverified:p.pending??'追加技能全体・合法装備・実ゲーム勝率',
      scenarios:Object.fromEntries(Object.entries(p.scenarios).map(([k,v])=>[k,v[1]])),
      trigger:p.rule,components:p.components,coreEngineProbe:false};
  }
  const rows=allRows.swaps.filter(r=>r.id===b.id);
  if (rows.length!==2) return {...b,evaluation:'未検証',availableRuns:rows.map(compact)};
  const niches=Object.fromEntries(tiers.map(k=>{
    const x=allRows.niches.find(r=>r.id===b.id&&r.scenario===k&&r.arm==='full');
    const y=allRows.niches.find(r=>r.id===b.id&&r.scenario===k&&r.arm==='noPrimaryPassive');
    if (!x || !y) return [k,null];
    const compare=paired(x,baselines[k]);
    const passives=paired(x,y);
    const possibleNiche=x.wins>=baselines[k].wins&&(compare.questions.mean<=-2||compare.damageTaken.mean<=-.15*baselines[k].all.damageTaken.mean);
    return [k,{...compact(x),compare,passives,possibleNiche}];
  }));
  return {...b,evaluation:'測定済み',job:rows[0].jobs[0],coreEngineProbe:true,
    expedition:rows.map(r=>({prep:r.prep,...compact(r),vsBaseline:paired(r,base)})),niches,
    unverified:'任意の6人構成での最適性能・実プレイ操作・同額のジョブ間順位'};
});
const jobList=jobs.map(j=>{
  if(j.tier==='advanced'){
    const p=model.jobs.find(m=>m.id===j.id);
    return {...j,evaluation:p.status,linkedModelBuilds:p.linkedModelBuilds,modelEvidence:p.representative,
      linkedExistingBuilds:j.builds.map(n=>buildList[n-1]).filter(b=>b.evaluation==='測定済み').map(b=>b.id),
      existence:p.status==='未検証'?'参照する既存ビルドは測定済み。専用技能の差分と採用条件は未検証'
        :'リンク先のビルドで設計条件への寄与を推計。ジョブ本体の優劣・移植可否・解放コストは未検証'};
  }
  const rows=buildList.filter(b=>b.job===j.id&&b.evaluation==='測定済み');
  const niches=rows.flatMap(b=>Object.entries(b.niches).filter(([,v])=>v?.possibleNiche).map(([scenario,v])=>({
    id:b.id,scenario,questionsDelta:v.compare.questions.mean,damageTakenDelta:v.compare.damageTaken.mean,
  })));
  const rawEvidence=rows.map(b=>({id:b.id,questions:b.expedition[1].questions,wins:b.expedition[1].wins,
    n:b.expedition[1].n,primarySupport:b.expedition[1].primarySupport}));
  return {...j,evaluation:rows.length?'測定済み':'未検証',evidence:rawEvidence,niches,
    existence:niches.length?'固定戦で基準編成に対する優位候補あり':'基準編成に対する採用理由を今回の指標で確認できず。下位互換は未確定'};
});
assert.equal(buildList.filter(x=>x.evaluation==='測定済み').length,36);
assert.equal(jobList.filter(x=>x.evaluation==='測定済み').length,14);
write('four-priority-evaluation',{seed,stride,rules:{pairing:'同じ戦闘seed。行動変化で乱数消費順は分岐',
  jobExistence:'勝数を維持し同一固定戦で問題数平均2以上減または被ダメージ平均15%以上減。効果探索の閾値で有意判定ではない',
  pairedIntervals:'95%正規近似、個別比較の探索用。多重比較補正なし。勝敗割合の区間は元データWilson区間'},
  builds:buildList,jobs:jobList});
write('four-priority-engine',{
  main:'ca4ebba4f2431531a1a90fff0703e8895c288c71',seed,stride,node,fingerprint,audit,
  batches:Object.fromEntries(Object.entries(raw).map(([k,r])=>[k,r.trials])),
  tests:{coreEngineProbe4:probes.passed,protocol:protocol.runs},
  ...allRows,
});
console.log(JSON.stringify({builds:buildList.length,jobs:jobList.length,
  jobNiches:jobList.filter(x=>x.niches?.length).map(x=>x.id),
  emptyJobNiches:jobList.filter(x=>x.niches?.length===0).map(x=>x.id),
  advancedStatus:jobList.filter(x=>x.tier==='advanced').reduce((a,b)=>(a[b.evaluation]=(a[b.evaluation]??0)+1,a),{}),
  engineRuns:Object.fromEntries(Object.entries(allRows).map(([k,v])=>[k,v.reduce((a,b)=>a+b.n,0)])),
}));
