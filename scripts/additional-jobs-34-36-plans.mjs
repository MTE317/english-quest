import fs from 'node:fs';

const design = fs.readFileSync(new URL('../docs/additional-jobs-31-36-skills-v1.md', import.meta.url), 'utf8');
const names = {34:['merchant','商人'],35:['cook','料理人'],36:['archaeologist','考古学者']};
const targets = {
  merchant:{A01:'ally',A02:'ally',A03:'ally',A04:'ally',A05:'ally',A06:'ally',A07:'enemy',A08:'ko_ally',A09:'allies',U01:'allies'},
  cook:{A01:'self',A02:'ally',A03:'ally',A04:'ally',A05:'ally',A06:'self',A07:'ally',A08:'allies',A09:'enemies',U01:'allies'},
  archaeologist:{A01:'enemy',A02:'self',A03:'enemy',A04:'ally',A05:'enemy',A06:'self',A07:'enemy',A08:'enemy',A09:'enemies',U01:'enemies'},
};
const choices = {
  cook_A01:['meat','vegetable','soup'],cook_A06:['meat','vegetable','soup'],
  archaeologist_A02:['attack','guard'],
};
const items = {merchant_A05:'heal',merchant_A08:'revive'};
const magic = new Set(['cook_A09','archaeologist_A03','archaeologist_A07','archaeologist_A09','archaeologist_U01']);
const physical = new Set(['merchant_A07']);
const parts = [...design.matchAll(/^## 追加(3[456])：([^\n]+)\n([\s\S]*?)(?=^## 追加|^## 実装前|$(?![\s\S]))/gm)];
const levelText = (text, i, max) => text.replace(/\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?){2,4}/g, group => {
  const values=group.split('/');return values.length===max?values[i]:group;
});
export const civicJobs = parts.map(([,number])=>names[number][0]);
export const civicSpecs = {jobs:parts.map(([,number,,body])=>{
  const [id,name]=names[number];
  const skills=body.split('\n').filter(line=>/^\| [APU]\d\d /.test(line)).map(line=>{
    const [label,lv,cost,mp,ap,prereq,description]=line.split('|').slice(1,-1).map(x=>x.trim());
    const match=label.match(/^([APU]\d\d) (.+)$/),sid=`${id}_${match[1]}`,maxLevel=Number(lv);
    return {id:sid,name:match[2],maxLevel,cost:Number(cost),baseMp:Number(mp),learnAp:Number(ap),
      prerequisites:prereq==='—'?[]:prereq.split('・').map(x=>({id:`${id}_${x.split(' ')[0]}`,level:Number(x.match(/Lv(\d+)/)?.[1]??1)})),
      type:match[1][0]==='P'?'passive':match[1][0]==='U'?'ultimate':'active',
      target:targets[id][match[1]]??'自分',weaponCondition:'武器条件なし',
      effects:Array.from({length:maxLevel},(_,i)=>levelText(description,i,maxLevel)),description};
  });
  if(skills.length!==15)throw new Error(`${name}: 15技能ではない`);
  return {id,name,skills};
})};
export const civicPlans = new Map(civicSpecs.jobs.flatMap(job=>job.skills.map(skill=>{
  const id=skill.id,tail=id.slice(-3),target=targets[job.id][tail];
  const kind=skill.type==='passive'?'passive':target==='ko_ally'?'revive':
    target==='enemy'||target==='enemies'?'attack':target==='ally'?'ally_buff':target==='allies'?'party_buff':'self_buff';
  const stat=job.id==='merchant'?'hp':job.id==='cook'?'spd':'mag';
  return [id,{kind,weapons:[],build:index=>({
    ...(skill.type==='passive'&&tail==='P02'?{mod:{[stat]:job.id==='merchant'?[.02,.03,.04,.05,.06][index]:[.04,.06,.08,.10,.12][index]}}:{}),
    ...(magic.has(id)?{base:'mag'}:physical.has(id)?{base:'weapon'}:{}),
    ...(target==='self'?{tgt:'self'}:target==='enemies'||target==='allies'?{tgt:'all'}:{}),
    rules:{civic:{level:index+1,targetKind:target},
      ...(choices[id]?{choose_mode:choices[id]}:{}),
      ...(items[id]?{civic_items:items[id]}:{}),
      ...(id==='archaeologist_A08'?{civic_transfer:true}:{}),
    },
    tags:[magic.has(id)?'magic':physical.has(id)?'physical':'support'],
  })}];
})));
