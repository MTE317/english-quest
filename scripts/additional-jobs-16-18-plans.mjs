import fs from 'node:fs';

export const arcaneJobs=['elementalist','witch','hexer'];
export const arcanePlans=new Map();
const root=new URL('../docs/specs/additional-jobs-10-18-skills-v1.json',import.meta.url);
const spec=JSON.parse(fs.readFileSync(root,'utf8'));
const passive=(s,r)=> {
  if(r.stat)return {mod:{mag:r.value}};
  if(r.mpSave)return {rules:{mp_save:[r.mpSave]}};
  if(r.statusResist)return {rules:{status_resist:r.statusResist}};
  if(r.matchingFieldMagicDamage)return {rules:{matching_field_magic:r.matchingFieldMagicDamage}};
  if(r.whileOwnFieldMagicCut)return {rules:{own_field_magic_cut:r.whileOwnFieldMagicCut}};
  if(r.weakElementDamage)return {rules:{field_weak_magic:r.weakElementDamage.rate}};
  if(r.familiarOnSummon)return {rules:{familiar_on_summon:r.familiarOnSummon}};
  if(r.elementDamage)return {rules:{witch_element_magic:r.elementDamage}};
  if(r.whileFamiliarMagicCut)return {rules:{familiar_magic_cut:r.whileFamiliarMagicCut}};
  if(r.familiarConditionDamage)return {rules:{familiar_condition:r.familiarConditionDamage}};
  if(r.afterEffectiveCurse)return {rules:{after_effective_curse:r.afterEffectiveCurse}};
  if(r.bitterMarkPowerAdd)return {rules:{bitter_mark_power:r.bitterMarkPowerAdd}};
  if(r.conditionDamage)return {rules:{hex_status_magic:r.conditionDamage}};
  throw Error('Unsupported passive '+s.id);
};
function build(s,r){
  if(r.kind==='passive')return passive(s,r);
  if(r.kind==='attack'){
    const rules={};
    if(r.base==='MS')rules.scythe_spell=true;
    if(r.chooseElement)rules.choose_element=r.chooseElement;
    if(r.ownMatchingFieldDamage)rules.own_matching_field_damage=r.ownMatchingFieldDamage;
    if(r.familiarAtActionStartDamage)rules.familiar_start_damage=r.familiarAtActionStartDamage;
    if(r.ownCurseMarkDamage)rules.own_curse_mark_damage=r.ownCurseMarkDamage;
    if(r.afterField)rules.after_field=r.afterField;
    if(r.afterPartyShield)rules.after_party_shield=r.afterPartyShield;
    if(r.afterFamiliar)rules.after_familiar=r.afterFamiliar;
    if(r.afterDamagingHitCurse)rules.after_curse=r.afterDamagingHitCurse;
    return {base:'mag',m:r.power,element:r.element==='chosen'?undefined:r.element,
      ...(r.targetLimit?{tgt:'all',target_limit:r.targetLimit}:{}),
      ...(r.status?{st:[r.status.id,r.status.rate],status_turns:r.status.turns}:{}),rules};
  }
  if(r.kind==='field')return {rules:{field:r}};
  if(r.kind==='party_buff')return {rules:{field_guard:r}};
  if(r.kind==='familiar')return {rules:{familiar:r,choose_mode:r.chooseMode}};
  if(r.kind==='familiar_mode')return {rules:{familiar_mode:r,choose_mode:r.modes}};
  if(r.kind==='shield')return {rules:{familiar_shield:r}};
  if(r.kind==='curse_mark')return {tgt:r.targetLimit?'all':'selected_enemy',
    ...(r.targetLimit?{select_targets:true,target_limit:r.targetLimit}:{}),rules:{curse_mark:r}};
  if(r.kind==='debuff')return {tgt:'selected_enemy',rules:{hex_debuff:r}};
  if(r.kind==='status')return {tgt:'all',select_targets:true,target_limit:r.targetLimit,st:[r.status.id,r.status.rate],
    status_turns:r.status.turns};
  if(r.kind==='prepare'){
    const key=r.requiresOwnField?'release_field':r.requiresFamiliar?'release_familiar':'release_curse';
    return {tgt:key==='release_curse'?'selected_enemy':'self',rules:{[key]:r}};
  }
  throw Error('Unsupported skill '+s.id+' '+r.kind);
}
const kinds={field:'self_buff',party_buff:'party_buff',familiar:'self_buff',familiar_mode:'self_buff',
  shield:'self_buff',curse_mark:'utility',debuff:'utility',prepare:'self_buff',status:'status',
  attack:'attack',passive:'passive'};
for(const job of spec.jobs.filter(j=>arcaneJobs.includes(j.id)))for(const skill of job.skills)
  arcanePlans.set(skill.id,{kind:kinds[skill.levelRules[0].kind],build:i=>build(skill,skill.levelRules[i])});
