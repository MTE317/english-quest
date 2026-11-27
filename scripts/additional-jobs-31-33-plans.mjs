import fs from 'node:fs';

const source = fs.readFileSync(new URL('../docs/additional-jobs-31-36-skills-v1.md', import.meta.url), 'utf8');
const names = {31:['apothecary','薬師'],32:['alchemist','錬金術師'],33:['machinist','機工士']};
const targets = {
  apothecary: {A01:'ally',A02:'ally',A03:'ally',A04:'ally',A05:'enemy',A06:'ally',A07:'ally',A08:'ko_ally',A09:'ally',U01:'allies'},
  alchemist: {A01:'self',A02:'enemy',A03:'enemy',A04:'enemies',A05:'enemy',A06:'self',A07:'ally',A08:'self',A09:'enemies',U01:'enemies'},
  machinist: {A01:'self',A02:'enemy',A03:'ally',A04:'self',A05:'enemy',A06:'enemies',A07:'self',A08:'self',A09:'enemies',U01:'enemies'},
};
const choices = {
  apothecary_A04:['継続ダメージ','行動を封じる','行動を制限','弱体化'],
  apothecary_U01:['継続ダメージ','行動を封じる','行動を制限','弱体化'],
  alchemist_A01:['fire','ice','thunder'],alchemist_A04:['fire','ice','thunder'],
  alchemist_A07:['fire','ice','thunder'],alchemist_A08:['fire','ice','thunder'],
  alchemist_U01:['attack:fire','attack:ice','attack:thunder','guard:fire','guard:ice','guard:thunder'],
  machinist_A04:['attack','guard'],
};
const itemMode = {apothecary_A06:'heal',alchemist_A06:'material'};
const magic = new Set(['alchemist_A02','alchemist_A03','alchemist_A04','alchemist_A05','alchemist_A09','alchemist_U01']);
const physical = new Set(['apothecary_A05','machinist_A02','machinist_A05','machinist_A06','machinist_A09','machinist_U01']);
const sections = [...source.matchAll(/^## 追加(3[123])：([^\n]+)\n([\s\S]*?)(?=^## 追加|^## 実装前|$(?![\s\S]))/gm)];
function levelText(text, level, max) {
  return text.replace(/\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?){2,4}/g, group => {
    const values = group.split('/');
    return values.length === max ? values[level] : group;
  });
}
export const craftJobs = sections.map(([,number]) => names[number][0]);
export const craftSpecs = {formulas:{H:'既存のHP回復式',M:'MAG＋術補助',W:'STR＋武器威力',R:'floor(10＋0.5×使用者Lv＋RES)'},jobs:sections.map(([,number,,body]) => {
  const [id,name] = names[number];
  const skills = body.split('\n').filter(line => /^\| [APU]\d\d /.test(line)).map(line => {
    const [label,lv,cost,mp,ap,prereq,description] = line.split('|').slice(1,-1).map(x=>x.trim());
    const match = label.match(/^([APU]\d\d) (.+)$/),sid=`${id}_${match[1]}`,maxLevel=Number(lv);
    return {id:sid,name:match[2],maxLevel,cost:Number(cost),baseMp:Number(mp),learnAp:Number(ap),
      prerequisites:prereq==='—'?[]:prereq.split('・').map(x=>({id:`${id}_${x.split(' ')[0]}`,level:Number(x.match(/Lv(\d+)/)?.[1]??1)})),
      type:match[1][0]==='P'?'passive':match[1][0]==='U'?'ultimate':'active',
      target:targets[id][match[1]]??'自分',weaponCondition:'武器条件なし',
      effects:Array.from({length:maxLevel},(_,i)=>levelText(description,i,maxLevel)),description};
  });
  if(skills.length!==15)throw new Error(`${name}: 15技能ではない`);
  return {id,name,skills};
})};
export const craftPlans = new Map(craftSpecs.jobs.flatMap(job => job.skills.map(skill => {
  const id=skill.id,tail=id.slice(-3),target=targets[job.id][tail];
  const kind=skill.type==='passive'?'passive':target==='ko_ally'?'revive':
    target==='ally'?'ally_buff':target==='allies'?'party_buff':target==='self'?'self_buff':'attack';
  return [id,{kind,weapons:id==='apothecary_A05'?['dagger']:[],
    build:index=>({
      ...(skill.type==='passive'&&tail==='P02'?{mod:{[job.id==='apothecary'?'hp':job.id==='alchemist'?'mag':'str']:(job.id==='apothecary'?[.02,.03,.04,.05,.06]:[.04,.06,.08,.10,.12])[index]}}:{}),
      ...(magic.has(id)?{base:'mag'}:physical.has(id)?{base:'weapon'}:{}),
      ...(target==='self'?{tgt:'self'}:target==='enemies'||target==='allies'?{tgt:'all'}:{}),
      rules:{trio:{level:index+1,targetKind:target},...(choices[id]?{choose_mode:choices[id]}:{}),
        ...(itemMode[id]?{trio_items:itemMode[id]}:{})},
      tags:[magic.has(id)?'magic':physical.has(id)?'physical':'support'],
    })}];
})));
