// The design document is the source for names, costs, prerequisites and descriptions.
import fs from 'node:fs';
const document=fs.readFileSync(new URL('../docs/legendary-jobs-01-06-skills-v1.md',import.meta.url),'utf8');
export const legendaryJobs=['hero','demon_lord','sword_saint'];
const sections=legendaryJobs.map((id,i)=>({id,body:document.split(`## ${i+1}. `)[1].split(`## ${i+2}. `)[0]}));
export const legendarySpecs=sections.map(({id,body})=>({id,skills:body.split('\n').filter(line=>/^\| (?:A|P|U)\d\d /.test(line)).map(line=>{
  const [,label,level,cost,mp,ap,prerequisites,description]=line.split('|').map(x=>x.trim());
  const [code,...name]=label.split(' ');
  const powers=[...description.matchAll(/(?:W|M|H|R)(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)*)/g)];
  return {id:`${id}_${code}`,name:name.join(' '),type:code[0]==='P'?'passive':code[0]==='U'?'ultimate':'active',maxLevel:+level,cost:+cost,baseMp:+mp,learnAp:+ap,prerequisites:prerequisites==='—'?[]:prerequisites.split('・').map(x=>x.replace(/ Lv\d+/,'')),description,powers:powers.map(x=>x[1].split('/').map(Number))};
})}));
const targets={hero:['enemy','ally','ally','enemy','ally','enemy','allies','enemy','allies','none','none','none','none','none','enemies'],
 demon_lord:['enemy','enemy','self','enemy','enemy','enemy','self','enemies','enemy','none','none','none','none','none','enemies'],
 sword_saint:['enemy','enemy','enemy','self','enemy','self','enemy','self','enemy','none','none','none','none','none','enemy']};
export const legendaryPlans=new Map();
for(const job of legendarySpecs)for(let n=0;n<job.skills.length;n++){
 const skill=job.skills[n],target=targets[job.id][n];
 const weapon=job.id==='sword_saint'&&['A01','A02','A03','A05','A07','A09','U01'].includes(skill.id.slice(-3))?['katana','sword']:[];
 const power=skill.powers[0]??[];
 const kind=skill.type==='passive'?'passive':target==='enemy'||target==='enemies'?'attack':target==='ally'||target==='allies'?'ally_buff':'self_buff';
 legendaryPlans.set(skill.id,{kind,weapons:weapon,build:i=>({master:true,additional:true,description:skill.description,short_description:skill.description,
   prerequisites:skill.prerequisites,weapons:weapon,tags:[skill.type],target,
   ...(skill.type==='ultimate'?{ultimate:true}:{}),
   rules:{legendary:{job:job.id,level:i+1,target}},
   ...({hero_P02:'str',demon_lord_P01:'mag',demon_lord_P02:'mp',sword_saint_P02:'str'}[skill.id]
      ?{mod:{[{hero_P02:'str',demon_lord_P01:'mag',demon_lord_P02:'mp',sword_saint_P02:'str'}[skill.id]]:
        (skill.id==='demon_lord_P02'?[.05,.08,.10]:[.04,.06,.08,.10,.12])[i]}}:{}),
   ...(power.length?{m:power[Math.min(i,power.length-1)]}:{}),
 })});
}
