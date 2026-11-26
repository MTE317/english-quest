// 追加職19〜24の設計データとレビュー用一覧を生成する。ゲームの実装CSVには触れない。
import fs from 'node:fs';
import assert from 'node:assert/strict';
import {parseCsv} from '../game/js/csv.js';

const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root),'utf8').replace(/^\uFEFF/,'');
const roster=parseCsv(read('data/jobs_mid.csv')).rows;
const previous=JSON.parse(read('docs/specs/additional-jobs-10-18-skills-v1.json'));
const ids=['necromancer','onmyoji','shrine_maiden','summoner','druid','astrologer'];
const roles={
 necromancer:['死霊術師','実ダメージから魂を蓄え、術または亡霊への指示に使う。','魔女の自動反応する使い魔・呪術師の敵行動反応と異なり、亡霊は術者の行動でのみ動く。'],
 onmyoji:['陰陽師','光と闇を交互に使って調和符を得て、符を消費する結界・大技に変える。','魔法剣士の武器付与や精霊術士の場と異なり、直前の術属性の交替が条件。'],
 shrine_maiden:['巫女','神楽を一つ選び、異常予防・再生・防護を切り替える。','白魔導士は即時回復が主力。巫女は一枠の継続支援と事前の異常対策を主力にする。'],
 summoner:['召喚士','炎・土・水の契約を選び、有限回の呼び出しで攻撃・防護・回復を選ぶ。','魔女の自動追撃や将来の相棒職と違い、召喚効果は技能選択時に一度だけ発動する。'],
 druid:['ドルイド','育つ種を仕込んで収穫し、人型の術と獣化時の物理技を使い分ける。','召喚士の即時契約と異なり、種の成長に時間を使い、獣化中は技能選択が変わる。'],
 astrologer:['占星術師','未来の本人の行動機会へ攻撃・回復・防護を予約し、早めたり目標を変えたりする。','竜騎士の着地攻撃と異なり、最大2枠の予兆を組み立て、支援も予約できる。']
};
const rules=JSON.parse(read('data/basic_job_rules.json'));
const ap={intro:rules.ap_bands.intro,standard:rules.ap_bands.standard,advanced:rules.ap_bands.advanced,ultimate:rules.ap_bands.ultimate};
const mp={light:rules.mp_bands.light,medium:rules.mp_bands.medium,heavy:rules.mp_bands.heavy};
const jobs=ids.map((id,i)=>{const row=roster.find(x=>x.id===id);assert.ok(row,id);return {
 id,name:roles[id][0],additionalNumber:19+i,masterNumber:27+i,role:roles[id][1],difference:roles[id][2],
 baseline:Object.fromEntries(['role','s_weapons','a_weapons','main_elements','support_elements','stat_reference','style','ultimate_concept'].map(k=>[k,row[k]])),skills:[]
}});
let job;
const jobFor=id=>{job=jobs.find(j=>j.id===id);assert.ok(job);};
const p5=(start,step)=>Array.from({length:5},(_,i)=>({power:+(start+step*i).toFixed(2)}));
const series=(key,values)=>values.map(value=>({[key]:value}));
const constant=[{}];
function render(t,values){return t.replace(/\{([a-zA-Z]+)\}/g,(_,key)=>{
  assert.ok(values[key]!==undefined,`未定義の値 ${key}`);const n=values[key];
  return typeof n==='number' && ['rate','chance','cut','bonus','regen','guard'].includes(key)?`${Math.round(n*100)}%`:String(n);
});}
function add(code,name,levels,o){
 const type=code[0]==='A'?'active':code[0]==='P'?'passive':'ultimate',id=job.id+'_'+code;
 assert.ok([1,3,5].includes(levels.length),id);
 const band=type==='ultimate'?'ultimate':o.ap??(code==='A01'||code==='P02'?'intro':'standard');
 const mpc=type==='passive'||type==='ultimate'?0:mp[o.mp??'medium'];
 const prereq=(o.pre??[]).map(item=>{const [s,level='1']=item.split(':');return {id:job.id+'_'+s,level:Number(level)};});
 const elements=o.element?[o.element]:[];
 const skill={id,name,type,maxLevel:levels.length,growthMode:levels.length===1?'none':'lv'+levels.length,
   cost:type==='ultimate'?0:o.cost??(type==='passive'?2:2),baseMp:mpc,mpBand:mpc===0?'なし':o.mp??'medium',
   learnAp:ap[band],apBand:band,upgradeAp:rules.upgrade_ap.slice(0,levels.length-1),prerequisites:prereq,
   target:o.target??(type==='passive'?'本人':'敵1体'),reference:o.ref??'F',weapons:o.weapons??[],elements,
   role:o.short,effects:levels.map((v,i)=>render(o.effect,{...v,level:i+1})),
   simpleDescriptions:levels.map(()=>o.short),
   levelRules:levels.map((v,i)=>({kind:o.kind??(type==='passive'?'passive':o.ref==='M'||o.ref==='BM'||o.ref==='MS'?'attack':'support'),
     ...(o.ref?{base:o.ref}:{}),...(o.element?{element:o.element}:{}),target:o.target??(type==='passive'?'self':'one_enemy'),
     ...(o.rule??{}),...v,level:i+1}))};
 job.skills.push(skill);
}
const A=(code,name,levels,o)=>add('A'+code,name,levels,o);
const P=(code,name,levels,o)=>add('P'+code,name,levels,o);
const U=(name,o)=>add('U01',name,constant,{...o,mp:'none'});

jobFor('necromancer');
A('01','魂灯',p5(.90,.15),{ref:'M',element:'dark',mp:'light',ap:'intro',short:'闇魔法で攻撃し、魂を蓄える。',effect:'敵1体に闇属性M{power}倍の直接攻撃。実ダメージを与えたら魂を1得る。1行動の魂獲得は最大1、魂は最大3。',rule:{grantSoul:{trigger:'own_direct_damage',amount:1,perAction:1}}});
A('02','亡霊招来',series('turns',[2,3,4]),{pre:['A01'],short:'魂を使って亡霊を呼ぶ。',target:'自分',effect:'魂1を消費し、亡霊を呼び出す。自分の次の{turns}行動終了まで保持。指示できる回数は2回。既存の亡霊は置き換え、行動や自動追撃はしない。',rule:{requiresSoul:1,consumeSoul:1,ghostCharges:2,durationBasis:'owner_opportunity'}});
A('03','霊吸',p5(.80,.15),{ref:'MS',element:'dark',pre:['A01'],short:'鎌術で攻撃し、自分を回復する。',effect:'敵1体へ闇属性MS{power}倍の直接攻撃。鎌なら独立術補助を加算し、それ以外はMと同じ。与えた実ダメージの15%だけ自分のHPを回復する。回復は1行動につき自分の最大HPの10%まで。',rule:{drainRate:.15,healCapMaxHp:.1}});
A('04','冥火',series('turns',[2,3,4]),{ref:'M',element:'dark',pre:['A01'],short:'闇魔法と炎上で敵を削る。',effect:'敵1体へ闇属性M0.85倍の直接攻撃。実ダメージを与えた時だけ基礎35%で炎上を{turns}敵行動付与する。通常の状態耐性とボス補正を適用。',rule:{power:.85,status:{id:'burn',rate:.35},trigger:'damaging_hit'}});
A('05','魂喰い',p5(1.30,.20),{ref:'M',element:'dark',pre:['A01:2'],mp:'heavy',cost:3,ap:'advanced',short:'魂1を消費して強い闇魔法。',effect:'魂1を消費し、敵1体へ闇属性M{power}倍の直接攻撃。魂不足ならMPを払わず失敗する。',rule:{requiresSoul:1,consumeSoul:1}});
A('06','亡霊の手',p5(.90,.15),{ref:'M',element:'none',pre:['A02'],short:'亡霊に命じ、敵を攻撃する。',effect:'生存中の自分の亡霊に命じ、敵1体へ無属性M{power}倍の直接攻撃。亡霊の指示回数を1消費する。追加行動・追撃・魂獲得は起こさない。',rule:{requiresGhost:true,ghostChargeCost:1,manualCommand:true}});
A('07','霊障',series('turns',[2,3,4]),{pre:['A05'],short:'魂で敵のRESを下げる。',target:'敵1体',effect:'魂1を消費し、敵1体のRESを基礎80%で10%下げる。命中時は{turns}敵行動持続。失敗しても魂は消費する。RES低下の共通50%上限を守る。',rule:{requiresSoul:1,consumeSoul:1,statDebuff:{stat:'res',rate:.8,value:.1}}});
A('08','霊衣',series('guard',[.70,1,1.30]),{pre:['A02'],short:'魂を防護に変える。',target:'味方1人',effect:'魂1を消費し、味方1人にR基準{guard}の防護を2対象行動付与。合計防護は対象の最大HP50%まで。',rule:{requiresSoul:1,consumeSoul:1,shieldBase:'R',turns:2}});
A('09','魂の奔流',p5(.80,.15),{ref:'M',element:'dark',pre:['A05:2','A06'],mp:'heavy',cost:4,ap:'advanced',short:'魂2を消費し、敵全体へ闇魔法。',target:'敵全体',effect:'魂2を消費し、生存敵全体へ闇属性M{power}倍の直接攻撃。撃破が複数でもこの行動では魂を得ない。',rule:{requiresSoul:2,consumeSoul:2,grantSoul:false}});
P('01','魂の還流',series('rate',[.15,.25,.35]),{pre:['A01'],short:'魂を使う通常技能のMPを軽減する。',effect:'魂を消費する通常アクティブ技能のMP費用を{rate}軽減する。必要な魂は減らず、奥義・パッシブには適用しない。',rule:{scope:'soul_spending_normal_active',mpSave:true}});
P('02','冥術の基礎',series('rate',[.04,.06,.08,.10,.12]),{ap:'intro',short:'MAGを上げる。',effect:'本人のMAGを{rate}高める。装備している間だけ有効。',rule:{stat:'mag'}});
P('03','幽体の守り',series('cut',[.06,.09,.12]),{pre:['A02'],short:'亡霊がいる間、魔法被害を軽減。',effect:'自分の亡霊が残っている間、本人が受ける直接魔法被害を{cut}軽減。共通直接軽減70%上限を守る。',rule:{requiresGhost:true,scope:'self_incoming_magic'}});
P('04','霊の采配',series('bonus',[.10,.15,.20]),{pre:['A06'],short:'亡霊への指示攻撃を強める。',effect:'自分が指示する亡霊の手の直接ダメージを{bonus}強化。亡霊の指示回数は増やさない。',rule:{scope:'ghost_manual_command'}});
P('05','魂の余韻',series('bonus',[.10,.15,.20]),{pre:['A05'],short:'魂の消費後、次の闇魔法が強まる。',effect:'魂を消費した行動の終了時から、次の通常の闇属性直接魔法1行動のダメージを{bonus}強化する。本人の次の2行動終了まで。消費した当該技能・奥義・反応には適用しない。',rule:{trigger:'after_soul_spend',scope:'next_normal_dark_direct_magic',turns:2}});
U('亡霊軍の行進',{ref:'M',element:'dark',target:'敵全体',short:'蓄えた魂を使い、亡霊軍で敵全体を攻撃。',effect:'魂を最大3消費し、生存敵全体へ闇属性M（1.80＋消費魂×0.25）倍の直接攻撃。消費魂が0でも使用可能。攻撃後に亡霊（指示2回、次の2行動まで）を呼ぶ。魂獲得や自動追撃は起こさない。',rule:{basePower:1.8,bonusPerSoul:.25,consumeSoulUpTo:3,afterGhost:{charges:2,turns:2},grantSoul:false}});

jobFor('onmyoji');
A('01','陽符',p5(.90,.15),{ref:'M',element:'light',mp:'light',ap:'intro',short:'光魔法で攻撃し、陰陽を巡らせる。',effect:'敵1体に光属性M{power}倍の直接攻撃。実ダメージがあれば直前の有効な闇術から交替した時に調和符を1得る。符は最大2。',rule:{yinYangTrigger:'own_damaging_direct_magic',polarity:'yang'}});
A('02','陰符',p5(.90,.15),{ref:'M',element:'dark',mp:'light',ap:'intro',short:'闇魔法で攻撃し、陰陽を巡らせる。',effect:'敵1体に闇属性M{power}倍の直接攻撃。実ダメージがあれば直前の有効な光術から交替した時に調和符を1得る。符は最大2。',rule:{yinYangTrigger:'own_damaging_direct_magic',polarity:'yin'}});
A('03','護身の結界',series('guard',[.80,1,1.20]),{pre:['A01','A02'],target:'味方1人',short:'調和符1を味方の防護へ変える。',effect:'調和符1を消費し、味方1人へR基準{guard}の防護を2対象行動付与。合計防護は最大HP50%まで。',rule:{requiresSeal:1,consumeSeal:1,shieldBase:'R',turns:2}});
A('04','破邪符',series('count',[1,2,3]),{ref:'M',element:'light',pre:['A01'],short:'光魔法で攻撃し、敵の強化を解除。',effect:'敵1体へ光属性M0.95倍の直接攻撃。実ダメージを与えた時、敵の解除可能な強化を最大{count}個解除。固有行動や属性耐性は解除しない。',rule:{power:.95,removeEnemyBuffs:true,trigger:'damaging_hit'}});
A('05','影縛りの符',series('turns',[2,3,4]),{ref:'M',element:'dark',pre:['A02'],short:'闇魔法で攻撃し、敵を束縛。',effect:'敵1体へ闇属性M0.70倍の直接攻撃。実ダメージ時に基礎30%で束縛を{turns}敵行動付与。通常の状態耐性とボス補正に従う。',rule:{power:.70,status:{id:'bind',rate:.30},trigger:'damaging_hit'}});
A('06','太極符',p5(1.30,.20),{ref:'M',element:'chosen_light_dark',pre:['A03'],mp:'heavy',cost:3,ap:'advanced',short:'符1を使い、光か闇の強魔法。',effect:'調和符1を消費し、光・闇から選んだ属性で敵1体にM{power}倍の直接攻撃。交替判定はこの行動の攻撃終了後。今回消費した符を同じ行動で獲得し直さない。',rule:{requiresSeal:1,consumeSeal:1,chooseElement:['light','dark'],noSameActionSealGain:true}});
A('07','符の転回',series('bonus',[.15,.20,.25]),{pre:['A03'],mp:'light',target:'自分',short:'符1を次の光闇魔法の強化に変える。',effect:'調和符1を消費し、次の通常光・闇属性の直接攻撃魔法1行動を{bonus}強化。本人の次の2行動終了まで。奥義・反応には適用しない。',rule:{requiresSeal:1,consumeSeal:1,nextMagicScope:'normal_light_dark_direct',turns:2}});
A('08','鎮めの符',series('count',[1,2,3]),{pre:['A03'],target:'味方1人',short:'味方1人の異常を除き、結界を整える。',effect:'味方1人の毒・炎上・暗闇・束縛・恐怖・沈黙・混乱・魅了・呪い・衰弱から、残り行動の短い順に最大{count}種類解除。石化・戦闘不能は対象外。',rule:{cure:['poison','burn','blind','bind','fear','silence','confusion','charm','curse','weaken'],tieBreak:'status_id'}});
A('09','双符輪',p5(.75,.15),{ref:'M',element:'light|dark',pre:['A06:2'],mp:'heavy',cost:4,ap:'advanced',short:'符1で光闇の全体魔法。',target:'敵全体',effect:'調和符1を消費し、生存敵全体へ光・闇複合M{power}倍の直接攻撃。各対象への攻撃は1回で、有利な属性相性1つを適用。交替の符獲得は起きない。',rule:{requiresSeal:1,consumeSeal:1,elements:['light','dark'],hitCount:1,noSealGain:true}});
P('01','陰陽連環',series('bonus',[.05,.08,.10]),{pre:['A01','A02'],short:'属性を交替した光闇魔法を強める。',effect:'直前の有効術と属性が異なる通常光・闇直接魔法のダメージを{bonus}強化。符獲得数は増やさず、交替した当該行動にだけ適用。',rule:{trigger:'alternating_light_dark',scope:'normal_direct_magic'}});
P('02','符術の基礎',series('rate',[.04,.06,.08,.10,.12]),{ap:'intro',short:'MAGを上げる。',effect:'本人のMAGを{rate}高める。装備している間だけ有効。',rule:{stat:'mag'}});
P('03','結界熟達',series('bonus',[.10,.15,.20]),{pre:['A03'],short:'自分の結界の防護を高める。',effect:'護身の結界で新たに与える防護量を{bonus}増やす。既存の防護は変えず、最大HP50%上限は守る。',rule:{scope:'onmyoji_A03_at_cast'}});
P('04','符の節約',series('rate',[.20,.30,.40]),{pre:['A03'],short:'符を使う通常技能のMPを節約。',effect:'調和符を消費する通常アクティブ技能のMP費用を{rate}軽減。符の必要数は減らさず、奥義には適用しない。',rule:{scope:'normal_seal_spending_active',mpSave:true}});
P('05','両儀の守り',series('cut',[.06,.09,.12]),{pre:['A01','A02'],short:'交替直後は光闇の被害を軽減。',effect:'光・闇の有効術を交替して実ダメージを与えた後、本人が受ける光・闇の直接被害を{cut}軽減。次の2本人行動終了まで。共通70%軽減上限を守る。',rule:{trigger:'alternating_damaging_magic',scope:'self_light_dark_direct',turns:2}});
U('陰陽大祓',{ref:'M',element:'light|dark',target:'敵全体／生存味方全員',short:'光闇で攻撃し、味方を護る。',effect:'調和符を最大2消費。生存敵全体へ光・闇複合M2.00倍の1回攻撃。生存味方全員にR基準（0.70＋消費符×0.25）の防護を2対象行動付与。符が0でも使用可能。状態異常の完全予防はしない。',rule:{basePower:2,elements:['light','dark'],hitCount:1,consumeSealUpTo:2,shieldBase:'R',shieldBaseRate:.7,bonusPerSeal:.25,turns:2}});

jobFor('shrine_maiden');
A('01','厄除け神楽',series('rate',[.25,.35,.45]),{ap:'intro',target:'生存味方全員',short:'神楽で味方の状態異常耐性を上げる。',effect:'厄除け神楽を開始。生存味方全員の毒・炎上・暗闇・束縛・恐怖・沈黙・混乱・魅了・呪い・衰弱の新規付与率を{rate}乗算軽減する。次の各対象2行動まで。既存の異常は治さない。',rule:{kagura:'prevention',statuses:['poison','burn','blind','bind','fear','silence','confusion','charm','curse','weaken'],turns:2}});
A('02','水祓',series('count',[1,2,3]),{ap:'intro',mp:'light',target:'味方1人',short:'味方1人の状態異常を除く。',effect:'味方1人の治療可能な異常を残り行動の短い順に最大{count}種類解除。石化・戦闘不能は解除不可。同数の場合は状態ID順。',rule:{cure:'curable',tieBreak:'status_id'}});
A('03','神光',p5(.95,.15),{ref:'M',element:'light',mp:'light',ap:'intro',short:'光魔法で敵を攻撃する。',effect:'敵1体へ光属性M{power}倍の直接攻撃。神楽や異常の有無に依存せず使用できる。'});
A('04','癒し神楽',series('regen',[.05,.07,.09]),{pre:['A01'],target:'生存味方全員',short:'神楽で味方のHPを継続回復。',effect:'癒し神楽を開始。生存味方は各自の行動機会終了時に最大HPの{regen}を回復する。次の各対象2行動まで。戦闘不能中は回復しない。',rule:{kagura:'regeneration',turns:2}});
A('05','護り神楽',series('cut',[.08,.10,.12]),{pre:['A01'],target:'生存味方全員',short:'神楽で直接被害を軽減する。',effect:'護り神楽を開始。生存味方全員の直接被害を{cut}軽減する。次の各対象2行動まで。共通70%軽減上限を守る。',rule:{kagura:'protection',turns:2}});
A('06','清めの舞',series('power',[.60,.80,1]),{pre:['A02'],mp:'heavy',target:'生存味方全員',short:'味方全員の異常1種類を除き、回復。',effect:'生存味方全員にH{power}倍のHP回復を行い、各対象の治療可能な異常を1種類解除。解除する異常は残り行動の短い順。石化・戦闘不能は対象外。',rule:{healBase:'H',cureCount:1}});
A('07','神籬',series('guard',[.90,1.10,1.30]),{pre:['A05'],target:'味方1人',short:'味方1人を防護で守る。',effect:'味方1人へR基準{guard}の防護を2対象行動付与。味方最大HP50%の共通防護上限内で適用。',rule:{shieldBase:'R',turns:2}});
A('08','戒めの光',p5(1, .15),{ref:'M',element:'light',pre:['A03'],short:'光魔法とMAG低下で敵を抑える。',effect:'敵1体へ光属性M{power}倍の直接攻撃。実ダメージ時に基礎75%で敵MAGを10%下げ、次の2敵行動まで持続。能力低下の共通上限を守る。',rule:{statDebuff:{stat:'mag',rate:.75,value:.1,turns:2},trigger:'damaging_hit'}});
A('09','奉納の祈り',series('restore',[3,4,5]),{pre:['A04','A05'],mp:'heavy',cost:3,ap:'advanced',target:'自分以外の生存味方',short:'戦闘中一度、仲間のMPを少し回復。',effect:'1戦1回。自分以外の生存味方全員のMPをそれぞれ{restore}回復。各対象の最大MPの10%まで、端数は切り捨て、最低0。自身には戻らず、MP費用を支払った後に適用する。',rule:{excludeCaster:true,oncePerBattle:true,mpRestoreCapMaxMp:.1}});
P('01','祓いの心得',series('bonus',[.05,.08,.10]),{pre:['A02'],short:'異常を治した味方を少し回復する。',effect:'本人の通常技能で対象の異常を実際に1種類以上解除した時、各対象を最大HPの{bonus}だけ1行動1回回復する。治せなかった時は回復しない。',rule:{trigger:'own_successful_cure',perTargetPerAction:1}});
P('02','神前の修練',series('rate',[.04,.06,.08,.10,.12]),{ap:'intro',short:'RESを上げる。',effect:'本人のRESを{rate}高める。装備している間だけ有効。',rule:{stat:'res'}});
P('03','巫舞の熟達',series('bonus',[.10,.15,.20]),{pre:['A04','A05'],short:'自分の神楽の再生・軽減を高める。',effect:'自分が新たに開始した癒し神楽の回復率または護り神楽の軽減率を、それぞれ元の率の{bonus}だけ増やす。既存の神楽は遡って変えない。',rule:{scope:'own_kagura_on_cast',variants:['regeneration','protection']}});
P('04','災厄予知',series('rate',[.10,.15,.20]),{pre:['A01'],short:'神楽中は自身の異常に強い。',effect:'有効な神楽がある間、本人への新規状態異常付与率をさらに{rate}乗算軽減する。加算で100%耐性を作らず、既存の異常は治さない。',rule:{requiresKagura:true,scope:'self_new_status'}});
P('05','祝詞の響き',series('bonus',[.05,.08,.10]),{pre:['A03','A01'],short:'神楽中、味方の光魔法を少し強める。',effect:'有効な自分の神楽中、生存味方の通常光属性直接魔法のダメージを{bonus}強化する。同名効果が複数ある場合は最大値1件だけを適用し、奥義・反応は対象外。',rule:{requiresOwnKagura:true,scope:'party_normal_light_magic',stack:'max_one'}});
U('大祓の神楽',{target:'生存味方全員',short:'全員を浄化・回復し、次の異常を一度防ぐ。',effect:'生存味方全員の治療可能な異常を各2種類解除し、H1.20倍で回復する。各対象の次の2本人行動まで、通常の新規状態異常の付与を一度だけ防ぐ予防札を付ける。石化・戦闘不能やボス固有の解除不能効果は治さず、予防札は既存異常に遡らない。',rule:{cureCount:2,healBase:'H',healPower:1.2,preventNextStatus:{charges:1,turns:2},excludes:['petrify','ko','uncurable']}});

jobFor('summoner');
A('01','三精の契約',constant,{ap:'intro',target:'自分',short:'炎・土・水から契約先を選ぶ。',effect:'炎・土・水から1つを選び契約する。呼び出し残回数2、本人の次の3行動終了まで。契約は本人1枠のみで、上書き時は旧契約を破棄。契約しただけでは攻撃・回復・行動は発生しない。',rule:{chooseContract:['fire','earth','water'],charges:2,turns:3,durationBasis:'owner_opportunity'}});
A('02','小精霊の一撃',p5(.90,.15),{ref:'M',element:'fire',mp:'light',ap:'intro',short:'契約なしでも炎魔法で攻撃。',effect:'敵1体へ炎属性M{power}倍の直接攻撃。契約と残回数を必要とせず、契約を増やさない。'});
A('03','火精招来',p5(1.45,.20),{ref:'M',element:'fire',pre:['A01','A02'],mp:'heavy',cost:3,short:'火の契約1回を使い、強い炎魔法。',effect:'火の契約の呼び出し回数1を消費し、敵1体へ炎属性M{power}倍の直接攻撃。別属性の契約では使えない。',rule:{requiresContract:'fire',contractChargeCost:1}});
A('04','地精招来',series('guard',[.70,1,1.30]),{pre:['A01'],target:'生存味方全員',short:'土の契約1回を使い、全員に防護。',effect:'土の契約の呼び出し回数1を消費し、生存味方全員へR基準{guard}の防護を2対象行動付与。合計防護は各自最大HP50%まで。',rule:{requiresContract:'earth',contractChargeCost:1,shieldBase:'R',turns:2}});
A('05','水精招来',series('power',[.65,.85,1.05]),{pre:['A01'],target:'生存味方全員',short:'水の契約1回を使い、全員を回復。',effect:'水の契約の呼び出し回数1を消費し、生存味方全員へH{power}倍のHP回復を行う。戦闘不能は復活させない。',rule:{requiresContract:'water',contractChargeCost:1,healBase:'H'}});
A('06','盟約の守り',series('rate',[.25,.35,.45]),{pre:['A01'],target:'味方1人',short:'契約1回を使い、味方の状態異常を防ぎやすくする。',effect:'有効な任意の契約の呼び出し回数1を消費し、味方1人への通常の新規状態異常の付与率を{rate}乗算軽減。次の2対象行動まで。既存異常は解除しない。',rule:{requiresContract:'any',contractChargeCost:1,turns:2,scope:'new_status'}});
A('07','契約変更',constant,{pre:['A01'],mp:'light',target:'自分',short:'残回数を使い、契約属性を変更。',effect:'残回数1以上の自分の契約を、現在とは異なる炎・土・水の1つに変更する。残回数を1消費し、残り期限を延長しない。新契約を作ったり使い切った契約を回復したりしない。',rule:{requiresContract:'any',chooseContract:['fire','earth','water'],mustDiffer:true,contractChargeCost:1,noRefresh:true}});
A('08','連召の陣',p5(1.40,.30),{ref:'M',element:'contract',pre:['A01','A03'],mp:'heavy',cost:4,ap:'advanced',short:'契約2回を使い、選んだ属性で全体攻撃。',target:'敵全体',effect:'有効な契約の呼び出し回数2を消費し、生存敵全体へ契約と同じ属性のM{power}倍で直接攻撃。土・水契約でも攻撃属性だけ変え、追加回復や防護はない。',rule:{requiresContract:'any',contractChargeCost:2,elementFromContract:true}});
A('09','契約解放',series('power',[.70,.90,1.10]),{pre:['A01','A07'],mp:'light',target:'契約に応じて敵1体／味方全員',short:'残りの契約を解き、最後の効果を得る。',effect:'有効な契約の残回数を全消費し、炎なら敵1体に炎M{power}倍攻撃、土なら生存味方全員にR{power}倍の防護2行動、水なら生存味方全員にH{power}倍回復を行う。残回数2なら最終倍率を1.2倍する。契約期限は戻らない。',rule:{requiresContract:'any',consumeAllContract:true,variants:['fire_attack','earth_shield','water_heal'],twoChargeMultiplier:1.2}});
P('01','強き契約',series('bonus',[.05,.10,.15]),{pre:['A01'],short:'契約に合う通常召喚攻撃を強める。',effect:'契約と一致する属性の自分の通常召喚直接攻撃を{bonus}強化する。契約が消えた後や別属性の攻撃には適用しない。',rule:{requiresContract:'matching',scope:'own_normal_summon_attack'}});
P('02','召喚術の基礎',series('rate',[.04,.06,.08,.10,.12]),{ap:'intro',short:'MAGを上げる。',effect:'本人のMAGを{rate}高める。装備している間だけ有効。',rule:{stat:'mag'}});
P('03','盟約の節約',series('rate',[.20,.30,.40]),{pre:['A01'],short:'契約を使う通常技能のMPを軽減。',effect:'契約残回数を消費する通常アクティブ技能のMP費用を{rate}軽減。残回数の消費自体は減らさず、奥義は対象外。',rule:{scope:'contract_spending_normal_active',mpSave:true}});
P('04','長き契約',series('turns',[1,2,3]),{pre:['A01'],short:'新たな契約の期限を延ばす。',effect:'新たに三精の契約を結ぶ時、契約の期限を本人の行動機会{turns}回分延長する。旧契約を延長しない。呼び出し回数2は増やさない。',rule:{scope:'contract_on_cast',chargesUnchanged:true}});
P('05','契約の守護',series('cut',[.06,.09,.12]),{pre:['A01'],short:'契約中の本人の被害を軽減。',effect:'有効な契約がある間、本人への直接被害を{cut}軽減する。共通70%軽減上限を守り、契約終了後には残らない。',rule:{requiresContract:'any',scope:'self_incoming_direct'}});
U('三精顕現',{target:'選択先に応じて敵全体／味方全員',short:'炎の全体攻撃、土の防護、水の回復から選ぶ。',effect:'炎・土・水から1つを選ぶ。炎は生存敵全体に炎M2.40倍の直接攻撃。土は生存味方全員へR1.50の防護を2対象行動。水は生存味方全員をH1.40倍回復。選んだ属性と同じ契約があれば残回数を1消費し、最終効果を10%増やす。契約なしでも使え、追加行動は生まない。',rule:{chooseElement:['fire','earth','water'],variants:{fire:{base:'M',power:2.4},earth:{base:'R',power:1.5,turns:2},water:{base:'H',power:1.4}},matchingContractChargeCost:1,matchingBonus:.1}});

jobFor('druid');
A('01','種まき',series('turns',[4,5,6]),{ap:'intro',target:'自分の種枠',short:'種を植え、行動ごとに成長させる。',effect:'本人の種枠に種を1つ植える。本人の次の{turns}行動終了まで。次の行動機会終了時から成長が1ずつ増え、最大3。種は本人最大2つ、3つ目を植える時は古い種を置き換える。',rule:{seedSlots:2,initialGrowth:0,maxGrowth:3,growthPerOwnerOpportunity:1,durationBasis:'owner_opportunity'}});
A('02','木霊弾',p5(.90,.15),{ref:'M',element:'earth',mp:'light',ap:'intro',short:'種がなくても土魔法で攻撃。',effect:'敵1体へ土属性M{power}倍の直接攻撃。種の数で自動強化しない。獣化中は使用不可。'});
A('03','清流弾',p5(.90,.15),{ref:'M',element:'water',mp:'light',ap:'intro',short:'種がなくても水魔法で攻撃。',effect:'敵1体へ水属性M{power}倍の直接攻撃。種の数で回復を発生させない。獣化中は使用不可。'});
A('04','育成',series('growth',[1,2,3]),{pre:['A01'],mp:'light',target:'自分の種1つ',short:'種1つの成長を早める。',effect:'自分の種1つを選び、成長を{growth}加える。最大成長3。対象のない時はMPを払わない。期限・種の数は増えず、この行動の自然成長は育成後の行動終了時に一度だけ処理する。',rule:{requiresSeed:true,chooseSeed:true,growthCap:3,naturalGrowthOrder:'after_skill'}});
A('05','根縛り',series('turns',[2,3,4]),{pre:['A01'],target:'敵1体',short:'育った種を使って敵を束縛。',effect:'成長1以上の自分の種1つから成長1を消費。敵1体を基礎40%で束縛し、成功時は{turns}敵行動持続。失敗しても成長は消費する。耐性とボス補正を適用。',rule:{requiresSeedGrowth:1,consumeGrowth:1,status:{id:'bind',rate:.40}}});
A('06','薬草摘み',series('power',[.80,1,1.20]),{pre:['A01'],target:'味方1人',short:'育った種を使って味方を回復。',effect:'成長1以上の自分の種1つから成長1を消費し、味方1人をH{power}倍回復。戦闘不能は治さない。',rule:{requiresSeedGrowth:1,consumeGrowth:1,healBase:'H'}});
A('07','獣化',series('turns',[2,3,4]),{pre:['A02'],target:'自分',short:'獣姿になり、専用技を使えるようにする。',effect:'本人が獣化し、次の{turns}本人行動終了まで継続する。通常攻撃は打撃BM0.75倍に置き換わる。獣化中は通常攻撃・道具・獣爪・獣咆・森の大いなる芽・獣化の再使用だけ可能。獣化を再使用した場合はMP0・行動1回消費で即座に解除。種は成長し続けるが人型の術や収穫は使えない。',rule:{form:'beast',allowedActions:['normal_attack','item','druid_A07','druid_A08','druid_A09','druid_U01'],normalAttack:{base:'BM',power:.75,element:'blunt'},recastToDismiss:{mp:0,usesAction:true},durationBasis:'owner_opportunity'}});
A('08','獣爪',p5(1.10,.20),{ref:'BM',element:'slash',pre:['A07'],mp:'light',short:'獣化中、MAGで物理攻撃。',effect:'獣化中のみ使用可能。敵1体へ斬撃属性BM{power}倍の物理直接攻撃。MAGと術補助を1回参照し、相手DEFで軽減。STR・通常武器威力は加えない。',rule:{requiresForm:'beast',defense:'def',stat:'mag'}});
A('09','獣咆',p5(.70,.15),{ref:'BM',element:'blunt',pre:['A07:2','A08'],mp:'heavy',cost:4,ap:'advanced',short:'獣化中、全体へ打撃と恐怖。',target:'敵全体',effect:'獣化中のみ使用可能。生存敵全体へ打撃属性BM{power}倍の物理直接攻撃。実ダメージ時に各敵へ基礎30%で恐怖を2敵行動付与。敵ごとに耐性・ボス補正を適用。',rule:{requiresForm:'beast',defense:'def',stat:'mag',status:{id:'fear',rate:.30,turns:2},trigger:'damaging_hit'}});
P('01','根の恵み',series('bonus',[.10,.15,.20]),{pre:['A06'],short:'種で行う回復を強める。',effect:'自分の薬草摘みのHP回復量を{bonus}増やす。種の成長消費は減らさず、その他の回復技能に適用しない。',rule:{scope:'druid_A06_heal'}});
P('02','自然魔術の基礎',series('rate',[.04,.06,.08,.10,.12]),{ap:'intro',short:'MAGを上げる。',effect:'本人のMAGを{rate}高める。獣化中のBM技にもMAGとして反映。',rule:{stat:'mag'}});
P('03','獣皮',series('cut',[.06,.09,.12]),{pre:['A07'],short:'獣化中の被害を軽減。',effect:'獣化中、本人が受ける直接被害を{cut}軽減。共通70%軽減上限を守り、変身が切れた後は適用しない。',rule:{requiresForm:'beast',scope:'self_incoming_direct'}});
P('04','若葉の息吹',series('regen',[.03,.04,.05]),{pre:['A01'],short:'育った種があれば自分を少し回復。',effect:'成長1以上の種がある間、本人の行動機会終了時に最大HPの{regen}を回復。種が2つでも1回だけ。戦闘不能・石化中は回復せず、種の成長は消費しない。',rule:{requiresSeedGrowth:1,perOpportunity:1}});
P('05','野生の一撃',series('bonus',[.05,.10,.15]),{pre:['A08'],short:'獣技の攻撃を強める。',effect:'獣化中の獣爪・獣咆の直接ダメージを{bonus}強化。通常攻撃と人型の魔法・他職技能には適用しない。',rule:{requiresForm:'beast',scope:['druid_A08','druid_A09']}});
U('森の大いなる芽',{ref:'M',element:'earth',target:'敵全体／生存味方全員',short:'育った種を収穫し、攻撃と全体回復。',effect:'自分の種を最大2つ全消費する。成長値の合計を最大6として、生存敵全体へ土属性M（1.30＋成長合計×0.08）倍で1回攻撃。生存味方全員をH（1.00＋成長合計×0.10）倍回復。種0でも基礎効果を使え、獣化中でも使用可能だが獣化は解除する。',rule:{consumeSeedsUpTo:2,growthTotalCap:6,attack:{base:'M',power:1.3,perGrowth:.08,element:'earth'},heal:{base:'H',power:1,perGrowth:.10},dismissForm:true}});

jobFor('astrologer');
A('01','流星の予兆',p5(1,.15),{ref:'M',element:'light',mp:'light',ap:'intro',short:'次の本人行動後、敵1体へ光魔法。',effect:'敵1体に光属性M{power}倍の1回攻撃を予約。本人の次の行動機会終了時に解決する。対象が倒れた時は空振りし、発動時の本人の状態と標的の相性を確認する。',rule:{forecast:'attack',delay:1,targetLock:true,hitCount:1}});
A('02','守護の予兆',series('guard',[.70,1,1.30]),{pre:['A01'],target:'味方1人',short:'次の本人行動後、味方1人に防護。',effect:'味方1人へのR基準{guard}の防護を予約。本人の次の行動機会終了時に付与し、付与後は次の2対象行動持続。対象が戦闘不能なら不発。防護上限は最大HP50%。',rule:{forecast:'shield',delay:1,shieldBase:'R',shieldTurns:2,targetLock:true}});
A('03','星屑',p5(.85,.15),{ref:'M',element:'none',mp:'light',ap:'intro',short:'即時に無属性魔法で攻撃。',effect:'敵1体へ無属性M{power}倍の直接攻撃。予兆枠を使わず、予約を早めたり重ねたりしない。'});
A('04','癒しの予兆',series('power',[.65,.85,1.05]),{pre:['A01'],target:'味方1人',short:'次の本人行動後、味方1人を回復。',effect:'味方1人へのH{power}倍のHP回復を予約。本人の次の行動機会終了時に解決。対象が戦闘不能なら不発、復活はしない。',rule:{forecast:'heal',delay:1,healBase:'H',targetLock:true}});
A('05','遠星',p5(1.10,.20),{ref:'M',element:'light',pre:['A01:2'],mp:'heavy',cost:3,short:'2行動先に敵全体へ光魔法を予約。',target:'敵全体',effect:'生存敵全体へ光属性M{power}倍の1回攻撃を予約。本人の次の2行動機会が終了した時に解決。予約時に存在した敵のうち、発動時に生存する対象だけを攻撃。',rule:{forecast:'attack_all',delay:2,targets:'alive_at_cast',hitCount:1}});
A('06','星読みの加速',constant,{pre:['A01'],mp:'light',target:'自分の予兆1つ',short:'自分の予兆を1行動分早める。',effect:'自分の未発動の予兆1つを選び、残り本人行動数を1減らす。0になった予兆はこの行動終了時に1回解決する。既に発動した予兆や他人の予兆を選べず、連鎖発動しない。',rule:{requiresForecast:true,chooseOwnForecast:true,advance:1,noChain:true}});
A('07','星路変更',constant,{pre:['A01'],mp:'light',target:'自分の攻撃予兆1つ／敵1体',short:'予約した単体攻撃の狙いを変える。',effect:'未発動の自分の単体攻撃予兆を1つ選び、生存敵1体へ目標を変更。残り行動数と威力は保存。全体・回復・防護の予兆は変更不可。',rule:{requiresForecast:'single_attack',retargetTo:'living_enemy',noRefresh:true}});
A('08','星の導き',series('bonus',[.10,.15,.20]),{pre:['A02','A04'],target:'自分の予兆1つ',short:'予兆の解決後、次の味方の攻撃を強める。',effect:'未発動の自分の予兆1つへ導きを添える。その予兆が実際に解決した場合、対象となった味方1人の次の通常直接攻撃1行動のダメージを{bonus}強化する。次の2対象行動まで。敵対象の予兆では術者本人に付与。対象消滅で不発なら付与しない。',rule:{requiresForecast:true,attach:true,afterResolution:'next_normal_direct_attack',turns:2}});
A('09','天球群',p5(.80,.15),{ref:'M',element:'none',pre:['A05'],mp:'heavy',cost:4,ap:'advanced',short:'次の本人行動後、敵全体へ無属性魔法。',target:'敵全体',effect:'生存敵全体へ無属性M{power}倍の1回攻撃を予約。本人の次の行動機会終了時に、予約時に存在した敵のうち生存者へ発動。通常の属性相性は無属性1.0。',rule:{forecast:'attack_all',delay:1,targets:'alive_at_cast',hitCount:1}});
P('01','先見',series('rate',[.10,.15,.20]),{pre:['A01'],short:'予兆がある間、回避率を上げる。',effect:'未発動の自分の予兆が1つ以上ある間、本人の回避率を{rate}ポイント高める。共通回避率60%上限を守る。予兆が2つでも重ねない。',rule:{requiresForecast:true,stat:'evasion',stack:'one'}});
P('02','星術の基礎',series('rate',[.04,.06,.08,.10,.12]),{ap:'intro',short:'MAGを上げる。',effect:'本人のMAGを{rate}高める。予兆は設置時のMAGを保存する。',rule:{stat:'mag'}});
P('03','予兆の精度',series('bonus',[.05,.10,.15]),{pre:['A01'],short:'設置する予兆の効果を高める。',effect:'自分が新たに予約する攻撃・回復・防護の予兆の基礎倍率を{bonus}高め、予約時に固定する。既存の予兆は強めず、通常の即時技能には適用しない。',rule:{scope:'forecast_on_placement',snapshot:true}});
P('04','星の余光',series('restore',[2,3,4]),{pre:['A01'],short:'予兆が実際に発動するとMPを少し回復。',effect:'自分の予兆が実際に効果を発揮した行動の終了時にMPを{restore}回復。予兆が複数解決しても本人の1行動機会につき1回、1戦で最大3回。空振り・回復0・取消では回復せず、最大MPを超えない。',rule:{trigger:'effective_forecast_resolution',perOpportunity:1,perBattle:3}});
P('05','見切り',series('cut',[.06,.09,.12]),{pre:['A02'],short:'予兆を待つ間、直接被害を軽減。',effect:'自分の未発動の予兆が1つ以上ある間、本人への直接被害を{cut}軽減する。予兆数で重ねず、共通70%軽減上限を守る。',rule:{requiresForecast:true,scope:'self_incoming_direct',stack:'one'}});
U('大星図',{ref:'M',element:'light',target:'敵全体／生存味方全員',short:'攻撃と防護を予約し、既存の予兆を早める。',effect:'既存の自分の予兆をそれぞれ1本人行動機会早め、0になったものはこの行動終了時に1回ずつ解決。その後、今いる生存敵全体へ光属性M1.70倍の攻撃予兆と、生存味方全員へR1.20の防護予兆を各1つ予約する。新規の2つは次の本人行動機会終了時に解決。奥義の新規枠は通常2枠の外に置き、最大合計4枠。追加の行動は生まない。',rule:{advanceExisting:1,afterForecasts:[{type:'attack_all',base:'M',element:'light',power:1.7,delay:1},{type:'party_shield',base:'R',power:1.2,delay:1}],totalSlotCap:4,noChain:true}});

const commonRules=[
 '設計段階の90技能。ゲームのdata/skills.csv・転職可否・戦闘実装・既存セーブには反映しない。各職は通常アクティブ9、パッシブ5、奥義1。',
 'A/Pの装備容量は別々に各10、奥義は専用枠。costは技能単位で固定し、Lv強化で変えない。MP軽/中/重は3/6/12。奥義の通常MPは0で、専用ゲージと同職の非奥義10種類修得を必要とする。',
 '修得APは導入10・標準18・発展28・奥義50。Lv2以降の強化APは順に12/20/30/45。前提は修得時のみ、習得後は他職に継承可。固有資源を使う技能はその資源が有効な時だけ発動。',
 'MはMAG＋通常の術補助を参照しRESで軽減、MSは鎌の独立術補助を追加する魔法、BMはMAG＋術補助を一度だけ使いDEFで軽減する獣技。Hは既存の回復式、Rはfloor(10＋0.5×使用者Lv＋使用者RES)。物理/魔法の命中・属性相性・共通防護/軽減上限を守る。',
 '本人の行動機会は、実行・妨害・不正解で進むが、問題待ち保存・再読込・英語音声・追加反応では進まない。新規付与は当該行動で期限を減らさない。敵行動基準と対象本人行動基準は別管理する。',
 '固有資源や対象の不足、選択属性の不正、対象の戦闘不能はMP・HP・素材・ゲージ・資源を払う前に検証。正規の命中判定や異常付与失敗では支払った費用を戻さない。戦闘不能・全滅・戦闘終了で各人の専用状態を消す。JSON保存で付与者・対象・技能ID/Lv・スナップショット能力・残り回数/期限・処理順を維持する。',
 '魂は本人ごと最大3、1行動で最大1獲得。魂灯の実ダメージ時だけ獲得し、敵撃破だけで増やさない。亡霊は本人の技能指示時のみ行動し、指示時の本人MAGと術補助を参照する。亡霊は追加の味方枠を占めない。',
 '陰陽の調和符は本人ごと最大2。本人の光/闇直接術が実ダメージを与え、直前の有効術と属性が交替した時だけ1増える。同属性の連続使用は直前属性を更新するが符は増えない。予兆や反応、複合属性、治療、奥義は交替履歴を変えない。',
 '神楽はパーティ全体で1枠だけ有効。同名も異名も新規神楽で置き換える。各対象の残期間は独立。神楽の交替時に既存の持続効果は消し、遡ってHPや状態異常を戻さない。',
 '契約は本人ごと1枠、選んだ属性・残回数・本人の残行動機会を保持。契約変更は呼び出し残回数を1消費し、期限・残回数を補充しない。自動攻撃、身代わり、追加の味方行動は作らない。',
 '種は本人ごと最大2つ、成長0〜3。成長は本人の行動機会終了ごとに1、新規種は当該行動で成長しない。成長を消費する技能は対象種を選ぶ。成長が0になっても種と残期限は維持する。獣化中は指定した技能と通常攻撃・道具に限定する。',
 '予兆は本人ごと通常最大2枠。配置時に技能Lv・MAG/術補助・倍率・対象集合を保存し、本人の次の行動機会終了時に解決。星読み・奥義の加速は通常の期限減算に追加する1回分であり、その行動終了時に一度だけ解決する。新規配置の予兆は当該行動で減算しない。期限到来の予兆は配置順に各1回処理し、反応やMP回復から別予兆を連鎖発動させない。敵単体が死亡したら不発、全体は予約時の敵集合のうち生存者のみ。本人が戦闘不能なら予兆を消す。',
 '状態異常は既存の敵相性・ボス補正と上限を適用。異常予防は新規付与にだけ作用し、敵の固有行動や石化の特別な無効条件を上書きしない。直接ダメージ・回復・防護の共通上限を適用した後に追加効果を判定する。'
];
const all=jobs.flatMap(j=>j.skills),byId=new Map(all.map(s=>[s.id,s]));
assert.equal(all.length,90);assert.equal(byId.size,90);
for(const j of jobs){assert.deepEqual([j.skills.filter(s=>s.type==='active').length,j.skills.filter(s=>s.type==='passive').length,j.skills.filter(s=>s.type==='ultimate').length],[9,5,1]);
  for(const s of j.skills){assert.ok(s.effects.every(Boolean));assert.equal(s.levelRules.length,s.maxLevel);
    assert.ok(!s.weapons.some(id=>!['staff','tome','scythe','fan','whip'].includes(id)));
    for(const p of s.prerequisites){assert.ok(byId.has(p.id),s.id+' prerequisite '+p.id);assert.ok(p.level<=byId.get(p.id).maxLevel);}
  }}
const spec={schemaVersion:1,title:'English Quest 追加職19〜24技能設計 v1',date:'2026-11-26',status:'design_only',
 references:['docs/jobs-baseline-v2.md','docs/specs/additional-jobs-10-18-skills-v1.json'],
 formulas:{M:previous.formulas.M,MS:previous.formulas.MS,BM:'MAG＋装備の術補助を参照する物理攻撃。STR・通常武器威力を重ねずDEFで軽減。',H:'既存の回復式。生存味方が対象。',R:previous.formulas.R,F:previous.formulas.F},
 commonRules,jobs,validation:{jobs:jobs.length,skills:all.length,stages:all.reduce((n,s)=>n+s.maxLevel,0),
  active:54,passive:30,ultimate:6}};
fs.writeFileSync(new URL('docs/specs/additional-jobs-19-24-skills-v1.json',root),JSON.stringify(spec,null,2)+'\n');
const out=['# English Quest：追加職19〜24 スキル設計 v1','',
 '2026-11-26。**設計のみ**。50職基準表No.27〜32に相当する6職・90技能。実装値は変更していない。各技能の全段階の本文・数値・条件は[仕様JSON](specs/additional-jobs-19-24-skills-v1.json)を正本とする。','',
 '## 共通の前提','',...commonRules.map(s=>'- '+s),'',
 '## 職業ごとの技能','',
 '表中の「Lv1→最大」は最初と最後の効果で、途中段階と構造化された発動条件は仕様JSONを参照。MPは固定。前提のLvは省略時1。',''];
for(const j of jobs){out.push(`### 追加${j.additionalNumber}：${j.name}`,'',j.role,'',`既存職との差：${j.difference}`,'',
 '| ID・技能 | Lv | 装備cost | MP | 修得AP | 前提 | Lv1 → 最大の詳細 |','| --- | ---: | ---: | ---: | ---: | --- | --- |');
 for(const s of j.skills){const pre=s.prerequisites.map(p=>p.id.split('_').at(-1)+(p.level>1?` Lv${p.level}`:'')).join('・')||'なし';
  const description=s.effects.length===1?s.effects[0]:`${s.effects[0]} → ${s.effects.at(-1)}`;
  out.push(`| ${s.id.split('_').at(-1)} ${s.name} | ${s.maxLevel} | ${s.cost} | ${s.baseMp} | ${s.learnAp} | ${pre} | ${description.replaceAll('|','／')} |`);
 }out.push('');}
out.push('## 代表的な使い方','',
 '| 職 | 3行動前後の例 | 成立する条件 |','| --- | --- | --- |',
 '| 死霊術師 | 魂灯 → 亡霊招来 → 亡霊の手 | 魂灯で実ダメージを与えて魂1を得る。亡霊への指示が行動を消費する。 |',
 '| 陰陽師 | 陽符 → 陰符 → 護身の結界 | 2発とも実ダメージなら交替で調和符1を得る。 |',
 '| 巫女 | 厄除け神楽 → 水祓 → 護り神楽 | 護り神楽は厄除けを置き換え、重ね掛けにならない。 |',
 '| 召喚士 | 三精の契約（炎） → 火精招来 → 火精招来 | 契約の呼び出し回数2を使い切る。 |',
 '| ドルイド | 種まき → 木霊弾 → 薬草摘み | 木霊弾の行動終了時に種が成長1になり、次の行動で収穫できる。 |',
 '| 占星術師 | 流星の予兆 → 星屑 | 星屑の行動終了時に予約済みの流星を一度だけ解決する。 |','',
 '## 設計上の境界','',
 '- 巫女と白魔導士：神楽は敵の行動に備える継続支援。即時回復と復活は白魔導士が主力。',
 '- 死霊術師・魔女・呪術師：亡霊は術者が指示、使い魔は術者の攻撃後、呪印は敵の行動後に反応。',
 '- 召喚士・精霊術士・ドルイド：契約は有限回の即時技能、場は敵味方の属性相性、種は自分の行動で成長して消費。',
 '- 占星術師・竜騎士：予兆は複数枠の攻撃/回復/防護予約、跳躍は本人が次の着地行動を取る。',
 '- 今後の実装時には6人編成の勝率、必要MP、追加行動の発生源、全体防護と回復、ボス異常耐性をシミュレーションする。','',
 `設計集計：${jobs.length}職、${all.length}技能、${spec.validation.stages}成長段階（通常54、パッシブ30、奥義6）。`,`生成：\`node scripts/design-additional-jobs-19-24.mjs\`.`,'');
fs.writeFileSync(new URL('docs/additional-jobs-19-24-skills-v1.md',root),out.join('\n'));
console.log(`${jobs.length}職・${all.length}技能・${spec.validation.stages}段階を設計`);
