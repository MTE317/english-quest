import fs from 'node:fs';

export const natureJobs=['summoner','druid','astrologer'];
export const natureSpecs=JSON.parse(fs.readFileSync(new URL('../docs/specs/additional-jobs-19-24-skills-v1.json',import.meta.url),'utf8'));
natureSpecs.jobs=natureSpecs.jobs.filter(job=>natureJobs.includes(job.id));

const targetKind={
  summoner:{A01:'self',A02:'enemy',A03:'enemy',A04:'allies',A05:'allies',A06:'ally',A07:'self',A08:'enemies',A09:'enemy',U01:'enemies'},
  druid:{A01:'self',A02:'enemy',A03:'enemy',A04:'self',A05:'enemy',A06:'ally',A07:'self',A08:'enemy',A09:'enemies',U01:'enemies'},
  astrologer:{A01:'enemy',A02:'ally',A03:'enemy',A04:'ally',A05:'enemies',A06:'self',A07:'enemy',A08:'self',A09:'enemies',U01:'enemies'},
};
const attackIds=new Set(['summoner_A02','summoner_A03','summoner_A08','druid_A02','druid_A03','druid_A08','druid_A09','druid_U01','astrologer_A03']);
export const naturePlans=new Map(natureSpecs.jobs.flatMap(job=>job.skills.map(skill=>{
  const id=skill.id,short=id.slice(-3),target=targetKind[job.id][short];
  const kind=skill.type==='passive'?'passive':attackIds.has(id)?'attack':target==='enemy'?'debuff':target==='enemies'?'attack':target==='allies'?'party_buff':target==='ally'?'ally_buff':'self_buff';
  return [id,{kind,weapons:[],build:i=>{
    const rule=skill.levelRules[i];
    return {
      ...(rule.stat==='mag'?{mod:{mag:rule.rate}}:{}),
      ...(rule.kind==='attack'?{base:rule.base==='BM'?'phys':'mag',m:rule.power,element:rule.element==='contract'?undefined:rule.element}:{}),
      ...(target==='allies'||target==='enemies'?{tgt:'all'}:target==='self'?{tgt:'self'}:{}),
      rules:{nature:rule,nature_target:target,
        ...(rule.chooseContract?{choose_mode:rule.chooseContract}:{}),
        ...(rule.chooseElement?{choose_mode:rule.chooseElement}:{}),
        ...(rule.chooseSeed||rule.chooseOwnForecast||rule.requiresForecast?{choose_nature_resource:true}:{})},
      tags:[skill.type==='active'?'active':skill.type,['druid_A08','druid_A09'].includes(id)?'physical':rule.kind==='attack'?'magic':'support'],
    };
  }}];
})));
