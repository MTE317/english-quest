// 追加25〜27の設計表を実行データへ変換する。数値と本文の正本は設計書。
import fs from 'node:fs';
import assert from 'node:assert/strict';

export const companionJobs = ['beastmaster', 'puppeteer', 'dancer'];
const names = ['魔獣使い', '人形師', '踊り子'];
const doc = fs.readFileSync(new URL('../docs/additional-jobs-25-30-skills-v1.md', import.meta.url), 'utf8');
const reference = {
  W: 'STR＋武器威力を参照しDEFで軽減する物理攻撃。',
  C: '本人STR＋floor(本人最大HP×0.08)を参照しDEFで軽減する相棒の手動攻撃。',
  M: 'MAG＋術補助を参照しRESで軽減する魔法。',
  H: '通常の回復計算。', R: 'floor(10＋0.5×使用者Lv＋使用者RES)。',
  R_DEF: 'floor(10＋0.5×使用者Lv＋使用者DEF)。', F: '技能Lvの固定効果。',
};
const weapons = {
  beastmaster: ['whip', 'spear'], puppeteer: ['instrument', 'tome'], dancer: ['fan', 'whip', 'dagger'],
};
const definitions = new Map();
const add = (id, kind, build, weapon = []) => definitions.set(id, { kind, build, weapons: weapon });
const seq = (values, i) => values[i];
const weapon = (m, element, rules = {}, tgt) => ({ base: 'weapon', m, element, ...(tgt ? { tgt } : {}), rules });
const magic = (m, element, rules = {}, tgt) => ({ base: 'mag', m, element, ...(tgt ? { tgt } : {}), rules });
const command = (m, element, extra = {}) => ({ base: 'phys', m, element, rules: { requires_companion: true, companion_attack: true, no_weapon_power: true, ...extra } });
const stat = (id, key) => add(id, 'passive', i => ({ mod: { [key]: seq([.04,.06,.08,.10,.12], i) } }));

add('beastmaster_A01', 'self_buff', i => ({ tgt: 'self', rules: { companion_summon: { turns: i + 4 } } }));
add('beastmaster_A02', 'attack', i => weapon(seq([1.05,1.20,1.35,1.50,1.65], i), 'blunt'), weapons.beastmaster);
add('beastmaster_A03', 'attack', i => command(seq([1.05,1.25,1.45,1.65,1.85], i), 'blunt'));
add('beastmaster_A04', 'attack', i => command(seq([.90,1.05,1.20,1.35,1.50], i), 'wind'));
add('beastmaster_A05', 'ally_buff', i => ({ rules: { companion_guard: { turns: i + 1 } } }));
add('beastmaster_A06', 'self_buff', i => ({ tgt: 'self', rules: { companion_repair: { rate: seq([.30,.40,.50],i), limit: 2 } } }));
add('beastmaster_A07', 'attack', i => weapon(seq([.70,.80,.90,1,1.10],i), '', { requires_companion:true, companion_follow: { m:seq([.70,.80,.90,1,1.10],i), element:'blunt' } }), weapons.beastmaster);
add('beastmaster_A08', 'status', i => ({ st:['fear',.35], tgt:'all', target_limit:i+1, status_turns:1 }));
add('beastmaster_A09', 'attack', i => command(seq([1.50,1.70,1.90,2.10,2.30],i), 'blunt', { companion_high_damage:.15 }));
add('beastmaster_P01', 'passive', i => ({ rules:{ companion_command_damage:seq([.05,.10,.15],i) } }));
stat('beastmaster_P02','str');
add('beastmaster_P03', 'passive', i => ({ rules:{ companion_hp:seq([.10,.15,.20],i) } }));
add('beastmaster_P04', 'passive', i => ({ rules:{ companion_cover_cut:seq([.10,.15,.20],i) } }));
add('beastmaster_P05', 'passive', i => ({ rules:{ companion_fear_damage:seq([.10,.15,.20],i) } }));
add('beastmaster_U01', 'attack', () => weapon(1.50,'',{ companion_ultimate:true, companion_follow:{m:1.50,element:'blunt'}, party_next_cut:.08 }),weapons.beastmaster);

add('puppeteer_A01', 'self_buff', i => ({ tgt:'self', rules:{ puppet_summon:{turns:i+3} } }));
add('puppeteer_A02', 'attack', i => magic(seq([.95,1.10,1.25,1.40,1.55],i),'none',{requires_puppet:'attack',puppet_attack:true}));
add('puppeteer_A03', 'self_buff', () => ({ tgt:'self', rules:{puppet_stance:'guard'} }));
add('puppeteer_A04', 'ally_buff', i => ({ rules:{puppet_guard:{turns:i+1}} }));
add('puppeteer_A05', 'self_buff', i => ({ tgt:'self',rules:{puppet_repair:{rate:seq([.30,.40,.50],i),limit:2}} }));
add('puppeteer_A06', 'attack', i => magic(seq([.75,.90,1.05,1.20,1.35],i),'none',{requires_puppet:'attack',puppet_attack:true},'all'));
add('puppeteer_A07', 'utility', i => ({ tgt:'selected_enemy',rules:{puppet_slow:{rate:.80,value:.10,turns:i+1}} }));
add('puppeteer_A08', 'party_buff', i => ({ tgt:'all',rules:{puppet_shield:{m:seq([.70,.90,1.10],i),turns:1}} }));
add('puppeteer_A09', 'self_buff', i => ({ tgt:'self',rules:{requires_puppet:true,choose_mode:['attack','guard'],puppet_quick_stance:{bonus:seq([.15,.20,.25],i),turns:2}} }));
add('puppeteer_P01','passive',i=>({rules:{puppet_hp:seq([.10,.15,.20],i)}}));
stat('puppeteer_P02','mag');
add('puppeteer_P03','passive',i=>({rules:{puppet_cover_cut:seq([.06,.09,.12],i)}}));
add('puppeteer_P04','passive',i=>({rules:{puppet_attack_damage:seq([.05,.10,.15],i)}}));
add('puppeteer_P05','passive',i=>({rules:{puppet_mp_save:seq([.20,.30,.40],i)}}));
add('puppeteer_U01','attack',()=>magic(1.90,'none',{puppet_ultimate:true},'all'));

const dance = (kind, values = {}) => ({ ...values, rules:{...values.rules,dance:kind} });
add('dancer_A01','attack',i=>dance('spin',magic(seq([.90,1.05,1.20,1.35,1.50],i),'wind')));
add('dancer_A02','party_buff',i=>dance('step',{tgt:'all',rules:{dance_spd:seq([.08,.10,.12],i)}}));
add('dancer_A03','status',i=>dance('spin',{st:['charm',seq([.25,.35,.45],i)],status_turns:1}));
add('dancer_A04','heal_all',i=>dance('step',{m:seq([.45,.60,.75],i),tgt:'all'}));
add('dancer_A05','attack',i=>dance('finish',magic(seq([.90,1.20,1.50],i),'wind',{rhythm_power:.15})));
add('dancer_A06','party_buff',i=>dance('finish',{tgt:'all',rules:{dance_next_damage:seq([.08,.12,.16],i),rhythm_bonus:.04}}));
add('dancer_A07','ally_buff',i=>dance('step',{rules:{dance_evasion:seq([.10,.15,.20],i)}}));
add('dancer_A08','attack',i=>dance('spin',magic(seq([.70,.85,1.00],i),'water',{},'all')));
add('dancer_A09','attack',i=>dance('finish',magic(seq([1,1.40,1.80],i),'wind',{rhythm_power:.10},'all')));
add('dancer_P01','passive',i=>({rules:{spin_damage:seq([.05,.08,.10],i)}}));
stat('dancer_P02','spd');
add('dancer_P03','passive',i=>({rules:{step_bonus:seq([.05,.08,.10],i)}}));
add('dancer_P04','passive',i=>({rules:{charm_bonus:seq([.05,.08,.10],i)}}));
add('dancer_P05','passive',i=>({rules:{finish_mp_save:seq([.10,.15,.20],i)}}));
add('dancer_U01','heal_all',()=>dance('finish',{m:.80,tgt:'all',rules:{dance_ultimate:true}}));

const titleToId = new Map(names.map((name,i)=>[name,companionJobs[i]]));
const sections = doc.split(/^### 追加(\d+)：(.+)$/m);
export const companionSpecs = { formulas:reference,jobs:[] };
for(let p=1;p<sections.length;p+=3){
  const jobId=titleToId.get(sections[p+1]);if(!jobId)continue;
  const skills=[];
  for(const line of sections[p+2].split('\n')){
    const match=/^\| ([APU]\d\d) ([^|]+) \| (\d+) \| (\d+) \| (\d+) \| (\d+) \| ([^|]+) \| (.+) \|$/.exec(line);
    if(!match)continue;
    const [,code,name,level,cost,mp,ap,pre,description]=match;
    const maxLevel=Number(level),id=jobId+'_'+code;
    const prerequisites=[...pre.matchAll(/([AP]\d\d)(?: Lv(\d+))?/g)].map(x=>({id:jobId+'_'+x[1],level:Number(x[2]??1)}));
    const effects=Array.from({length:maxLevel},(_,i)=>description.replace(/\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)+/g,s=>{
      const parts=s.split('/');return parts.length===maxLevel?parts[i]:s;
    }));
    const plan=definitions.get(id);assert.ok(plan,`実装定義なし: ${id}`);
    const built=plan.build(0);
    const tags=built.base==='weapon'?['weapon','physical']:built.base==='phys'?['physical']
      :built.base==='mag'?['magic']:plan.kind==='heal_all'?['healing']:[];
    skills.push({id,name:name.trim(),type:code[0]==='U'?'ultimate':code[0]==='P'?'passive':'active',maxLevel,
      cost:Number(cost),mpBand:Number(mp)===3?'軽':Number(mp)===6?'中':Number(mp)===12?'重':'なし',
      apBand:Number(ap)===10?'導入':Number(ap)===18?'標準':Number(ap)===28?'発展':'奥義',
      growthMode:maxLevel===1?'none':`lv${maxLevel}`,prerequisites,weapons:plan.weapons,tags,target:description.split('。')[0],
      reference:plan.build(0).base==='weapon'?'W':plan.build(0).base==='mag'?'M':plan.build(0).rules?.companion_attack?'C':'F',
      effects,simpleDescriptions:effects.map(text=>text.split('。')[0]+'。'),weaponCondition:'武器条件なし'});
  }
  assert.equal(skills.length,15,jobId);
  companionSpecs.jobs.push({id:jobId,skills});
}
assert.equal(companionSpecs.jobs.length,3);
assert.equal(definitions.size,45);
export const companionPlans=definitions;
