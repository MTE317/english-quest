// 追加28〜30の設計表を技能データに変換する。戦闘固有の処理は battle.js / job-combat.js。
import fs from 'node:fs';
import assert from 'node:assert/strict';

export const commandJobs=['strategist','jester','gambler'];
const names=['軍師','道化師','賭博師'];
const doc=fs.readFileSync(new URL('../docs/additional-jobs-25-30-skills-v1.md',import.meta.url),'utf8');
const formulas={W:'STR＋武器威力を参照しDEFで軽減する物理攻撃。',M:'MAG＋術補助を参照しRESで軽減する魔法。',
  R:'floor(10＋0.5×使用者Lv＋使用者RES)。',F:'技能Lvの固定効果。'};
const plans=new Map(),add=(id,kind,build,weapons=[])=>plans.set(id,{kind,build,weapons});
const pick=(v,i)=>v[i],weapon=(m,el,rules={},extra={})=>({base:'weapon',m,element:el,rules,...extra});
const magic=(m,el,rules={},extra={})=>({base:'mag',m,element:el,rules,...extra});
const stat=(id,key)=>add(id,'passive',i=>({mod:{[key]:[.04,.06,.08,.10,.12][i]}}));
const order=(type,rate,extra={})=>({rules:{order:{type,rate,turns:2,...extra}}});
add('strategist_A01','ally_buff',i=>order('damage',pick([.10,.15,.20],i)));
add('strategist_A02','ally_buff',i=>order('guard',pick([.10,.15,.20],i)));
add('strategist_A03','ally_buff',i=>({rules:{order_speed:pick([.15,.20,.25],i)}}));
add('strategist_A04','ally_buff',i=>order('flank',pick([.10,.15,.20],i),{enemy:true}));
add('strategist_A05','attack',i=>weapon(pick([.65,.85,1.05],i),'pierce',{proxy_attack:true}));
add('strategist_A06','party_buff',i=>({tgt:'all',rules:{orders_party:{count:i+2,rate:pick([.05,.07,.09],i)}}}));
add('strategist_A07','ally_buff',()=>({rules:{order_front:true}}));
add('strategist_A08','utility',i=>({tgt:'selected_enemy',rules:{analyze_accuracy:pick([.05,.08,.10],i)}}));
add('strategist_A09','ally_buff',i=>order('damage',pick([.25,.30,.35],i),{mpSave:.20}));
add('strategist_P01','passive',i=>({rules:{order_damage_bonus:pick([.05,.08,.10],i)}}));
stat('strategist_P02','spd');
add('strategist_P03','passive',i=>({rules:{order_guard_bonus:pick([.05,.08,.10],i)}}));
add('strategist_P04','passive',i=>({rules:{order_mp_save:pick([.20,.30,.40],i)}}));
add('strategist_P05','passive',i=>({rules:{order_self_cut:pick([.06,.09,.12],i)}}));
add('strategist_U01','party_buff',()=>({tgt:'all',rules:{orders_ultimate:{damage:.20,guard:.10}}}));

add('jester_A01','ally_buff',i=>({rules:{decoy:{m:pick([.70,.90,1.10],i)}}}));
add('jester_A02','attack',i=>magic(pick([1,1.15,1.30,1.45,1.60],i),'wind'));
add('jester_A03','ally_buff',()=>({rules:{decoy_move:true}}));
add('jester_A04','status',i=>({st:['blind',pick([.35,.45,.55],i)],status_turns:2}));
add('jester_A05','attack',i=>magic(pick([.90,1.05,1.20,1.35,1.50],i),'dark'));
add('jester_A06','party_buff',i=>({tgt:'all',rules:{smoke_evasion:pick([.08,.12,.16],i)}}));
add('jester_A07','self_buff',i=>({tgt:'self',rules:{decoy_repair:pick([.30,.40,.50],i)}}));
add('jester_A08','attack',i=>magic(pick([1.30,1.70,2.10],i),'dark',{decoy_burst:true}));
add('jester_A09','utility',i=>({tgt:'selected_enemy',rules:{decoy_lure:pick([.60,.70,.80],i)}}));
add('jester_P01','passive',i=>({rules:{decoy_hp:pick([.10,.15,.20],i)}}));
stat('jester_P02','spd');
add('jester_P03','passive',i=>({rules:{jester_status_damage:pick([.05,.10,.15],i)}}));
add('jester_P04','passive',i=>({rules:{lure_bonus:pick([.05,.08,.10],i)}}));
add('jester_P05','passive',i=>({rules:{decoy_mp_gain:i+1}}));
add('jester_U01','attack',()=>magic(1.80,'dark',{decoy_ultimate:true},{tgt:'all'}));

const gamble=(safe,win,fail,chance,extra={})=>({base:'weapon',element:'pierce',m:safe,
  rules:{gamble:{safe,win,fail,chance},...extra}});
add('gambler_A01','attack',i=>weapon(pick([1.05,1.20,1.35,1.50,1.65],i),'pierce'),['gun','dagger']);
add('gambler_A02','attack',i=>gamble(pick([1.20,1.35,1.50,1.65,1.80],i),pick([2.10,2.40,2.70,3,3.30],i),pick([.80,.85,.90,.95,1],i),.45,{choose_mode:['safe','risk']}),['gun','dagger']);
add('gambler_A03','self_buff',i=>({tgt:'self',rules:{insurance:pick([.20,.30,.40],i)}}));
add('gambler_A04','attack',i=>gamble(0,pick([1.70,2.10,2.50],i),pick([.70,.80,.90],i),.50,{risk_only:true,secondary_element:'thunder'}),['gun']);
add('gambler_A05','self_buff',i=>({tgt:'self',rules:{gambler_shield:pick([.70,1,1.30],i)}}));
add('gambler_A06','attack',i=>gamble(0,pick([2.70,3.10,3.50],i),1,.35,{risk_only:true}));
add('gambler_A07','heal',i=>({tgt:'self',rules:{ticket_heal:pick([.10,.15,.20],i)}}));
add('gambler_A08','attack',i=>weapon(pick([1.10,1.25,1.40,1.55,1.70],i),'pierce',{}, {defign:.10}),['gun']);
add('gambler_A09','attack',i=>({...gamble(0,pick([1.40,1.80,2.20],i),pick([.60,.70,.80],i),.45,{risk_only:true}),tgt:'all'}),['gun']);
add('gambler_P01','passive',i=>({rules:{gamble_chance:pick([.02,.04,.06],i)}}));
stat('gambler_P02','luk');
add('gambler_P03','passive',i=>({rules:{gamble_miss_damage:pick([.10,.15,.20],i)}}));
add('gambler_P04','passive',i=>({rules:{gamble_miss_heal:pick([.02,.03,.04],i)}}));
add('gambler_P05','passive',i=>({rules:{gamble_win_crit:pick([.05,.08,.10],i)}}));
add('gambler_U01','attack',()=>({...gamble(1.80,3,1.10,.50,{choose_mode:['safe','risk'],ultimate_ticket:true}),tgt:'all'}));

const sections=doc.split(/^### 追加(\d+)：(.+)$/m),titleToId=new Map(names.map((n,i)=>[n,commandJobs[i]]));
export const commandSpecs={formulas,jobs:[]};
for(let p=1;p<sections.length;p+=3){
  const jobId=titleToId.get(sections[p+1]);if(!jobId)continue;
  const skills=[];
  for(const line of sections[p+2].split('\n')){
    const hit=/^\| ([APU]\d\d) ([^|]+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| ([^|]+) \| (.+) \|$/.exec(line);
    if(!hit)continue;
    const [,code,name,level,cost,mp,ap,pre,description]=hit,id=jobId+'_'+code,maxLevel=Number(level);
    const prerequisites=[...pre.matchAll(/([AP]\d\d)(?: Lv(\d+))?/g)].map(x=>({id:jobId+'_'+x[1],level:Number(x[2]??1)}));
    const effects=Array.from({length:maxLevel},(_,i)=>description.replace(/\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)+/g,s=>{
      const values=s.split('/');return values.length===maxLevel?values[i]:s;
    }));
    const plan=plans.get(id);assert.ok(plan,`実装定義なし: ${id}`);
    const effect=plan.build(0),tags=effect.base==='weapon'?['weapon','physical']:effect.base==='mag'?['magic']
      :plan.kind==='heal'?['healing']:[];
    skills.push({id,name:name.trim(),type:code[0]==='U'?'ultimate':code[0]==='P'?'passive':'active',maxLevel,
      cost:Number(cost),mpBand:Number(mp)===3?'軽':Number(mp)===6?'中':Number(mp)===12?'重':'なし',
      apBand:Number(ap)===10?'導入':Number(ap)===18?'標準':Number(ap)===28?'発展':'奥義',
      growthMode:maxLevel===1?'none':`lv${maxLevel}`,prerequisites,weapons:plan.weapons,tags,
      target:description.split('。')[0],reference:effect.base==='weapon'?'W':effect.base==='mag'?'M':'F',
      effects,simpleDescriptions:effects.map(s=>s.split('。')[0]+'。'),weaponCondition:'武器条件なし'});
  }
  assert.equal(skills.length,15,jobId);commandSpecs.jobs.push({id:jobId,skills});
}
assert.equal(commandSpecs.jobs.length,3);assert.equal(plans.size,45);
export const commandPlans=plans;
