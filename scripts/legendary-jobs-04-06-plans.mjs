import fs from 'node:fs';
const document=fs.readFileSync(new URL('../docs/legendary-jobs-01-06-skills-v1.md',import.meta.url),'utf8');
export const finalLegendaryJobs=['sage','saint','overlord'];
const targets={
 sage:['enemy','enemy','enemy','enemy','ally','self','self','enemies','enemy','none','none','none','none','none','enemies'],
 saint:['ally','ally','enemy','ally','allies','ko_ally','ally','allies','ko_allies','none','none','none','none','none','allies'],
 overlord:['enemy','allies','enemy','ally','allies','enemy','enemies','allies','enemy','none','none','none','none','none','enemies'],
};
export const finalLegendarySpecs=finalLegendaryJobs.map((id,index)=>({id,skills:document.split(`## ${index+4}. `)[1].split(index===2?'## 実装前':'## '+(index+5)+'. ')[0]
  .split('\n').filter(line=>/^\| (?:A|P|U)\d\d /.test(line)).map(line=>{
    const [,label,level,cost,mp,ap,prerequisites,description]=line.split('|').map(x=>x.trim());
    const [code,...name]=label.split(' ');
    const power=[...description.matchAll(/(?:W|M|H|R)(\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)*)/g)].map(x=>x[1].split('/').map(Number));
    return {id:`${id}_${code}`,name:name.join(' '),type:code[0]==='P'?'passive':code[0]==='U'?'ultimate':'active',maxLevel:+level,cost:+cost,baseMp:+mp,
      learnAp:+ap,prerequisites:prerequisites==='—'?[]:prerequisites.split('・').map(x=>x.replace(/ Lv\d+/,'')),description,power};
  })}));
export const finalLegendaryPlans=new Map();
for(const job of finalLegendarySpecs)for(let n=0;n<job.skills.length;n++){
  const s=job.skills[n],target=targets[job.id][n],id=s.id;
  const weapon=job.id==='overlord'&&['A01','A03','A06','A07','A09','U01'].includes(id.slice(-3))?['axe','greatsword','sword','spear','hammer','katana','dagger','fist','scythe','whip','gun','bow']:[];
  const kind=s.type==='passive'?'passive':target==='enemy'||target==='enemies'?'attack':target==='ko_ally'||target==='ko_allies'?'revive':target==='ally'||target==='allies'?'ally_buff':'self_buff';
  const p=s.power[0]??[];
  const stat={sage_P02:'mag',saint_P02:'res',overlord_P01:'str'}[id];
  finalLegendaryPlans.set(id,{kind,weapons:weapon,build:i=>({master:true,additional:true,description:s.description,short_description:s.description,
    ...(job.id==='sage'||job.id==='saint'?{base:'mag'}:{base:'weapon'}),
    prerequisites:s.prerequisites,weapons:weapon,tags:[s.type],target,
    ...(s.type==='ultimate'?{ultimate:true}:{}),...(stat?{mod:{[stat]:[.04,.06,.08,.10,.12][i]}}:{}),
    rules:{legendary_final:{job:job.id,level:i+1,target},
      ...(job.id==='sage'&&['A01','A03','A07','U01','A04','A08','A09'].includes(id.slice(-3))?{choose_element:['fire','ice','wind','earth','thunder','water']}:{} )},
    ...(p.length?{m:p[Math.min(i,p.length-1)]}:{}),
  })});
}
