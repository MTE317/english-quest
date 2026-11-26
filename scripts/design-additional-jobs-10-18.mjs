// 追加10〜18職の設計書を生成する。ゲームのCSV・実行コード・解放状態は変更しない。
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {parseCsv} from '../game/js/csv.js';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const baseCommit='a3190d0c382d62ef765e184bffa864689a6709f0';
const rules=JSON.parse(fs.readFileSync(path.join(root,'data/basic_job_rules.json'),'utf8'));
const roster=parseCsv(fs.readFileSync(path.join(root,'data/jobs_mid.csv'),'utf8')).rows;
const existing=parseCsv(fs.readFileSync(path.join(root,'data/skills.csv'),'utf8')).rows;
const jobs=[];let job;
const attribute={slash:'斬撃',pierce:'刺突',blunt:'打撃',fire:'炎',ice:'氷',thunder:'雷',wind:'風',earth:'土',water:'水',light:'光',dark:'闇',none:'無'};
const section={party:'全体の強化・弱化',ongoing:'ジョブの固有継続効果',special:'その他の特殊効果'};
const weaponNames={sword:'剣',greatsword:'大剣',katana:'刀',dagger:'短剣',axe:'斧',spear:'槍',bow:'弓',hammer:'鎚',fist:'拳',gun:'銃',whip:'鞭',scythe:'鎌'};
const weapons={none:[],dagger:['dagger'],bow:['bow'],assassin:['dagger','bow'],ranged:['bow','gun'],spear:['spear'],gun:['gun'],pirate:['axe','sword'],blades:['sword','katana'],scythe:['scythe'],physical:Object.keys(weaponNames)};
const formulas={
 W:'STR＋物理武器威力を使う既存の武器攻撃基礎式。対象DEFで軽減。物理武器12種のみ。',
 M:'MAGを使う既存の直接魔法基礎式。対象RESで軽減。杖・魔導書・楽器・扇の共通術装備補助だけを加え、物理武器威力を加えない。',
 MS:'鎌術のMAG基礎式。鎌装備時の術補助だけを(3＋1.8×武器Lv)×品質×(1＋0.05×強化値)×武器適性倍率で追加する。鎌以外では通常のMと同じ術装備補助。物理武器威力・通常攻撃倍率を流用せず、装備補助を二重加算しない。対象RESで軽減。設計案で未実装。',
 WB:'複合武器基礎：STR＋物理武器威力＋0.35×MAG。倍率・属性・DEF軽減・会心は全体へ各1回。物理武器のみ。STRとMAGの能力強化は各能力へ1回ずつ。',
 R:'B_RES＝floor(10＋0.5×使用者Lv＋RES)。防護共通上限は対象最大HPの50%。',
 F:'本文と構造化されたlevelRulesに記す固定割合・機能・条件。支援へ攻撃属性を付けない。'
};
const pct=v=>Math.round(v*100)+'%';
const L=(detail,short,parameters)=>({detail,short,parameters});
const fixed=(detail,short,parameters)=>[L(detail,short,parameters)];
const tiers=(values,fn)=>values.map(fn);
function J(id,name,role,difference,state){
 const baseline=roster.find(r=>r.id===id);assert.ok(baseline);
 job={id,name,additionalNumber:roster.findIndex(r=>r.id===id)+1,masterNumber:roster.findIndex(r=>r.id===id)+9,role,difference,state,
  baseline:Object.fromEntries(['role','s_weapons','a_weapons','main_elements','support_elements','stat_reference','style','ultimate_concept'].map(k=>[k,baseline[k]])),skills:[]};jobs.push(job);
}
function S(code,name,o,levels){
 const type=code[0]==='A'?'active':code[0]==='P'?'passive':'ultimate',maxLevel=levels.length,reference=o.ref??'F';
 assert.ok([1,3,5].includes(maxLevel),name);
 const family=type==='passive'?['passive']:o.tags??(reference==='W'||reference==='WB'?['physical','weapon']:['M','MS'].includes(reference)?['magic']:['physical','support']);
 const tags=[type,...family].filter((value,index,array)=>array.indexOf(value)===index);
 const pre=(o.pre??[]).map(value=>{const [id,level='1']=value.split(':');return {id:job.id+'_'+id,level:Number(level)};});
 const mpBand=type==='passive'?'なし':type==='ultimate'?'奥義':o.mp??'中',apBand=type==='ultimate'?'奥義':o.ap??'標準';
 const selected=weapons[o.weapon??'none'];assert.ok(selected,name);
 const cost=type==='ultimate'?0:o.cost??2;
 job.skills.push({id:job.id+'_'+code,name,type,maxLevel,growthMode:maxLevel===1?'none':'lv'+maxLevel,cost,mpBand,
  baseMp:{なし:0,奥義:0,軽:rules.mp_bands.light,中:rules.mp_bands.medium,重:rules.mp_bands.heavy}[mpBand],
  apBand,learnAp:{導入:rules.ap_bands.intro,標準:rules.ap_bands.standard,発展:rules.ap_bands.advanced,奥義:rules.ap_bands.ultimate}[apBand],
  upgradeAp:rules.upgrade_ap.slice(0,maxLevel-1),prerequisites:pre,role:o.role??levels[0].short,target:o.target??(type==='passive'?'自分':'敵1体'),
  reference,weapons:selected,weaponCondition:selected.length?selected.map(id=>weaponNames[id]).join('・'):'武器条件なし',
  tags,growthAxis:o.axis??(maxLevel===1?'修得時に役割が完成':maxLevel===5?'主力威力・基礎能力を5段階で伸ばす':'対象・持続・条件付き効力を3段階で広げる'),
  inheritance:o.use??'現職を問わず継承可能。本文の装備・資源・対象条件を満たすこと。前提は修得時のみ。',
  effectDisplay:{icon:'job-special',sections:(o.display??[]).map(key=>section[key]),note:o.displayNote??'即時処理と常時パッシブだけでは新しい継続アイコンを作らない。'},
  effects:levels.map(l=>l.detail),simpleDescriptions:levels.map(l=>l.short),levelRules:levels.map(l=>l.parameters)});
}
function strike(code,name,powers,o={}){
 const ref=o.ref??'W',element=o.element??'slash';
 S(code,name,{ref,...o},tiers(powers,(power,index)=>{
  const extra=typeof o.extra==='function'?o.extra(power,index):o.extra??'専用の準備・資源がなくても基礎効果を使える。';
  const extraRules=typeof o.params==='function'?o.params(power,index):o.params??{};
  return L((o.attackTarget??(o.target?.startsWith('敵全体')?'敵全体':o.target)??'敵1体')+'へ'+ref+'基準、'+(element==='enchant'?'付与属性（なければ斬撃）':element==='chosen'?'選んだ属性':attribute[element]+'属性')+power.toFixed(2)+'倍の直接攻撃。'+extra,
   o.short,{kind:'attack',base:ref,power,element,hits:o.hits??[1],...extraRules});
 }));
}
function stat(code,name,key){
 S(code,name,{axis:key+'＋4／6／8／10／12%',role:'装備中の基礎能力強化'},tiers([.04,.06,.08,.10,.12],value=>
  L('装備中、'+key+'を'+pct(value)+'上げる。現職を問わず、共通の能力強化上限へ加算する。現在HP・MPの即時回復はない。',
   '自分の'+({STR:'物理攻撃力',MAG:'魔法攻撃力',SPD:'素早さ'}[key]??key)+'が上がる。',{kind:'passive',stat:key,value})));
}

J('assassin','暗殺者','仲間が作った状態異常・弱体の隙を短剣や弓で突く。','処刑人の低HP特効、盗賊の盗みと幅広い妨害、忍者の分身資源と分ける。即死を扱わない。','隙は攻撃計算直前の対象の状態で判定し、同じ打撃で新しく付けた異常を遡及しない。対象指定の準備は各技能IDで1つ、武器技1行動で使い切る。状態異常の種類数を無制限に倍率へ変えない。');
strike('A01','針貫き',[1.05,1.2,1.35,1.5,1.65],{weapon:'dagger',element:'pierce',mp:'軽',ap:'導入',short:'敵1体に刺突攻撃。'});
S('A02','忍毒の刃',{ref:'W',weapon:'dagger',pre:['A01:1'],mp:'軽',axis:'威力0.90倍・毒35%固定、持続2→3→4行動'},tiers([2,3,4],turns=>L('敵1体へW基準の斬撃0.90倍。実ダメージ後、基礎35%で毒を次の'+turns+'行動終了まで付与する。毒無効でも基礎攻撃は使え、今回の毒を同じ打撃の特効へ使わない。','敵1体に斬撃。さらに毒を狙う。',{kind:'attack',base:'W',power:.9,element:'slash',status:{id:'poison',rate:.35,turns}})));
S('A03','隙の照準',{target:'敵1体を指定／自分',pre:['A01:1'],mp:'軽',display:['special']},fixed('敵1体を指定する。次にその敵を含む通常アクティブ武器技を使うと準備を消費し、その対象が暗闇・恐怖・束縛のいずれかなら直接ダメージを20%強化する。未使用期限は自分の次の2行動終了まで。条件未達・空振りでも指定対象への使用で消費し、範囲技の別対象・奥義・反応には適用しない。','敵1体を見定め、次の通常の武器技に備える。暗闇・恐怖・束縛の敵に強い。',{kind:'prepare',target:'selected_enemy',nextWeaponDamage:{statuses:['blind','fear','bind'],rate:.2,turns:2}}));
S('A04','留め針',{ref:'W',weapon:'assassin',pre:['A01:1'],axis:'威力0.75倍・束縛30%・持続2固定、対象1→2→3体',target:'敵を選択'},tiers([1,2,3],targets=>L('異なる生存敵を最大'+targets+'体選び、各対象へW基準の刺突0.75倍。実ダメージ後、各対象へ基礎30%で束縛を2行動付与する。束縛は回避・逃走制限であり手番を飛ばさない。','敵を'+targets+'体まで選び、刺突攻撃。さらに束縛を狙う。',{kind:'attack',base:'W',power:.75,element:'pierce',targetLimit:targets,status:{id:'bind',rate:.3,turns:2}})));
strike('A05','宵針',[1,1.15,1.3,1.45,1.6],{weapon:'dagger',element:'dark',pre:['A01:1'],short:'敵1体に闇属性の短剣攻撃。'});
strike('A06','穿ち矢',[1.1,1.25,1.4,1.55,1.7],{weapon:'bow',element:'pierce',mp:'軽',ap:'導入',short:'敵1体に刺突の射撃。'});
S('A07','影潜み',{target:'自分',pre:['A03:1'],axis:'回避＋15ポイント固定、持続1→2→3行動',display:['ongoing']},tiers([1,2,3],turns=>L('自分の回避率を15ポイント上げ、次の'+turns+'行動終了まで持続する。回避上限60%、束縛・必中の制限を守る。対象から消える・完全無敵になる効果ではない。','しばらく、自分の回避率を上げる。',{kind:'buff',values:{eva:.15},turns})));
strike('A08','虚突き',[1.4,1.6,1.8,2,2.2],{weapon:'assassin',element:'pierce',pre:['A01:2','A03:1'],mp:'重',cost:3,ap:'発展',short:'敵1体に強力な刺突攻撃。能力が下がっている敵に強い。',extra:'計算直前に対象のSTR・MAG・DEF・RES・SPD・LUKのいずれかが一時低下中なら直接ダメージを25%強化する。低下数で増やさず、属性耐性の不利や呪印だけでは成立しない。',params:{conditionDamage:{when:'target_stat_down',rate:.25}}});
strike('A09','仕込み返し',[1.5,1.7,1.9,2.1,2.3],{weapon:'dagger',element:'slash',pre:['A01:2','A07:1'],mp:'重',cost:4,ap:'発展',short:'敵1体に強力な斬撃。直前の技能で攻撃に備えていると強くなる。',extra:'直前の自発行動が通常の非攻撃技能で、次回攻撃・会心・命中・MP軽減の新しい準備を自分へ有効に付けた場合、今回の直接ダメージを20%強化する。同値の期限更新だけ、道具、自動発動、単なる能力強化では成立しない。次の別行動・スキップで直前条件を失う。',params:{previousPreparationDamage:.2}});
S('P01','隙の読み',{cost:3,pre:['A03:1']},fixed('計算直前に対象が暗闇・恐怖・束縛のいずれかなら、自分の直接武器ダメージを15%強化する。複数該当でも1回分。別の敵の異常・自分の異常・低HPだけでは成立しない。','暗闇・恐怖・束縛の敵への武器攻撃が強くなる。',{kind:'passive',conditionDamage:{when:'target_status',statuses:['blind','fear','bind'],scope:'weapon',rate:.15}}));
stat('P02','影歩きの基礎','SPD');
S('P03','不意を突く',{pre:['A03:1'],axis:'能力低下中の敵への武器会心＋8→12→16ポイント'},tiers([.08,.12,.16],rate=>L('対象が一時的な能力低下中なら自分の直接武器攻撃の会心率を'+Math.round(rate*100)+'ポイント上げる。対象ごと・打撃ごとに判定し、会心共通上限85%を守る。','能力が下がっている敵への武器攻撃が会心になりやすい。',{kind:'passive',conditionCrit:{when:'target_stat_down',scope:'weapon',rate}})));
S('P04','傷痕の見識',{pre:['A02:1'],axis:'対象異常が毒→毒・出血→毒・出血・火傷'},tiers([['poison'],['poison','bleed'],['poison','bleed','burn']],(statuses,i)=>L('対象が'+['毒','毒・出血','毒・出血・火傷'][i]+'のいずれかなら、直接武器ダメージを10%強化する。複数該当でも1回分。継続被害自体を増やさない。',['毒の敵への武器攻撃が強くなる。','毒・出血の敵への武器攻撃が強くなる。','毒・出血・火傷の敵への武器攻撃が強くなる。'][i],{kind:'passive',conditionDamage:{when:'target_status',statuses,scope:'weapon',rate:.1}})));
S('P05','退路の読み',{pre:['A03:1'],axis:'異常中の敵への通常武器技が実ダメージを与えた後、回避＋10ポイント・持続1→2→3',display:['ongoing']},tiers([1,2,3],turns=>L('行動開始時に何らかの状態異常を受けていた敵へ通常武器技で実ダメージを与えた後、自分の回避率を10ポイント上げ、次の'+turns+'行動終了まで持続する。1自発行動1回で、反応・奥義・今回付けた異常では発動しない。','状態異常の敵を通常の武器技で攻めると、しばらく自分の回避率が上がる。',{kind:'passive',afterWeaponHit:{when:'target_status_at_action_start',values:{eva:.1},turns,perAction:1}})));
strike('U01','影穿つ終刃',[4.6],{weapon:'physical',element:'pierce',short:'敵1体に極大の刺突攻撃。状態異常や能力低下の隙が多いほど強い。',extra:'攻撃前の対象に状態異常があれば15%、一時能力低下があればさらに15%を同種強化枠へ加算する。各分類1回、追加は最大30%。即死・防御無視・HP割合切捨ては行わない。',params:{conditionDamage:[{when:'target_status',rate:.15},{when:'target_stat_down',rate:.15}],conditionBonusCap:.3}});

J('bounty_hunter','賞金稼ぎ','一体を指定して追跡を重ね、確実な射撃・拘束と味方の集中攻撃へつなぐ。','剣闘士の挑発・被弾後反撃とは違い、敵を引き受けず遠距離から追う。狩人の種族対策・調査・罠とも分ける。','追跡札は本人ごと1対象・4行動。追跡0〜3は追い手の勘の装備時だけ保持する。指定対象へ通常武器技で実ダメージを与えた行動終了に1増加し、現在の攻撃へ遡及しない。別の敵を自発攻撃すると攻撃前に0、再指定でも0。反応・通常攻撃・道具・奥義では増えない。標的撃破・期限・戦闘不能で解除する。');
S('A01','追跡札',{target:'敵1体',mp:'軽',ap:'導入',cost:1,display:['ongoing']},fixed('敵1体を自分の標的として4行動指定する。挑発・ダメージ・図鑑開示は行わない。再使用は同じ敵でも追跡を0へ戻し、指定期間を更新する。標的がない状態でも使える。','敵1体を追跡の標的に指定する。',{kind:'mark',turns:4,resetPursuit:true}));
strike('A02','追矢',[1.05,1.2,1.35,1.5,1.65],{weapon:'ranged',element:'pierce',mp:'軽',ap:'導入',short:'敵1体に刺突の射撃。自分の標的に強い。',extra:'自分の標的なら直接ダメージを10%強化する。追跡をためるパッシブがなくてもこの条件と基礎攻撃は使える。',params:{markedDamage:.1}});
S('A03','脚留め射ち',{ref:'W',weapon:'ranged',pre:['A02:1'],mp:'軽',axis:'威力0.90倍・束縛35%固定、持続2→3→4'},tiers([2,3,4],turns=>L('敵1体へW基準の刺突0.90倍。実ダメージ後、基礎35%で束縛を'+turns+'行動付与する。自分の標的でなくても使える。','敵1体に刺突の射撃。さらに束縛を狙う。',{kind:'attack',base:'W',power:.9,element:'pierce',status:{id:'bind',rate:.35,turns}})));
strike('A04','氷鋲射',[1,1.15,1.3,1.45,1.6],{weapon:'ranged',element:'ice',pre:['A02:1'],short:'敵1体に氷属性の射撃。'});
S('A05','射線固定',{target:'自分',pre:['A01:1','A02:1'],mp:'軽',display:['special']},fixed('次に自分の標的を含む通常武器技を使うとき、その標的へのDEF無視を20ポイント加算する。自分の次の2行動終了まで。条件外の別対象へは適用せず、該当行動は空振りでも消費する。防御無視共通上限70%。標的を持たなければ使用不可。','自分の標的への次の通常の武器技が、防御を貫きやすくなる。',{kind:'prepare',requiresMark:true,nextMarkedWeapon:{defIgnore:.2,turns:2}}));
S('A06','追跡の継ぎ直し',{target:'別の敵1体',pre:['A01:1'],mp:'軽',axis:'移動後に持ち越せる追跡の上限0→1→2',display:['ongoing']},tiers([0,1,2],carry=>L('現在の生存標的とは別の生存敵へ追跡札を移し、期間を4行動にする。移動後の追跡は現在値と'+carry+'の小さい方。新たな段階は生成せず、追い手の勘が未装備なら0。標的なし・同じ敵指定は使用不可。','標的を別の敵に替える。追跡を'+carry+'段階まで持ち越せる。',{kind:'move_mark',requiresMark:true,differentTarget:true,carry,turns:4})));
S('A07','捕縛網',{target:'敵を選択',pre:['A03:1'],axis:'束縛40%・2行動固定、対象1→2→3体',tags:['physical','status']},tiers([1,2,3],targets=>L('異なる敵を最大'+targets+'体選び、各対象へ基礎40%で束縛を2行動付与する。即時の物理妨害で、武器攻撃・罠・消耗品ではない。ダメージ・追跡増加はない。','敵を'+targets+'体まで選び、束縛を狙う。',{kind:'status',targetLimit:targets,status:{id:'bind',rate:.4,turns:2}})));
S('A08','包囲の合図',{target:'生存味方全員／自分の標的',pre:['A01:1'],cost:3,axis:'標的への直接ダメージ＋8%固定、持続1→2→3',display:['party']},tiers([1,2,3],turns=>L('自分の生存標的に対して味方が与える直接ダメージを8%強化する支援を、生存味方へ各'+turns+'行動付ける。対象の敵を付与時に保存し、その後の標的変更には追従しない。同名は重複せず、標的撃破で終了する。継続被害・反応・奥義は対象外。標的なしでは使えない。','しばらく、味方全員が自分の標的を攻めやすくなる。',{kind:'party_buff',requiresMark:true,targetSnapshot:true,normalDirectDamage:.08,turns})));
strike('A09','追跡終射',[1.6,1.8,2,2.2,2.4],{weapon:'ranged',element:'pierce',pre:['A02:2','A01:1'],cost:4,mp:'重',ap:'発展',short:'敵1体に強力な射撃。標的には追跡を使って威力を高め、追跡を終える。',extra:'対象が自分の標的なら攻撃前に追跡を全消費し、1段階につき8%、最大24%を強化する。追い手の勘の通常5%と二重に加算せず、この行動では追跡を得ない。標的の有無にかかわらず基礎攻撃は使え、行動終了で自分の指定を解除する。',params:{spendPursuit:{perStage:.08,all:true,replacesNormal:true},endMark:true,noPursuitGain:true}});
S('P01','追い手の勘',{cost:3,pre:['A01:1','A02:1'],display:['ongoing']},fixed('自分の標的へ通常アクティブ武器技で実ダメージを与えた行動終了に追跡を1得る（最大3、1行動1回）。指定対象への通常武器技は行動開始時の追跡1段階につき5%強化する。明示した全消費技能には通常の5%を重ねず、別対象を選ぶ自発攻撃は最初の打撃前に追跡を0へ戻す。','自分の標的を通常の武器技で攻め続けるほど、その敵への武器技が強くなる。',{kind:'passive',pursuit:{max:3,damage:.05,gain:1,normalWeaponOnly:true}}));
stat('P02','追跡者の鍛錬','STR');
S('P03','追跡の精度',{pre:['P01:1'],axis:'命中＋15ポイント固定、必要追跡3→2→1'},tiers([3,2,1],threshold=>L('行動開始時の追跡が'+threshold+'以上なら、自分の標的への通常武器技の最終命中率を15ポイント上げる。標的以外・反応・奥義は対象外。命中上限と束縛等の共通条件を守る。','追跡が'+threshold+'段階以上なら、標的への通常の武器技が当たりやすい。',{kind:'passive',markedAccuracy:{threshold,rate:.15}})));
S('P04','追う者の警戒',{pre:['A01:1'],axis:'自分の標的からの直接被害6→9→12%軽減'},tiers([.06,.09,.12],rate=>L('自分が指定している生存標的から受ける直接被害を'+pct(rate)+'軽減する。別の敵・継続被害・HP費用には作用しない。敵を挑発したり味方をかばったりしない。','自分の標的から受ける攻撃のダメージが減る。',{kind:'passive',markedSourceCut:rate})));
S('P05','捕縛の手並み',{pre:['P01:1','A03:1'],axis:'追跡1以上の自分の標的へ、束縛基礎率＋5→10→15ポイント'},tiers([.05,.1,.15],rate=>L('自分の追跡が1以上ある標的へ通常技能で束縛を付けるとき、基礎率へ'+Math.round(rate*100)+'ポイント加算する。その後に相性・免疫・ボス補正と95%上限を適用する。段階数で加算量を増やさず、今回獲得する追跡は参照しない。','追跡中の標的へ、束縛をかけやすくなる。',{kind:'passive',markedStatusRate:{status:'bind',minimumPursuit:1,add:rate}})));
strike('U01','千里の捕縛',[4.5],{weapon:'physical',element:'pierce',display:['ongoing'],short:'敵1体に極大の刺突攻撃と束縛を狙う。追跡中ならさらに強く、攻撃後に標的として捉える。',extra:'対象が自分の標的なら追跡を全消費し1段階につき10%、最大30%強化する。実ダメージ後、基礎70%で束縛を2行動狙う。行動終了時、対象が生存していれば自分の標的として4行動指定し、追跡を0にする。関連技能・追跡なしでも攻撃・束縛・指定は成立する。',params:{spendPursuit:{perStage:.1,all:true,replacesNormal:true},status:{id:'bind',rate:.7,turns:2},afterMark:{turns:4,resetPursuit:true},noPursuitGain:true}});

J('dragoon','竜騎士','跳躍の準備と着地を使い、竜への対策と槍の強襲を両立する。','忍者の分身による回避とは違い、跳躍は準備と着地の2行動を使う。無敵を維持して攻撃し続ける技能にはしない。','跳躍は通常2行動。準備と着地の両方で恐怖・封印などの攻撃技能制限を確認する。準備の回答とMP支払いで跳躍予約を作り、次の本人の行動開始で対空防御を終了し、槍技を使用可能なら着地攻撃をその1行動・1回答として行う。追加手番・追加問題は作らず、着地の効果倍率は準備時と着地時の正誤倍率の積。準備は武器攻撃として数えず、着地だけを通常武器技として扱う。単体の回避可能な敵攻撃は地上の味方へ対象を選び直し、全体の回避可能な直接攻撃は本人分だけ避ける。必中・状態異常だけの行動・継続被害は防がず、空中でかばう・反撃はできない。次の機会が行動不能・強制行動なら予約を失い、MPは返さない。恐怖・封印等で着地だけが使用不可なら予約を解除し、同じ行動機会の通常の行動選択へ戻る。標的撃破時の着地先は生存敵の表示順先頭、敵全滅時は取り消す。味方の回復・支援は受けられ、絵・HPバーを消さない。');
strike('A01','長槍突き',[1.1,1.25,1.4,1.55,1.7],{weapon:'spear',element:'pierce',mp:'軽',ap:'導入',short:'敵1体に槍の刺突攻撃。'});
S('A02','跳躍槍',{ref:'W',weapon:'spear',target:'敵1体を予約／自分',ap:'導入',display:['special'],tags:['physical','jump_prepare','attack_prepare'],use:'準備から着地まで槍を必要とする。着地では再度MPを払わない。'},tiers([2.1,2.3,2.5,2.7,2.9],power=>L('敵1体へ跳躍を準備する。準備と着地の両段階で恐怖・封印を確認する。次の自分の行動開始に跳躍防御を終え、槍技を使用可能ならその行動でW基準の刺突'+power.toFixed(2)+'倍の着地攻撃を行う。準備はダメージ・武器技の資源消費や獲得を起こさず、MPは準備時1回、武器技の準備・祈念等の消費は着地時1回だけ。中断・対象変更・正誤は職業の共通規則に従う。','跳躍し、次の自分の行動で敵1体に強力な槍撃。空中では回避可能な直接攻撃を避ける。',{kind:'jump',base:'W',landingPower:power,element:'pierce',opportunities:2,payMp:'launch',weaponTriggers:'landing',answerScale:'launch_times_landing',attackRestrictionAtBothPhases:true,landingUnavailable:'cancel_then_normal_choice'})));
strike('A03','雷槍穿ち',[1,1.15,1.3,1.45,1.6],{weapon:'spear',element:'thunder',pre:['A01:1'],short:'敵1体に雷属性の槍撃。'});
strike('A04','風槍旋',[1,1.15,1.3,1.45,1.6],{weapon:'spear',element:'wind',pre:['A01:1'],short:'敵1体に風属性の槍撃。'});
S('A05','竜鱗割り',{ref:'W',weapon:'spear',pre:['A01:1'],axis:'威力1.00倍固定、竜へのDEF無視＋15→25→35ポイント'},tiers([.15,.25,.35],defIgnore=>L('敵1体へW基準の刺突1.00倍。対象が竜ならDEF無視を'+Math.round(defIgnore*100)+'ポイント加算する。複数種族でも1回分、防御無視共通上限70%。竜以外にも基礎攻撃は使える。','敵1体に槍撃。竜の防御を貫きやすい。',{kind:'attack',base:'W',power:1,element:'pierce',conditionalDefIgnore:{type:'dragon',rate:defIgnore}})));
S('A06','踏み切りの呼吸',{target:'自分',pre:['A02:1'],mp:'軽',display:['special']},fixed('次の通常跳躍槍の着地ダメージを20%強化する準備を付ける。未使用期限は次の2行動終了まで。準備時に着地へ予約し、着地で1回消費する。奥義・即時槍技・反応は対象外。跳躍が中断しても返さない。','次の通常の跳躍攻撃に力をためる。',{kind:'prepare',nextJumpDamage:{rate:.2,turns:2,reserveAtLaunch:true,consumeAtLanding:true}}));
S('A07','槍の壁',{target:'自分',pre:['A01:1'],axis:'物理直接被害15%軽減固定、持続1→2→3',display:['ongoing']},tiers([1,2,3],turns=>L('自分が受ける直接物理被害を15%軽減し、次の'+turns+'行動終了まで持続する。魔法・継続被害・HP費用を軽減しない。反撃・味方護衛は付かない。','しばらく、自分が受ける物理攻撃のダメージを減らす。',{kind:'buff',values:{pcut:.15},turns})));
S('A08','竜封じの槍',{ref:'W',weapon:'spear',pre:['A05:1'],axis:'威力1.00倍・束縛35%固定、持続2→3→4。竜には封印35%も同期間'},tiers([2,3,4],turns=>L('敵1体へW基準の刺突1.00倍。実ダメージ後、基礎35%で束縛を'+turns+'行動付与する。対象が竜なら別に基礎35%で封印を同期間狙う。両判定とも共通の相性・免疫・ボス補正を受け、竜を無条件に行動不能にはしない。','敵1体に槍撃と束縛を狙う。竜には封印も狙う。',{kind:'attack',base:'W',power:1,element:'pierce',status:{id:'bind',rate:.35,turns},typeStatus:{type:'dragon',id:'seal',rate:.35,turns}})));
strike('A09','落雷突き',[1.5,1.7,1.9,2.1,2.3],{weapon:'spear',element:'thunder',pre:['A01:2','A03:1'],cost:4,mp:'重',ap:'発展',short:'敵1体に強力な雷の槍撃。直前に跳躍から着地していると強い。',extra:'直前の自分の自発行動が通常跳躍槍の着地だった場合、直接ダメージを25%強化する。即時奥義はこの直前条件を作らず、別の行動・スキップ・再度の跳躍準備で失う。跳躍なしでも基礎攻撃は使える。',params:{previousLandingDamage:.25}});
S('P01','着地の息',{pre:['A02:1'],display:['ongoing']},fixed('通常跳躍槍の着地で実ダメージを与えた後、自分のDEFを15%上げ、次の2行動終了まで持続する。準備・中断・空振り・奥義・反応では発動せず、同名を加算しない。','通常の跳躍攻撃が当たると、しばらく自分の物理防御力が上がる。',{kind:'passive',afterLandingHit:{values:{def:.15},turns:2}}));
stat('P02','竜槍の鍛錬','STR');
S('P03','竜への備え',{pre:['A05:1'],axis:'竜から受ける直接被害8→12→16%軽減'},tiers([.08,.12,.16],rate=>L('竜種族の敵から受ける直接被害を'+pct(rate)+'軽減する。複数種族でも1回分。継続被害・HP費用、竜以外には作用しない。','竜から受ける攻撃のダメージが減る。',{kind:'passive',typeSourceCut:{type:'dragon',rate}})));
S('P04','跳躍の節度',{pre:['A02:1'],axis:'通常跳躍準備MP20→35→50%軽減'},tiers([.2,.35,.5],rate=>L('通常の跳躍準備に払う基礎MPを'+pct(rate)+'軽減する。着地はもともと追加MP0で、奥義・即時槍技は対象外。MP軽減の共通上限50%を守る。','通常の跳躍攻撃の消費MPが減る。',{kind:'passive',mpSave:{tag:'jump_prepare',rate}})));
S('P05','追風の槍術',{pre:['A03:1'],axis:'雷・風の直接武器ダメージ＋5／7／9／11／13%'},tiers([.05,.07,.09,.11,.13],rate=>L('自分が与える雷・風属性の直接武器ダメージを'+pct(rate)+'強化する。両属性でも1回、MAG直接魔法・継続被害は対象外。','雷・風属性の武器攻撃が強くなる。',{kind:'passive',elementDamage:{elements:['thunder','wind'],scope:'weapon',rate}})));
strike('U01','天墜の竜槍',[4.8],{weapon:'physical',element:'pierce',display:['ongoing'],short:'敵1体に極大の落下槍撃。竜に強く、その後は自分を防護する。',extra:'その自発行動中に即時攻撃し、跳躍予約・追加の手番・直前着地条件は作らない。竜へ直接ダメージを30%強化する。その後、自分の最大HP15%の防護を次の2行動終了まで付与する。跳躍技能を装備していなくても攻撃と防護が成立する。',params:{conditionDamage:{when:'target_type',types:['dragon'],rate:.3},afterSelfShield:{base:'F',hpFraction:.15,turns:2},instantLanding:true,createsLandingHistory:false}});


J('gunner','銃士','装弾と射撃を組み立て、炎・雷の特殊弾や防御を貫く弾を選ぶ。','賞金稼ぎの追跡・拘束、海賊の開幕と撃破後の攻勢と分ける。消耗品の弾を買わせず、戦闘内の装填数を行動とMPで用意する。','装填数は本人0〜3、開始0。装弾で増え、特殊弾が指定した数を行動開始に払う。通常射撃は装填数を使わない。命中失敗でも弾は返さず、全体・連撃でも行動全体で1回の支払い。撃破・会心・回避・反応から補充せず、戦闘不能・終了で0。奥義後の補充だけは本文の例外。別の銃技へ弾消費を自動追加しない。');
strike('A01','定射',[1.1,1.25,1.4,1.55,1.7],{weapon:'gun',element:'pierce',mp:'軽',ap:'導入',tags:['physical','weapon','gunshot'],short:'敵1体に銃の刺突攻撃。装填した弾は使わない。',params:{ammoCost:0}});
S('A02','装弾',{target:'自分',ap:'導入',axis:'一度の補充数1→2→3、合計上限3',display:['ongoing'],tags:['physical','support','reload']},tiers([1,2,3],count=>L('自分の装填数を'+count+'増やす（最大3）。実際に増やせる場合だけ使え、上限分を越える補充は捨てる。装填数は消耗品・MPそのものではなく戦闘内の使用回数。武器攻撃として数えない。','特殊弾を'+count+'発装填する。最大3発。',{kind:'reload',count,capacity:3,requiresRoom:true})));
strike('A03','火薬弾',[1.15,1.3,1.45,1.6,1.75],{weapon:'gun',element:'fire',pre:['A02:1'],mp:'軽',tags:['physical','weapon','gunshot','special_bullet'],short:'装填1発を使い、敵1体に炎属性の射撃。',extra:'装填1発を必ず前払いする。残数不足ならMPも払わず使用不可。火傷や爆発追撃は付けない。',params:{ammoCost:1}});
strike('A04','雷芯弾',[1.05,1.2,1.35,1.5,1.65],{weapon:'gun',element:'thunder',pre:['A02:1'],mp:'軽',tags:['physical','weapon','gunshot','special_bullet'],short:'装填1発を使い、敵1体に雷属性の射撃。',extra:'装填1発を必ず前払いする。残数不足ならMPも払わず使用不可。麻痺・追加手番は付けない。',params:{ammoCost:1}});
S('A05','牽制弾',{ref:'W',weapon:'gun',pre:['A02:1'],mp:'軽',axis:'威力0.90倍・暗闇40%固定、持続2→3→4',tags:['physical','weapon','gunshot','special_bullet']},tiers([2,3,4],turns=>L('装填1発を前払いし、敵1体へW基準の刺突0.90倍。実ダメージ後、基礎40%で暗闇を'+turns+'行動付与する。残数不足では使えない。','装填1発を使い、敵1体に射撃と暗闇を狙う。',{kind:'attack',base:'W',power:.9,element:'pierce',ammoCost:1,status:{id:'blind',rate:.4,turns}})));
strike('A06','貫甲弾',[1.5,1.7,1.9,2.1,2.3],{weapon:'gun',element:'pierce',pre:['A02:2','A01:1'],cost:3,tags:['physical','weapon','gunshot','special_bullet'],short:'装填2発を使い、敵1体に防御を貫く強力な射撃。',extra:'装填2発を前払いし、今回のDEF無視を20ポイント加算する。防御無視70%の共通上限を守り、対象HPの割合切捨ては行わない。',params:{ammoCost:2,defIgnore:.2}});
S('A07','照準固定',{target:'自分',weapon:'gun',pre:['A01:1'],mp:'軽',display:['special'],tags:['physical','support']},fixed('次の通常アクティブ銃技1行動の会心率を20ポイント上げる。自分の次の2行動終了まで。全体・連撃もその1行動だけを補助し、奥義・反撃・追撃には使わない。空振りでも消費する。弾を補充しない。','次の通常の銃技が会心になりやすくなる。',{kind:'prepare',nextGunCrit:{rate:.2,turns:2}}));
S('A08','制圧射撃',{ref:'W',weapon:'gun',pre:['A05:1'],cost:3,target:'敵を選択',axis:'威力0.65倍・装填1・SPD低下10%固定、対象2→3→全体',tags:['physical','weapon','gunshot','special_bullet']},tiers([2,3,8],targets=>L('装填1発を行動全体で前払いする。異なる敵を最大'+targets+'体選び、各対象へW基準の刺突0.65倍。実ダメージ後、基礎80%でSPDを10%下げ、対象の次の2行動終了まで持続する。進行中の行動順を巻き戻さない。',targets===8?'装填1発を使い、敵全体に射撃。さらに素早さの低下を狙う。':'装填1発を使い、敵を'+targets+'体まで選んで射撃。さらに素早さの低下を狙う。',{kind:'attack',base:'W',power:.65,element:'pierce',ammoCost:1,targetLimit:targets,afterDamageDebuff:{stat:'spd',value:.1,rate:.8,turns:2}})));
strike('A09','連装射',[1.6,1.8,2,2.2,2.4],{weapon:'gun',element:'pierce',pre:['A01:2','A02:2'],mp:'重',cost:4,ap:'発展',hits:[.5,.5],tags:['physical','weapon','gunshot','special_bullet'],short:'装填2発を使い、敵1体に強力な2連射。',extra:'記した倍率は2打の合計。装填2発を行動全体で前払いする。主対象が途中で倒れたら残りを別の敵へ振り向けない。状態付与・資源獲得・撃破反応は共通の1行動上限を守る。',params:{ammoCost:2,statusAtMostOncePerTarget:true}});
S('P01','装弾の狙い',{pre:['A02:1'],display:['special']},fixed('通常の装弾で残数を実際に増やした後、次の通常アクティブ銃技の最終命中率を15ポイント上げる。未使用期限は次の2行動終了まで。空装弾・奥義補充・自動発動で準備を得ず、奥義・反応では消費しない。','装弾すると、次の通常の銃技が当たりやすくなる。',{kind:'passive',afterReload:{nextGunAccuracy:.15,turns:2}}));
stat('P02','射撃の鍛錬','STR');
S('P03','射撃の節度',{pre:['A01:1'],axis:'gunshotタグの通常銃技のMP20→35→50%軽減'},tiers([.2,.35,.5],rate=>L('通常のgunshotタグ銃技の基礎MPを'+pct(rate)+'軽減する。装弾・照準固定・弾の使用数・奥義は変えない。銃の武器特性と共通MP計算を適用し、合計軽減上限50%を守る。','通常の銃技の消費MPが減る。',{kind:'passive',mpSave:{tag:'gunshot',rate}})));
S('P04','弾道学',{weapon:'gun',pre:['A06:1'],axis:'銃の直接武器攻撃のDEF無視＋5→10→15ポイント'},tiers([.05,.1,.15],rate=>L('主武器が銃の間、自分の直接武器攻撃のDEF無視へ'+Math.round(rate*100)+'ポイント加算する。直接MAG魔法・気功には作用せず、武器特性や技能との合計上限70%を守る。','銃の武器攻撃が防御を貫きやすくなる。',{kind:'passive',weaponDefIgnore:{weapons:['gun'],rate}})));
S('P05','射線の心得',{weapon:'gun',pre:['A01:1'],axis:'束縛中の対象への銃の直接武器ダメージ＋10→15→20%'},tiers([.1,.15,.2],rate=>L('計算直前に束縛中の敵へ与える銃の直接武器ダメージを'+pct(rate)+'強化する。今回新しく付く束縛を同じ打撃へ使わず、継続被害・MAG魔法を強化しない。','束縛中の敵への銃の武器攻撃が強くなる。',{kind:'passive',conditionDamage:{when:'target_status',statuses:['bind'],scope:'gun_weapon',rate}})));
strike('U01','轟天連装',[2.5],{weapon:'physical',element:'pierce',target:'敵全体',display:['ongoing'],short:'敵全体に極大の刺突攻撃。その後、特殊弾を3発装填する。',extra:'装填数は要求も消費もしない。全体攻撃後、自分の装填数を3へ置き換える。通常の装弾後パッシブを発動させず、追加手番・追加射撃は作らない。銃以外の対応物理武器へ継承しても攻撃と補充は成立する。',params:{targetLimit:8,ammoCost:0,afterAmmoSet:3,countsAsReload:false}});

J('pirate','海賊','開幕に攻勢を作り、撃破後の余勢を自分の一撃か味方全体へ回す。','狂戦士の攻撃継続による怒気と危険増加、処刑人の低HP特効・撃破直後の追撃とは分ける。金品の報酬倍率は持たせない。','勝鬨の余勢は通常の自発武器技による主撃撃破後に、1巡1回だけ得る次回武器強化。複数撃破でも1つで、次の通常武器技1行動か分け前の鼓舞で消費する。追撃・反撃・継続被害・奥義の撃破では得ず、次の2行動まで。開幕の残り行動数は最初の本人の行動機会から減り、スキップでも減る。一戦の使用済み・開幕経過は戦闘不能や蘇生で戻さない。');
strike('A01','斬り込み',[1.15,1.3,1.45,1.6,1.75],{weapon:'pirate',element:'slash',mp:'軽',ap:'導入',short:'敵1体に斬撃。'});
S('A02','先陣の号令',{target:'生存味方全員',ap:'導入',cost:3,axis:'SPD＋10%固定、持続1→2→3',display:['party']},tiers([1,2,3],turns=>L('生存味方全員のSPDを10%上げ、各対象の次の'+turns+'行動終了まで持続する。現在進行中の行動順を巻き戻さず、追加手番も作らない。同名を重ねて加算しない。','しばらく、味方全員の素早さを上げる。',{kind:'party_buff',values:{spd:.1},turns})));
strike('A03','水際の刃',[1,1.15,1.3,1.45,1.6],{weapon:'pirate',element:'water',pre:['A01:1'],short:'敵1体に水属性の武器攻撃。'});
S('A04','威嚇の砲声',{ref:'W',weapon:'gun',pre:['A01:1'],target:'敵を選択',axis:'威力0.90倍・恐怖35%・2行動固定、対象1→2→3'},tiers([1,2,3],targets=>L('異なる敵を最大'+targets+'体選び、各対象へW基準の刺突0.90倍。実ダメージ後、基礎35%で恐怖を2行動狙う。銃を必要とするが、銃士の装填数・消耗品の弾は使わない。','敵を'+targets+'体まで選び、銃撃と恐怖を狙う。',{kind:'attack',base:'W',power:.9,element:'pierce',targetLimit:targets,status:{id:'fear',rate:.35,turns:2}})));
S('A05','押し込み',{ref:'W',weapon:'pirate',pre:['A01:1'],axis:'威力1.00倍固定、DEF無視＋10→20→30ポイント'},tiers([.1,.2,.3],rate=>L('敵1体へW基準の斬撃1.00倍。今回のDEF無視を'+Math.round(rate*100)+'ポイント加算し、共通上限70%を守る。強化解除・HP割合切捨ては行わない。','敵1体に防御を貫く斬撃。',{kind:'attack',base:'W',power:1,element:'slash',defIgnore:rate})));
S('A06','船上の足さばき',{target:'自分',pre:['A02:1'],axis:'SPD＋10%・回避＋10ポイント固定、持続1→2→3',display:['ongoing']},tiers([1,2,3],turns=>L('自分のSPDを10%、回避率を10ポイント上げ、次の'+turns+'行動終了まで持続する。進行中の行動順を変えず、回避上限と束縛・必中の制限を守る。','しばらく、自分の素早さと回避率を上げる。',{kind:'buff',values:{spd:.1,eva:.1},turns})));
S('A07','分け前の鼓舞',{target:'生存味方全員',pre:['P01:1','A02:1'],cost:3,display:['party'],use:'勝鬨の余勢を装備し、未消費の余勢を持つときだけ使える。'},fixed('自分の勝鬨の余勢を消費し、生存味方全員のSTRを10%上げ、各対象の次の2行動終了まで持続する。余勢がなければMPも払わず使用不可。余勢を新しく作らず、回復・追撃・金品報酬は発生しない。','撃破後の余勢を使い、しばらく味方全員の物理攻撃力を上げる。',{kind:'party_buff',requiresMomentum:true,consumeMomentum:true,values:{str:.1},turns:2}));
S('A08','旗砕き',{ref:'W',weapon:'pirate',pre:['A01:1'],axis:'威力1.10倍固定、攻撃系一時強化の解除1→2→3個'},tiers([1,2,3],count=>L('敵1体へW基準の斬撃1.10倍。命中後、解除可能な一時STR上昇・SPD上昇・会心率上昇を最大'+count+'個消す。残り期間が短いもの、同値は古い付与から。防御・属性耐性・恒久特性・ボスの段階変化は消さず、今回の被害を解除後へ計算し直さない。','敵1体に斬撃。さらに攻撃系の強化を'+count+'個まで消す。',{kind:'attack',base:'W',power:1.1,element:'slash',cleanseOffense:{keys:['str','spd','crt'],count,afterHit:true}})));
strike('A09','怒濤斬',[.8,.95,1.1,1.25,1.4],{weapon:'pirate',element:'slash',target:'敵全体',pre:['A01:2','A03:1'],cost:4,mp:'重',ap:'発展',short:'敵全体に強力な斬撃。',extra:'撃破数に応じた新たな打撃は行わない。複数撃破の余勢獲得は行動終了時に共通上限の1回だけ判定する。',params:{targetLimit:8}});
S('P01','勝鬨の余勢',{pre:['A01:1'],cost:3,display:['special']},fixed('通常の自発武器技の主撃で敵を倒した後、次の通常武器技1行動の直接ダメージを15%強化する余勢を得る。1巡1回、未使用期限は次の2行動終了まで。複数を蓄積せず、同じ行動の残り対象・追撃を遡及強化しない。奥義・反応・継続被害・通常攻撃の撃破は対象外。','通常の武器技でとどめを刺すと、次の通常の武器技が強くなる。1巡に1回。',{kind:'passive',momentum:{rate:.15,turns:2,perRound:1,source:'normal_weapon_primary_kill'}}));
stat('P02','海賊の腕力','STR');
S('P03','先駆けの心得',{pre:['A01:1'],axis:'通常武器技＋15%固定、開幕の有効行動機会1→2→3',display:['ongoing']},tiers([1,2,3],opportunities=>L('一戦の最初の自分の'+opportunities+'行動機会に使う通常武器技の直接ダメージを15%強化する。非攻撃・スキップも機会を消費する。反応・奥義・通常攻撃には乗らず、戦闘不能・蘇生で開幕へ戻さない。','戦闘開始から'+opportunities+'行動の間、通常の武器技が強くなる。',{kind:'passive',opening:{opportunities,rate:.15,scope:'normal_weapon',skipConsumes:true,reviveResets:false}})));
S('P04','海風の備え',{pre:['A03:1'],axis:'水属性の直接被害6→9→12%軽減'},tiers([.06,.09,.12],rate=>L('水属性を含む敵の直接攻撃から受ける被害を'+pct(rate)+'軽減する。物理・魔法とも対象、複合でも1回分。直接被害軽減の共通70%上限を守り、継続被害・HP費用は軽減しない。','水属性の攻撃から受けるダメージが減る。',{kind:'passive',elementSourceCut:{elements:['water'],rate}})));
S('P05','押せ押せの心得',{pre:['P01:1'],axis:'余勢を持つ間の通常武器技MP20→35→50%軽減'},tiers([.2,.35,.5],rate=>L('未消費の勝鬨の余勢を持つとき、次の通常武器技の基礎MPを'+pct(rate)+'軽減する。MP計算後にその武器技で余勢を消費する。支援への転用・奥義・反応は対象外。余勢やMPを新しく作らない。','撃破後の余勢があると、次の通常の武器技の消費MPが減る。',{kind:'passive',momentumMpSave:rate})));
strike('U01','総員斬り込み',[2.7],{weapon:'physical',element:'slash',target:'敵全体',display:['party'],short:'敵全体に極大の斬撃。さらに、しばらく味方全員の物理攻撃力を上げる。',extra:'攻撃後、生存味方全員のSTRを20%上げ、各対象の次の2行動終了まで持続する。奥義の撃破から勝鬨の余勢・撃破追撃を新たに発動しない。関連技能なしでも攻撃と全体強化は成立する。',params:{targetLimit:8,afterPartyBuff:{values:{str:.2},turns:2},noMomentumGain:true}});

J('spellblade','魔法剣士','武器へ炎・氷・雷を付与し、STRとMAGを使う剣技を相性に合わせて選ぶ。','黒魔道士の即時全体魔法、侍の攻め受け姿勢と分ける。属性付与は武器攻撃の属性を選ぶ仕組みであり、物理武器威力を普通の魔法へ移す効果ではない。','武器属性付与は本人の共通1枠。炎・氷・雷を上書きし、装備したSTR物理武器12種の通常攻撃と「付与属性を使う」と記した武器技だけへ適用する。通常の付与技能も対応物理武器を必要とする。既存の固定属性技能は変更せず、複合属性を無制限に増やさない。複合武器式WBはSTR＋物理武器威力＋MAGの35%、対象DEFで軽減。MAGを参照しても攻撃自体は物理技能として封印を受け、属性付与などの魔法支援は沈黙を受ける。付与は戦闘不能・終了・期限で消え、通常攻撃や技能のたびにMPを自動消費しない。');
for(const [code,name,element,pre] of [['A01','火紋付与','fire',[]],['A02','氷紋付与','ice',['A01:1']],['A03','雷紋付与','thunder',['A01:1']]]){
 S(code,name,{target:'自分',weapon:'physical',pre,ap:code==='A01'?'導入':'標準',axis:attribute[element]+'付与固定、持続2→3→4',display:['special'],tags:['magic','support','enchant']},tiers([2,3,4],turns=>L('自分の武器属性付与を'+attribute[element]+'へ替え、次の'+turns+'行動終了まで持続する。通常攻撃と付与対応武器技の攻撃属性を'+attribute[element]+'1属性へ置き換える。固定属性の技・直接魔法を変えず、同じ付与を重ねて威力を増やさない。','しばらく、自分の武器に'+attribute[element]+'を付与する。',{kind:'enchant',element,turns,slot:'shared_imbue',policy:'normal_and_explicitly_enchantable_only'})));
}
strike('A04','紋刃',[1,1.15,1.3,1.45,1.6],{ref:'WB',weapon:'blades',element:'enchant',mp:'軽',ap:'導入',short:'敵1体に魔力を込めた斬撃。武器に付与した属性で攻撃する。',params:{enchantable:true}});
S('A05','破紋斬',{ref:'WB',weapon:'blades',pre:['A04:1'],axis:'威力1.00倍・RES低下10%・基礎80%固定、持続2→3→4'},tiers([2,3,4],turns=>L('敵1体へWB基準の固定斬撃1.00倍。実ダメージ後、基礎80%でRESを10%下げ、次の'+turns+'行動終了まで持続する。この攻撃はDEFで軽減し、今回の被害を低下後へ計算し直さない。付与属性に替えない。','敵1体に斬撃。さらに魔法防御力の低下を狙う。',{kind:'attack',base:'WB',power:1,element:'slash',enchantable:false,afterDamageDebuff:{stat:'res',value:.1,rate:.8,turns}})));
S('A06','術紋の守り',{target:'自分',pre:['A01:1'],axis:'現在の付与属性への直接被害10→15→20%軽減・3行動固定',display:['ongoing'],tags:['magic','support']},tiers([.1,.15,.2],rate=>L('現在の武器付与があるときだけ使用できる。その属性を保存し、同属性を含む敵の直接攻撃を'+pct(rate)+'軽減する効果を自分へ3行動付ける。付与属性を変えても防御属性は自動追従せず、同名の複数属性防御を保持しない。共通の直接軽減70%上限を守る。','しばらく、武器に付与中の属性から受けるダメージを減らす。',{kind:'buff',requiresEnchant:true,snapshotEnchantSourceCut:rate,turns:3})));
S('A07','紋の解放',{target:'自分',pre:['A01:1','A04:1'],mp:'軽',display:['special'],tags:['magic','support']},fixed('現在の武器属性付与を消費し、次の通常アクティブ武器技1行動の直接ダメージを25%強化する準備を付ける。未使用期限は次の2行動終了まで。付与なしでは使えず、消費した属性は次の攻撃へ自動保持しない。MPや新しい付与を得ない。','武器の属性付与を使い切り、次の通常の武器技を強くする。',{kind:'prepare',requiresEnchant:true,consumeEnchant:true,nextWeaponDamage:{rate:.25,turns:2}}));
strike('A08','紋連斬',[1.3,1.5,1.7,1.9,2.1],{ref:'WB',weapon:'blades',element:'enchant',pre:['A04:1'],cost:3,hits:[.5,.5],short:'敵1体に魔力を込めた2連斬。武器に付与した属性で攻撃する。',extra:'倍率は2打の合計。付与なしでは斬撃。同じ対象へ2打を行い、途中の撃破で別対象へ移らない。武器技の資源・準備の消費は1行動で1回。',params:{enchantable:true,statusAtMostOncePerTarget:true}});
strike('A09','三彩の刃',[1.6,1.8,2,2.2,2.4],{ref:'WB',weapon:'blades',element:'enchant',pre:['A04:2','A01:1'],mp:'重',cost:4,ap:'発展',short:'敵1体に強力な魔法剣。武器に属性を付与していると強い。',extra:'行動開始時に武器属性付与が有効なら直接ダメージを20%強化する。付与は消費しない。付与なしでは固定斬撃の基礎攻撃を使える。',params:{enchantable:true,enchantedDamage:.2}});
S('P01','紋の共鳴',{pre:['A01:1','A04:1'],display:['special']},fixed('通常の属性付与技能で、すでに有効な付与を別属性へ替えた後、次の付与対応通常武器技1行動のMPを20%軽減する。未使用期限は次の2行動終了まで。初回付与・同じ属性の更新・奥義付与では発動せず、回数を蓄積しない。','武器の付与属性を別の属性に替えると、次の付与対応の武器技の消費MPが減る。',{kind:'passive',afterEnchantChange:{nextEnchantableMpSave:.2,turns:2,requiresExistingDifferent:true}}));
stat('P02','術剣の学理','MAG');
S('P03','剣と術の鍛錬',{weapon:'blades',pre:['A04:1'],axis:'WB式の直接武器ダメージ＋5／7／9／11／13%'},tiers([.05,.07,.09,.11,.13],rate=>L('主武器が剣・刀の間、WB式を使う直接武器ダメージを'+pct(rate)+'強化する。通常のSTR武器技・MAG直接魔法・継続被害は対象外。','剣・刀による魔法剣が強くなる。',{kind:'passive',baseDamage:{base:'WB',weapons:['sword','katana'],rate}})));
S('P04','付与の節度',{pre:['A01:1'],axis:'通常属性付与のMP20→35→50%軽減。基礎6なら5→4→3'},tiers([.2,.35,.5],rate=>L('通常のenchantタグの非攻撃属性付与技能の基礎MPを'+pct(rate)+'軽減する。攻撃・防御・付与消費・奥義・MP譲渡は対象外。通常技の最低MP1と合計軽減50%を守る。','武器への属性付与の消費MPが減る。',{kind:'passive',mpSave:{tag:'enchant',rate}})));
S('P05','紋の余韻',{pre:['A01:1'],axis:'武器付与が有効な間の直接魔法被害6→9→12%軽減'},tiers([.06,.09,.12],rate=>L('自分の武器属性付与が有効な間、受ける直接魔法被害を'+pct(rate)+'軽減する。付与の属性数・更新回数では増えず、付与消費・期限・戦闘不能で条件を失う。継続被害は対象外。','武器に属性を付与している間、受ける魔法攻撃のダメージが減る。',{kind:'passive',whileEnchantMagicCut:rate})));
strike('U01','三光紋斬',[4.6],{ref:'WB',weapon:'physical',element:'chosen',display:['special','ongoing'],short:'炎・氷・雷から選び、敵1体に極大の魔法剣。しばらく属性付与と対応する武器技を強める。',extra:'使用時に炎・氷・雷を1つ選び、その属性で即時攻撃する。攻撃後に同属性を自分へ3行動付与し、付与対応の通常アクティブ武器技の直接ダメージを25%強化する効果も3行動付ける。新しい25%はこの奥義へ遡及しない。通常の付与技能なしでも攻撃・付与・強化は成立する。',params:{chooseElement:['fire','ice','thunder'],elementPolicy:'chosen',afterEnchant:{turns:3},afterEnchantableDamage:{rate:.25,turns:3,normalOnly:true}}});


J('elementalist','精霊術士','風・土・水の場を切り替え、敵味方の属性構成から継続的な優位を作る。','黒魔道士の瞬間火力、吟遊詩人の味方だけの支援と違い、場は同属性の敵も強くする。属性相性や完全無効そのものは書き換えない。','属性の場は戦闘全体で1つ。通常の場は選んだ属性の全員の直接ダメージを15%強化し、敵味方双方へ同じ加算を行う。複合攻撃も1回、継続被害・状態付与率・回復・防護は増やさない。期間は付与者の次の行動機会で減り、戦闘不能・終了で消える。別属性の場は所有者ごと置き換える。同属性の弱い場では強い場を更新せず、同値の他者の場を再使用で奪わない。同値の自分の場は期間の強い方で更新する。値・期間を何も改善しない使用は事前に不可とする。場の影響と所有者はキャラ詳細の全体効果で表示する。');
for(const [code,name,element] of [['A01','風の場','wind'],['A02','土の場','earth'],['A03','水の場','water']]){
 S(code,name,{target:'戦場全体',pre:code==='A01'?[]:['A01:1'],ap:code==='A01'?'導入':'標準',axis:'同属性の直接ダメージ＋15%固定、持続2→3→4',display:['party'],tags:['magic','support','field']},tiers([2,3,4],turns=>L('戦場へ'+attribute[element]+'の場を1つ展開し、付与者の次の'+turns+'行動終了まで持続する。敵味方双方の'+attribute[element]+'属性を含む直接ダメージを15%強化する。無効・耐性を無視せず、別属性の場を置き換える。同属性の強い場を弱い値で延長しない。','しばらく、敵味方の'+attribute[element]+'属性の攻撃を強める場を展開する。',{kind:'field',element,rate:.15,turns,slot:'battle_global',bothSides:true,durationBasis:'source_opportunities'})));
}
strike('A04','風紋弾',[.95,1.05,1.15,1.25,1.35],{ref:'M',element:'wind',mp:'軽',ap:'導入',short:'敵1体に風魔法。'});
strike('A05','地脈弾',[.95,1.05,1.15,1.25,1.35],{ref:'M',element:'earth',mp:'軽',pre:['A04:1'],short:'敵1体に土魔法。'});
strike('A06','水脈弾',[.95,1.05,1.15,1.25,1.35],{ref:'M',element:'water',mp:'軽',pre:['A04:1'],short:'敵1体に水魔法。'});
S('A07','場の庇護',{target:'生存味方全員',pre:['A01:1'],cost:3,axis:'現在の場と同属性の直接被害12%軽減固定、持続1→2→3',display:['party'],tags:['magic','support']},tiers([1,2,3],turns=>L('属性の場がある場合、その属性を保存し、生存味方全員が同属性から受ける直接被害を12%軽減する。各対象の次の'+turns+'行動終了まで。場が変わっても自動追従せず、同名を別属性で重複保持しない。直接軽減70%の共通上限を守る。場がなければ使えない。','しばらく、味方全員を現在の場と同じ属性の攻撃から守る。',{kind:'party_buff',requiresField:true,snapshotFieldSourceCut:.12,turns})));
S('A08','場の解き放ち',{target:'自分の場／自分',pre:['A01:1','A04:1'],mp:'軽',display:['special'],tags:['magic','support']},fixed('自分が展開した場を消費し、次の通常MAG直接攻撃魔法1行動に備える。消費した場と同じ属性を含む攻撃なら直接ダメージを25%強化する。次の2行動終了まで。条件の違う属性の攻撃では準備を使わず、奥義・回復・遅延・反応は対象外。他者の場は消費できず、場を作り直したりMPを回復したりしない。','自分の場を解き、同じ属性の次の通常の攻撃魔法を強くする。',{kind:'prepare',requiresOwnField:true,consumeOwnField:true,nextMagicDamage:{snapshotFieldElement:true,rate:.25,turns:2}}));
strike('A09','環流嵐',[.8,.9,1,1.1,1.2],{ref:'M',element:'chosen',target:'敵全体',pre:['A04:2','A01:1'],mp:'重',cost:4,ap:'発展',short:'風・土・水から選び、敵全体に強魔法。自分の場と同じ属性なら強い。',extra:'使用時に風・土・水から1属性を選ぶ。行動開始時に自分の場が同属性なら直接ダメージを15%追加強化する。場の共通15%は別の同種加算として併用し、場を延長・消費しない。場がなくても基礎攻撃は使える。',params:{chooseElement:['wind','earth','water'],targetLimit:8,ownMatchingFieldDamage:.15}});
S('P01','場の呼応',{pre:['A01:1','A04:1']},fixed('有効な場と同じ属性を含む自分の通常MAG直接攻撃魔法を10%強化する。場の所有者は問わない。複合属性でも1回分で、奥義・遅延・反応・継続被害・回復は対象外。','現在の場と同じ属性の通常の攻撃魔法が強くなる。',{kind:'passive',matchingFieldMagicDamage:.1,normalOnly:true}));
stat('P02','精霊の学理','MAG');
S('P03','場の保ち方',{pre:['A01:1'],axis:'自分の場が有効な間、直接魔法被害6→9→12%軽減'},tiers([.06,.09,.12],rate=>L('自分が展開した場が有効な間、自分が受ける直接魔法被害を'+pct(rate)+'軽減する。他者の場への上書き・自発消費・期限で失い、場の影響を受ける敵の被害は軽減しない。','自分の場がある間、受ける魔法攻撃のダメージが減る。',{kind:'passive',whileOwnFieldMagicCut:rate})));
S('P04','精霊の節度',{pre:['A01:1'],axis:'通常の場の展開MP20→35→50%軽減'},tiers([.2,.35,.5],rate=>L('通常のfieldタグの非攻撃展開技能の基礎MPを'+pct(rate)+'軽減する。場の消費・攻撃・防護・奥義は対象外。合計MP軽減上限50%と最低MP1を守る。','属性の場を展開する消費MPが減る。',{kind:'passive',mpSave:{tag:'field',rate}})));
S('P05','自然の深読み',{pre:['A04:1'],axis:'風土水の弱点を突く通常MAG魔法＋8→12→16%'},tiers([.08,.12,.16],rate=>L('自分の通常MAG直接攻撃で、風・土・水のいずれかが実際に弱点倍率1超となる場合、その直接ダメージを'+pct(rate)+'強化する。複合でも1回、場の存在だけでは弱点と数えず、耐性・無効を上書きしない。','風・土・水の通常魔法で弱点を突くと、さらに強くなる。',{kind:'passive',weakElementDamage:{elements:['wind','earth','water'],rate,normalMagicOnly:true}})));
strike('U01','三界の奔流',[2.6],{ref:'M',element:'chosen',target:'敵全体／戦場／生存味方全員',display:['party','ongoing'],short:'風・土・水から選び、敵全体に極大魔法。強い属性の場を展開し、味方全員を防護する。',extra:'風・土・水から1属性を選ぶ。攻撃後、その属性の場を敵味方双方の直接ダメージ25%強化・付与者3行動として展開する。新しい場はこの奥義へ遡及しない。生存味方全員へB_RESの0.60倍の防護を各2行動付ける。通常の場・支援技能がなくても成立する。',params:{chooseElement:['wind','earth','water'],targetLimit:8,afterField:{rate:.25,turns:3,bothSides:true},afterPartyShield:{base:'R',power:.6,turns:2}}});

J('witch','魔女','氷・闇の術と有限回数の使い魔連携を選び、鎌術の単体攻撃と妨害を組み立てる。','忍者の分身は防御と単発準備、魔女の使い魔は攻撃魔法に続く連携役。使い魔は攻撃を引き受けず、HP・独立手番・自動MP消費を持たない。死霊術師の魂・亡霊蓄積も扱わない。','使い魔は本人1体・反応3回・本人の次の3行動まで。通常MAG直接攻撃を選んだとき1回を前払いし、主対象に実ダメージが通り生存していれば追撃か妨害を1回行う。不命中・無効・撃破では反応せず利用回は返さない。全体魔法でも主対象1体。影写しが有効な通常魔法では影写しが優先枠を取り、使い魔は利用回を払わず不発（期限は減る）。通常の使い魔は追撃MS0.20倍・無属性、悪戯へ替えるとダメージの代わりに基礎70%のRES10%低下・2行動。指図は回数・期間を回復せず、再契約はMPと1行動で置換する。鎌術MSだけは鎌のLv・品質・強化・武器適性を通常術装備と同じ係数で参照し、物理武器威力を使わない。反応用の能力・装備補助は契約時に保存し、主撃の正誤倍率と契約時の正誤倍率の積を使う。戦闘不能・期限・残回数0・戦闘終了で消える。');
strike('A01','霜の鎌',[.95,1.05,1.15,1.25,1.35],{ref:'MS',weapon:'scythe',element:'ice',mp:'軽',ap:'導入',short:'敵1体に、魔力を使う氷の鎌術。',extra:'MAGと鎌術の装備補助を使い、物理武器威力・通常鎌攻撃の出血は使わない。沈黙の制限を受ける直接魔法で、STR武器技には分類しない。'});
S('A02','使い魔契約',{target:'自分',ap:'導入',display:['ongoing'],tags:['magic','support','familiar']},fixed('追撃型か悪戯型を選び、使い魔を1体契約する。反応3回・自分の次の3行動まで。追撃型はMS基準の無属性0.20倍、悪戯型はダメージなしで基礎70%のRES10%低下・2行動を狙う。契約時の能力・装備・関連パッシブを記録する。既存の使い魔は回数を加算せず置き換える。影写しとの優先、利用回・期限は職業の共通規則に従う。','追撃か妨害を行う使い魔を呼ぶ。',{kind:'familiar',base:'MS',power:.2,element:'none',charges:3,turns:3,mode:'chosen',chooseMode:['pursuit','mischief'],mischief:{stat:'res',value:.1,rate:.7,turns:2},replace:true}));
strike('A03','宵闇の術',[.95,1.05,1.15,1.25,1.35],{ref:'M',element:'dark',mp:'軽',ap:'導入',short:'敵1体に闇魔法。'});
S('A04','霜縛の術',{ref:'M',pre:['A03:1'],axis:'威力0.70倍・束縛40%固定、持続2→3→4'},tiers([2,3,4],turns=>L('敵1体へM基準の氷0.70倍。実ダメージ後、基礎40%で束縛を'+turns+'行動付与する。凍結・手番スキップを与える効果ではない。','敵1体に氷魔法。さらに束縛を狙う。',{kind:'attack',base:'M',power:.7,element:'ice',status:{id:'bind',rate:.4,turns}})));
S('A05','使い魔の指図',{target:'自分の使い魔',pre:['A02:1'],mp:'軽',display:['ongoing'],tags:['magic','support']},fixed('自分の生存使い魔を追撃型か悪戯型へ切り替える。追撃型は契約時の基礎倍率（通常MS0.20倍／奥義MS0.45倍）の無属性追撃、悪戯型はダメージなしで基礎70%のRES10%低下・2行動を狙う。型を変えても契約時の基礎・能力・装備・強化を保持する。残回数・期限は回復しない。使い魔なし・同じ型指定は使用不可。','使い魔を、追撃役か魔法防御を下げる妨害役に替える。',{kind:'familiar_mode',requiresFamiliar:true,differentMode:true,modes:['pursuit','mischief'],mischief:{stat:'res',value:.1,rate:.7,turns:2}}));
strike('A06','黒鎌の刻み',[1.1,1.2,1.3,1.4,1.5],{ref:'MS',weapon:'scythe',element:'dark',pre:['A01:1','A02:1'],short:'敵1体に強力な闇の鎌術。使い魔がいると強い。',extra:'自分の行動開始時に使い魔が有効なら、今回の直接ダメージを15%強化する。最後の利用回を同じ行動で支払っても主撃の条件は保つ。STR・物理武器威力・通常鎌の出血を使わない。',params:{familiarAtActionStartDamage:.15}});
S('A07','契約の守り',{ref:'R',target:'自分',pre:['A02:1'],axis:'使い魔1回消費・防護B_RES0.70倍固定、持続1→2→3',display:['ongoing'],tags:['magic','support']},tiers([1,2,3],turns=>L('自分の使い魔の残回数を1消費し、自分へB_RESの0.70倍の防護を'+turns+'行動付ける。使い魔や残回数がなければ使用不可。直接被害だけを肩代わりし、回復・破壊反撃・新しい使い魔・分身は発生しない。','使い魔の残り1回を使い、自分を防護する。',{kind:'shield',base:'R',power:.7,turns,familiarChargeCost:1})));
strike('A08','宵霜の波',[.7,.8,.9,1,1.1],{ref:'M',element:'chosen',target:'敵全体',pre:['A01:1','A03:1'],cost:3,mp:'重',ap:'発展',short:'氷・闇から選び、敵全体に強魔法。',extra:'氷・闇から1属性を選ぶ。使い魔が反応する場合も選んだ主対象1体だけで、全体へ追撃を複製しない。',params:{chooseElement:['ice','dark'],targetLimit:8}});
S('A09','契約の解放',{target:'自分の使い魔／自分',pre:['A02:1','A03:1'],cost:3,mp:'軽',display:['special'],tags:['magic','support']},fixed('使い魔の残回数をすべて消費して契約を終え、残り1回につき10%、最大30%で次の通常MAG直接攻撃魔法1行動を強化する。未使用期限は次の2行動終了まで。使い魔・残回数なしでは使えず、奥義・回復・遅延・反応には乗らない。MP・分身・新契約は得ない。','使い魔との契約を解き、残り回数に応じて次の通常の攻撃魔法を強くする。',{kind:'prepare',requiresFamiliar:true,consumeAllFamiliar:true,nextMagicDamage:{perCharge:.1,cap:.3,turns:2}}));
S('P01','契約の絆',{cost:3,pre:['A02:1']},fixed('使い魔を契約した時点でこの技能を装備していれば、その使い魔の追撃倍率へMS0.10倍を加算し、悪戯の基礎成功率へ10ポイントを加算して記録する。通常追撃は0.20から0.30倍、悪戯は70%から80%。残回数・期間・発動数は増やさず、後付けで反応を追加しない。','契約する使い魔の追撃と妨害が強くなる。',{kind:'passive',familiarOnSummon:{powerAdd:.1,statusRateAdd:.1}}));
stat('P02','夜学の魔力','MAG');
S('P03','氷闇の心得',{pre:['A01:1','A03:1'],axis:'氷・闇のMAG直接魔法＋5／7／9／11／13%'},tiers([.05,.07,.09,.11,.13],rate=>L('自分の氷・闇属性のMAG基準直接魔法ダメージを'+pct(rate)+'強化する。MS鎌術も含み、両属性でも1回分。無属性の使い魔追撃、STR武器技、継続被害を増やさない。','氷・闇の攻撃魔法と鎌術が強くなる。',{kind:'passive',elementDamage:{elements:['ice','dark'],scope:'magic',rate}})));
S('P04','契約の幕',{pre:['A02:1'],axis:'使い魔が有効な間の直接魔法被害6→9→12%軽減'},tiers([.06,.09,.12],rate=>L('自分の使い魔が残回数と期間を持つ間、受ける直接魔法被害を'+pct(rate)+'軽減する。最後の回数を支払った後・契約終了後は失い、継続被害・HP費用は軽減しない。','使い魔がいる間、受ける魔法攻撃のダメージが減る。',{kind:'passive',whileFamiliarMagicCut:rate})));
S('P05','使い魔の先読み',{pre:['A02:1'],axis:'追撃＋20%固定、対象異常が恐怖→恐怖・沈黙→恐怖・沈黙・封印'},tiers([['fear'],['fear','silence'],['fear','silence','seal']],(statuses,i)=>L('主撃の行動開始時に対象が'+['恐怖','恐怖・沈黙','恐怖・沈黙・封印'][i]+'のいずれかなら、その行動の追撃型使い魔の直接ダメージを20%強化する。主撃で新しく付けた異常を遡及せず、悪戯の率・回数・主撃自体は増やさない。',['恐怖の敵へ、使い魔の追撃が強くなる。','恐怖・沈黙の敵へ、使い魔の追撃が強くなる。','恐怖・沈黙・封印の敵へ、使い魔の追撃が強くなる。'][i],{kind:'passive',familiarConditionDamage:{when:'target_status_at_action_start',statuses,rate:.2}})));
strike('U01','宵霜の大契約',[2.7],{ref:'MS',element:'chosen',target:'敵全体／自分',display:['ongoing'],short:'氷・闇から選び、敵全体に極大魔法。さらに強い使い魔を呼ぶ。',extra:'氷・闇を1つ選ぶ。攻撃後、反応3回・3行動の追撃型使い魔を契約し、追撃の基礎をMS無属性0.45倍とする。悪戯へ替える場合の基礎は通常と同じRES10%低下・70%・2行動。契約の絆は契約時に記録する。奥義自身では旧使い魔の反応・回数消費を起こさず、新しい使い魔も遡及反応しない。関連技能がなくても攻撃と契約は成立する。',params:{chooseElement:['ice','dark'],targetLimit:8,afterFamiliar:{base:'MS',power:.45,element:'none',charges:3,turns:3,mode:'pursuit'},familiarTriggersSelf:false}});

J('hexer','呪術師','敵が行動した後に有限回数の呪印を反応させ、闇・土の術と弱体で戦況を作る。','魔女の自分の魔法に続く使い魔、死霊術師の魂、従来の毒などの継続被害と区別する。呪印は独自の有限反応であり、既存の呪いによる回復阻害ではない。','各敵の呪印は全使用者を通じ1つ。本人は敵の最大出現数8体まで保持でき、通常技の一度の対象数は技能ごとに限る。同名の弱い上書きで強い印を延長せず、別種の印へは旧印を反応させずに置き換える。敵が実際に選んだ攻撃・支援を完了した後、条件が合えば呪印の残回数1を消費し1回反応する。スキップでは反応せず、対象の行動機会による期限は減る。付与者・対象が生存し、付与者が行動可能な場合だけ反応する。通常反撃が同じ使用者から同じ敵行動に採用された場合、呪印は回数を払わず不発だが期限は減る。呪印は罠と同種の有限な敵行動反応として、1使用者・1敵行動1回、通常反撃の1巡1回とは別枠。反応から再反応・追撃・異常追加・資源・奥義ゲージは得ない（印本文に指定した単一の弱体判定のみ可）。能力・装備補助・付与Lv・正誤倍率は刻印時に保存する。戦闘不能で付与者の印を解除し、問題待ち保存は残回数・期間・乱数を保持する。');
S('A01','苦呪印',{target:'敵を選択',ap:'導入',cost:3,axis:'M無属性0.25倍・反応2回・3行動固定、対象1→2→3体',display:['ongoing'],tags:['magic','support','curse_mark']},tiers([1,2,3],targets=>L('異なる敵を最大'+targets+'体選び、苦呪印を付ける。各対象の次の3行動まで、実際の敵行動完了後にM基準の無属性0.25倍の直接反応を行う（2回まで）。付与時の即時被害はない。呪印自体は既存の状態異常数へ数えず、実反応はRESと通常の直接被害補正を受ける。','敵を'+targets+'体まで選び、行動後にダメージを受ける呪印を刻む。',{kind:'curse_mark',targetLimit:targets,variant:'bitter',base:'M',power:.25,element:'none',charges:2,turns:3,trigger:'after_performed_enemy_action'})));
strike('A02','影泥弾',[.95,1.05,1.15,1.25,1.35],{ref:'M',element:'earth',mp:'軽',ap:'導入',short:'敵1体に土魔法。'});
S('A03','衰力の呪言',{target:'敵1体',pre:['A01:1'],axis:'STR低下10%・基礎85%固定、持続2→3→4',tags:['magic','debuff']},tiers([2,3,4],turns=>L('敵1体へ基礎85%でSTR10%低下を'+turns+'行動付与する。statdownの相性とボス弱体上限を適用する。ダメージ、既存異常の強制延長、永久的な能力切捨ては行わない。','しばらく、敵1体の物理攻撃力を下げる。',{kind:'debuff',stat:'str',value:.1,rate:.85,turns})));
strike('A04','濁夜の囁き',[.95,1.05,1.15,1.25,1.35],{ref:'M',element:'dark',mp:'軽',pre:['A02:1'],short:'敵1体に闇魔法。'});
S('A05','縛呪印',{target:'敵1体',pre:['A01:1'],axis:'束縛40%・反応2回固定、印の持続2→3→4',display:['ongoing'],tags:['magic','support','curse_mark']},tiers([2,3,4],turns=>L('敵1体へ縛呪印を'+turns+'行動付ける。対象が物理攻撃を実行した後、残回数1を払って基礎40%で束縛を次の2行動付与する（反応2回まで）。魔法・非攻撃支援・スキップでは反応せず、現在行動を中断しない。ダメージはなく、標準の状態相性・免疫・ボス補正を守る。','敵1体に、物理攻撃の後で束縛を狙う呪印を刻む。',{kind:'curse_mark',variant:'binding',charges:2,turns,trigger:'after_enemy_physical_attack',status:{id:'bind',rate:.4,turns:2}})));
S('A06','静呪印',{target:'敵1体',pre:['A01:1'],axis:'沈黙35%・反応2回固定、印の持続2→3→4',display:['ongoing'],tags:['magic','support','curse_mark']},tiers([2,3,4],turns=>L('敵1体へ静呪印を'+turns+'行動付ける。対象が魔法攻撃・魔法支援を実行した後、残回数1を払って基礎35%で沈黙を次の2行動付与する（反応2回まで）。物理行動・スキップでは反応せず、発動済み魔法を取り消さない。ダメージはなく、標準の状態相性・免疫・ボス補正を守る。','敵1体に、魔法を使った後で沈黙を狙う呪印を刻む。',{kind:'curse_mark',variant:'silencing',charges:2,turns,trigger:'after_enemy_magic_action',status:{id:'silence',rate:.35,turns:2}})));
S('A07','呪印の収束',{target:'自分の印がある敵1体／自分',pre:['A01:1','A04:1'],mp:'軽',display:['special'],tags:['magic','support']},fixed('自分が付けた呪印1つを反応させずに消費し、次の闇・土属性を含む通常MAG直接攻撃魔法1行動を25%強化する。未使用期限は次の2行動終了まで。別属性・反応・奥義・遅延は対象外。他者の印は使えず、残回数から追加攻撃やMPを生まない。','自分の呪印を1つ消し、次の通常の闇・土魔法を強くする。',{kind:'prepare',requiresOwnCurseMark:true,consumeOwnCurseMark:true,nextMagicDamage:{elements:['dark','earth'],rate:.25,turns:2}}));
strike('A08','呪紋の裂き',[1.3,1.4,1.5,1.6,1.7],{ref:'M',element:'dark',pre:['A01:1','A04:2'],cost:3,short:'敵1体に強闇魔法。自分の呪印がある敵に強い。',extra:'対象に自分の有効な呪印があれば直接ダメージを20%強化する。呪印を消費・延長せず、他者の印だけでは条件を満たさない。',params:{ownCurseMarkDamage:.2}});
S('A09','呪鎖の輪',{target:'敵を選択',pre:['A03:1','A04:1'],cost:3,mp:'重',ap:'発展',axis:'恐怖35%・2行動固定、対象2→3→全体',tags:['magic','status']},tiers([2,3,8],targets=>L('異なる敵を最大'+targets+'体選び、各対象へ基礎35%で恐怖を2行動付与する。ダメージ・即死・無条件の手番スキップはなく、通常の状態相性・免疫・ボス補正と上限を適用する。',targets===8?'敵全体に恐怖を狙う。':'敵を'+targets+'体まで選び、恐怖を狙う。',{kind:'status',targetLimit:targets,status:{id:'fear',rate:.35,turns:2}})));
S('P01','呪印の結び',{pre:['A01:1'],display:['ongoing']},fixed('自分の呪印反応で実ダメージ、または指定した状態の新規付与が成立した後、自分のRESを10%上げ、次の2行動終了まで持続する。1巡1回。同じ状態の期限更新だけ・無効・単なる刻印では発動せず、MP・新しい印・反応回数を作らない。','呪印の反応が成功すると、しばらく自分の魔法防御力が上がる。1巡に1回。',{kind:'passive',afterEffectiveCurse:{values:{res:.1},turns:2,perRound:1,newStatusOnly:true}}));
stat('P02','呪法の学理','MAG');
S('P03','苦呪の深さ',{pre:['A01:1'],axis:'苦呪印の反応倍率＋M0.05→0.10→0.15'},tiers([.05,.1,.15],power=>L('自分が付ける苦呪印のM基準の反応倍率へ'+power.toFixed(2)+'倍を加算する。通常の苦呪印は0.25から'+(.25+power).toFixed(2)+'倍。刻印時に強化を保存し、反応数・期間・状態付与率・縛呪印・静呪印は変えない。','自分の苦呪印が与えるダメージが増える。',{kind:'passive',bitterMarkPowerAdd:power})));
S('P04','呪いの連携',{pre:['A04:1'],axis:'通常MAG直接魔法＋12%固定、対象異常が毒→毒・出血→毒・出血・恐怖'},tiers([['poison'],['poison','bleed'],['poison','bleed','fear']],(statuses,i)=>L('計算直前に対象が'+['毒','毒・出血','毒・出血・恐怖'][i]+'のいずれかなら、通常MAG直接攻撃魔法を12%強化する。呪印自体・能力低下だけでは発動せず、奥義・反応・継続被害は強化しない。',['毒の敵への通常の攻撃魔法が強くなる。','毒・出血の敵への通常の攻撃魔法が強くなる。','毒・出血・恐怖の敵への通常の攻撃魔法が強くなる。'][i],{kind:'passive',conditionDamage:{when:'target_status',statuses,scope:'normal_magic',rate:.12}})));
S('P05','厄除けの薄衣',{axis:'自分への呪い・魔力漏出・恐怖の最終付与率20→30→40%乗算軽減'},tiers([.2,.3,.4],rate=>L('装備中、自分への呪い・魔力漏出・恐怖の最終付与率を'+pct(rate)+'乗算軽減する。加算耐性へ足さず、加算100%なら付与率0のまま。すでに付いた異常は治さず、味方全体へ広げない。','自分が呪い・魔力漏出・恐怖にかかりにくくなる。',{kind:'passive',statusResist:{statuses:['curse','weaken','fear'],rate,multiplicative:true}})));
strike('U01','百刻の災呪',[1.8],{ref:'M',element:'dark',target:'敵全体',display:['ongoing'],short:'敵全体に極大闇魔法。ダメージを与えた敵に、強い苦呪印を刻む。',extra:'実ダメージを与えた生存敵へ、反応2回・対象3行動の苦呪印を付け、基礎反応をM無属性0.50倍にする。苦呪の深さは刻印時に加算する。旧印は反応させずに置き換え、印のダメージは敵行動後にだけ生じる。関連技能なしでも全体攻撃と刻印は成立する。',params:{targetLimit:8,afterDamagingHitCurse:{variant:'bitter',base:'M',power:.5,element:'none',charges:2,turns:3},curseTriggersSelf:false}});


const commonRules=[
 'この135技能は設計のみ。追加10〜18（50職表のNo.18〜26）を対象とし、ゲームの技能CSV・転職可否・技能実装フラグ・既存セーブは変更しない。将来の神殿Lv・職業解放は別の施設設計で決める。数値は比較用の仮値で、長期の編成・実戦シミュレーション済みとはしない。',
 '各職は通常アクティブ9・パッシブ5・奥義1。修得時に完成するレベルなし、対象・持続・条件等の最大Lv3、主力威力・基礎能力の最大Lv5を使う。基本8職の28/46/46という比率へ合わせない。今回の9奥義はすべてレベルなし。',
 '装備costは各技能で固定。通常容量10・パッシブ容量10、奥義は専用1枠・通常容量0。MPの軽/中/重は3/6/12、修得APの導入/標準/発展/奥義は10/18/28/50、強化APは12/20/30/45を現行仮値から継承。奥義は同職の非奥義10種類修得＋別AP、追加必須技能なし。強化回数は種類数を増やさない。',
 '前提は修得時だけ。現在の職名から固有能力・資源・武器補正を無料で与えず、装備した技能と残っている有効状態だけで発動する。すべて他職へ継承可能。資源が必要な技能は対応生成手段も必要だが、生成技能を外しただけで既存の有効付与をコピーしたり回復したりしない。',
 '通常の武器攻撃Wは既存式、通常直接魔法Mは既存のMAG式。WBはSTR＋物理武器威力＋MAG35%を1つの攻撃力としてDEFで軽減し、MSはMAGと鎌用の術補助でRES軽減する。WB・MSは新しい実装が必要な設計。MAG鎌術へ物理武器威力・STR武器倍率・通常鎌の状態付与を流用しない。',
 '支援へ見た目だけの光・水などの攻撃属性を付けない。属性と参照能力・physical/magicの使用制限は別。WBの攻撃は封印、MAG/MS攻撃・場・使い魔・呪印・属性付与は沈黙の制限を受ける。非攻撃の自己支援は恐怖の攻撃技能制限だけでは禁止しない。',
 '付与行動自身で期間を減らさず、次の対象の行動機会から減らす。スキップでも減る。場・使い魔は付与者、呪印は付与対象の敵の機会で管理する。次の行動開始までと明記した跳躍・身代わり等は開始時に終了する。秒数・英語の回答速度で期間を決めない。',
 '今回の使い魔・呪印の自動反応の行動可能判定は、戦闘不能・石化・睡眠・凍結・スタン・麻痺・混乱・魅了で不許可とする。沈黙・封印は自発技能の使用を制限するが、すでに付けた呪印の有限な自動反応にはMP支払い・再詠唱を要求しない。1行動1問を保つ。使い魔・呪印・追撃・分身は独立した手番・HPバー・追加回答を持たない。跳躍は既存の2行動を準備と着地へ使い、追加の手番・問題は生まない。正誤倍率は準備や契約へ保存し、跳躍は準備倍率×着地倍率、使い魔は契約倍率×主撃倍率、呪印は刻印倍率を使う。',
 '直接ダメージ・回復・防護・数値強化・状態の基礎率には該当する自発行動の正誤倍率を適用する。対象上限・装填の発数・反応回数などの離散値は半端にせず本文値。離散資源の生成にもMPと行動が必要で、自動反応や消費から同じ資源を生成しない。',
 '敵への状態率は基礎率に相性・免疫・ボス補正を掛け、上限95%。LUKを一律加算しない。味方の加算耐性は100%まで、その後に各技能の残存率を掛ける。加算100%は必ず付与率0。乗算軽減を加算耐性へ足さず、耐性を得ても既存異常を治さない。束縛は回避・逃走制限であり手番スキップではない。',
 '異常・能力低下・標的・弱点の条件は各打撃の直前に判定し、今回付ける異常や減らすHPを同じ打撃へ遡及しない。行動開始時条件と明記したものはスナップショット。状態異常は既存20種だけを数え、標的・場・使い魔・呪印などの職業状態は種類数へ加えない。',
 '能力割合強化100%、DEF/RES等の低下50%（ボスの現行低下上限は別途適用）、直接被害軽減70%、DEF無視70%、会心85%、回避60%、防護合計最大HP50%、MP軽減合計50%の共通上限を守る。命中準備は最終命中へ加算し上限100%。MP軽減後は切り上げ、通常技能の最低MP1。',
 '同名の継続効果は強い値で更新し、弱い値で強い値や長い期間を延長しない。全体支援は同名の使用者違いでも二重に掛けない。状態の対象・属性を変えた場合も同じ技能IDの複数コピーは残さない。場の属性変更・使い魔の型変更はそれぞれの明示した置換規則に従う。',
 '反撃は本人ごと1巡1回、通常反撃準備は1枠。自発行動に続く技能追撃は本人1行動1回。今回の使い魔と影写しが同時成立したら影写しを優先し、使い魔は回数を払わず不発だが期間は減る。主対象が倒れた・外れた・無効でも優先枠を後から別反応へ譲らない。',
 '反撃・追撃・罠・呪印・継続被害から追加追撃・追加反撃・資源・撃破MP・奥義ゲージ・新しい撃破反応を起こさない。本文が指定する単一の状態付与・弱体反応だけを例外とする。追撃には主撃専用の踏み込み・魔力集中・影の集中・初撃・通常技能準備を二重適用しない。',
 '呪印は有限回数の敵行動反応であり、本人1敵行動1回。対象が実行した全対象・全打撃の後に反応し、敵の現在の行動を取り消さない。同じ使用者の通常反撃がその敵行動に採用されたら呪印は不発。付与者の戦闘不能・行動不能、対象の撃破、反応枠競合で不発なら利用回は払わないが、敵の行動機会による期限は減る。',
 '跳躍準備は攻撃の命中・武器技連携・怒気獲得・祈念消費として数えない。着地が唯一の通常武器技であり、祈念・怒気・追跡・会心準備・状態付与・主撃撃破はそこで共通規則を1回適用する。準備開始時に踏み切りの呼吸だけを予約へ移し、二重保持せず、着地成功前に中断しても返さない。',
 '空中の竜騎士は表示を消さない。回避可能な単体攻撃の標的候補から外し、全体直接攻撃では本人分だけを避ける。全員が空中ならその回避可能な攻撃は不発。必中は空中も狙え、状態だけの妨害・継続被害は防がない。空中を回避成功判定に数えて回避反撃等を得ない。次の本人の機会開始で空中を終え、行動不能・強制行動なら着地を取り消す。',
 '現在の装備・MP・資源・生存対象・属性と型の選択・生成枠をすべて検証した後に費用を同時確定する。条件不足ならMP・HP・資源・ゲージを払わない。支払い後の不命中・無効・着地中断は返金しない。入力上の無効操作で期間を凍結・巻き戻しもしない。',
 '戦闘開始時は追跡・装填・余勢・属性付与・場・使い魔・呪印・跳躍なし。戦闘不能と終了で解除する。開幕経過と一戦使用済み回数は蘇生で戻さない。途中保存では付与者・対象・元技能・付与Lv・正誤倍率・残数・残期間・消費予約・乱数を保持する。表示や成功率のプレビューでは状態を消費しない。',
 'アイコンはPR #120の32×32px job-special画像を全体の強化・弱化／ジョブの固有継続効果／その他の特殊効果で共用する。戦闘常設の新ゲージや専用画像は増やさず、詳細で名前・対象・残量・期限を示す。属性付与は既存の分類どおり特殊、場は全体、使い魔・呪印・装填・追跡は固有継続、跳躍予約・次回準備は特殊とする。',
 'この設計書の装備例は開発用。ゲーム内にビルドの手引きを増やさず、施設・ランク・ジョブ解放・町での技能使用の新仕様も同時には決めない。後続の死霊術師・陰陽師などの役割を先取りしない。'
];
const loadouts={
 assassin:{actions:['A01','A02','A03','A08'],passives:['P01','P03','P04','P05'],cycle:'仲間の状態異常・能力低下を確認し、隙の照準から刺突・斬撃へつなぐ。武器は短剣。'},
 bounty_hunter:{actions:['A01','A02','A03','A08'],passives:['P01','P02','P04','P05'],cycle:'追跡札→追矢で追跡→束縛や包囲の合図。終射へ替える場合はアクティブcostを再調整する。'},
 dragoon:{actions:['A01','A02','A06','A09'],passives:['P01','P02','P03','P04'],cycle:'必要なときに踏み切り→跳躍準備→次の自分の機会の着地→落雷突き。槍装備。'},
 gunner:{actions:['A01','A02','A03','A06'],passives:['P01','P02','P03','P04'],cycle:'装弾→相性なら火薬弾、硬い敵には貫甲弾。残数0なら定射か装弾。銃装備。'},
 pirate:{actions:['A01','A02','A03','A07'],passives:['P01','P02','P03','P05'],cycle:'開幕号令→斬り込み→主撃撃破の余勢を次の武器技か全体鼓舞へ。斧または剣。'},
 spellblade:{actions:['A01','A02','A04','A08'],passives:['P01','P02','P03','P04'],cycle:'必要属性を付与→紋刃・紋連斬。相性が変わったら別属性へ付与し、次の対応技のMPを軽減する。剣・刀。'},
 elementalist:{actions:['A01','A02','A04','A07'],passives:['P01','P02','P03','P04'],cycle:'敵の攻撃属性も確認して場を選び、同属性魔法と庇護を使う。風・土・水の全技を一度には装備しない。'},
 witch:{actions:['A01','A02','A05','A06'],passives:['P01','P02','P03','P04'],cycle:'使い魔契約→追撃または悪戯を選択→MAG鎌術。回数と期間が切れたら再契約。鎌装備。'},
 hexer:{actions:['A01','A02','A04','A08'],passives:['P01','P02','P03','P04'],cycle:'敵の実行行動を見て苦呪・縛呪・静呪を選ぶ。苦呪なら刻印→闇・土の術、敵行動後に有限反応。'}
};

const expected=['assassin','bounty_hunter','dragoon','gunner','pirate','spellblade','elementalist','witch','hexer'];
assert.deepEqual(jobs.map(j=>j.id),expected);
const all=jobs.flatMap(j=>j.skills),byId=new Map(all.map(s=>[s.id,s]));
assert.equal(all.length,135);assert.equal(byId.size,135);assert.equal(new Set(all.map(s=>s.name)).size,135);
const sourceSnapshot={baseCommit,existingJobs:roster.filter(j=>j.skills_ready==='1').length+8,existingMasterSkills:existing.filter(s=>JSON.parse(s.effect_json).master).length,
 existingSkillsCompared:existing.length,spellEquipment:rules.spell_equipment,caps:rules.caps};
for(const s of all){
 assert.ok(!existing.some(old=>old.id===s.id||old.name===s.name),'既存技能と重複: '+s.id+' '+s.name);
 assert.equal(s.effects.length,s.maxLevel);assert.equal(s.simpleDescriptions.length,s.maxLevel);assert.equal(s.levelRules.length,s.maxLevel);
 assert.equal(new Set(s.effects).size,s.maxLevel,s.id+' 本文に成長差');
 assert.equal(new Set(s.levelRules.map(x=>JSON.stringify(x))).size,s.maxLevel,s.id+' 数値・条件に成長差');
 assert.ok(s.effects.every(x=>x.length>20&&!/undefined|NaN|TODO|未定/.test(x)),s.id+' 詳細文');
 assert.ok(s.simpleDescriptions.every(x=>x.length>=5&&x.length<=115&&!/\d+(?:\.\d+)?倍|STR|MAG|DEF|RES|W基準|M基準/.test(x)),s.id+' 簡素説明');
 assert.ok(s.role&&s.target&&s.inheritance&&formulas[s.reference]);
 assert.ok(s.upgradeAp.length===s.maxLevel-1&&s.baseMp>=0&&s.learnAp>0);
 assert.ok(s.type==='ultimate'?s.cost===0:s.cost>=1&&s.cost<=4);
 assert.ok(s.type!=='active'||s.tags.some(x=>['physical','magic'].includes(x)),s.id+' 行動制限');
 if(s.tags.includes('jump_prepare'))assert.ok(!s.tags.includes('weapon'));
 for(const p of s.prerequisites){const parent=byId.get(p.id);assert.ok(parent&&parent.type!=='ultimate'&&p.level>=1&&p.level<=parent.maxLevel,s.id+' 前提');}
 for(const p of s.levelRules){
  assert.ok(p&&Object.keys(p).length,s.id+' 数値定義');
  if(p.hits)assert.ok(Math.abs(p.hits.reduce((a,b)=>a+b,0)-1)<1e-8,s.id+' 総倍率');
  if(p.targetLimit)assert.ok(p.targetLimit>=1&&p.targetLimit<=8);
  if(p.ammoCost!=null)assert.ok(p.ammoCost>=0&&p.ammoCost<=3);
 }
}
const done=new Set(),visiting=new Set();
function visit(id){assert.ok(!visiting.has(id),'前提循環: '+id);if(done.has(id))return;visiting.add(id);for(const p of byId.get(id).prerequisites)visit(p.id);visiting.delete(id);done.add(id);}
all.forEach(s=>visit(s.id));
const counts=skills=>({none:skills.filter(s=>s.maxLevel===1).length,lv3:skills.filter(s=>s.maxLevel===3).length,lv5:skills.filter(s=>s.maxLevel===5).length});
const perJob=[];
for(const j of jobs){
 assert.equal(j.skills.length,15);for(const [type,n]of [['active',9],['passive',5],['ultimate',1]])assert.equal(j.skills.filter(s=>s.type===type).length,n);
 assert.ok(j.skills.some(s=>s.type==='active'&&!s.prerequisites.length));assert.ok(j.skills.filter(s=>s.type==='ultimate').every(s=>s.maxLevel===1&&!s.prerequisites.length));
 const loadout=loadouts[j.id],total=key=>loadout[key].reduce((sum,code)=>sum+byId.get(j.id+'_'+code).cost,0);
 assert.ok(total('actions')<=10&&total('passives')<=10,j.name+' 装備容量');
 perJob.push({id:j.id,name:j.name,additionalNumber:j.additionalNumber,masterNumber:j.masterNumber,...counts(j.skills),stages:j.skills.reduce((sum,s)=>sum+s.maxLevel,0),exampleActionCost:total('actions'),examplePassiveCost:total('passives')});
}
const validation={status:'design_only',jobs:jobs.length,skills:all.length,counts:counts(all),stages:all.reduce((sum,s)=>sum+s.maxLevel,0),
 prerequisiteEdges:all.reduce((sum,s)=>sum+s.prerequisites.length,0),reachableNonUltimates:all.filter(s=>s.type!=='ultimate'&&done.has(s.id)).length,
 perJob,checks:['各職A9/P5/U1・全135技能','既存256技能と名前・IDの重複なし','全段階の本文・短文・数値定義が一致','1/3/5成長・各段階の数値または条件に差','前提の参照・上限・非奥義・循環なし','非奥義126技能へ到達可能・奥義10種類条件を満たせる','固定cost・奥義専用枠・手動AP','9職の開発用装備例がA10/P10以内','全アクティブのphysical/magic分類','全体対象上限8・装填上限3・連撃合計倍率1']};
const source={schemaVersion:1,title:'English Quest 追加10〜18職 スキル設計 v1',date:'2026-11-26',status:'design_only',
 references:['docs/jobs-baseline-v2.md','docs/basic-jobs-skills-v2.md','docs/additional-jobs-01-03-redesign-v2.md','docs/additional-jobs-04-06-implementation.md','docs/additional-jobs-07-09-implementation.md','docs/battle-job-effects-display.md'],
 formulas,commonRules,jobs,developmentLoadouts:loadouts,sourceSnapshot,validation};
const cell=v=>String(v??'').replaceAll('|','／').replaceAll('\n',' '),row=values=>'| '+values.map(cell).join(' | ')+' |';
const mode=s=>s.maxLevel===1?'レベルなし':'最大Lv'+s.maxLevel;
const pre=s=>s.type==='ultimate'?'同職非奥義10種類＋別AP':s.prerequisites.length?s.prerequisites.map(p=>{const parent=byId.get(p.id);return parent.name+(parent.maxLevel===1?' 修得':' Lv'+p.level);}).join('・'):'なし';
const countTable=['| 職業 | レベルなし | 最大Lv3 | 最大Lv5 | 効果段階 |','|---|---:|---:|---:|---:|',...perJob.map(j=>row([j.name,j.none,j.lv3,j.lv5,j.stages])),row(['合計',validation.counts.none,validation.counts.lv3,validation.counts.lv5,validation.stages])].join('\n');
let doc='# English Quest：追加10〜18職 スキル設計 v1\n\n2026-11-26。**設計のみ・ゲーム未実装**。追加一覧10〜18、50職基準表のNo.18〜26を対象とする。9職×15技能＝135技能、'+validation.stages+'効果段階。現在の17職・255マスター技能の利用可否は変更しない。\n\n全成長段階の詳細本文・簡素説明・数値定義・表示分類を[仕様JSON](specs/additional-jobs-10-18-skills-v1.json)へ保存する。準備・有限反応・鎌術装備の点検は[設計点検](additional-jobs-10-18-review-v1.md)を参照。数値は仮値であり、個別実装時の実戦・編成検証を必要とする。\n\n## 職業の役割\n\n| 追加番号 | 50職表番号 | 職業 | 主な戦い方 |\n|---|---|---|---|\n'+jobs.map(j=>row([j.additionalNumber,j.masterNumber,j.name,j.role])).join('\n')+'\n\n## 成長方式\n\n'+countTable+'\n\n## 共通ルール\n\n'+commonRules.map((s,i)=>(i+1)+'. '+s).join('\n')+'\n\n## 参照式\n\n| ID | 定義 |\n|---|---|\n'+Object.entries(formulas).map(([id,formula])=>row([id,formula])).join('\n')+'\n\n';
for(const j of jobs){
 doc+='## 追加'+j.additionalNumber+'：'+j.name+'\n\n'+j.role+'\n\n**既存職との分担**：'+j.difference+'\n\n**戦闘内状態**：'+j.state+'\n\n### 一覧とゲーム用の簡素説明\n\n| ID | 種別 | 技能 | 成長 | cost | 基礎MP | 修得AP | 簡素説明（修得時） |\n|---|---|---|---|---:|---:|---:|---|\n'+j.skills.map(s=>row([s.id,{active:'通常',passive:'P',ultimate:'奥義'}[s.type],s.name,mode(s),s.cost,s.baseMp,s.learnAp,s.simpleDescriptions[0]])).join('\n')+'\n\n';
 for(const s of j.skills){
  doc+='#### '+s.id+' '+s.name+'\n\n- 役割：'+s.role+'\n- 成長：'+mode(s)+'。'+s.growthAxis+'\n- 対象：'+s.target+'／武器：'+s.weaponCondition+'／参照：'+s.reference+'\n- 修得前提：'+pre(s)+'\n- 費用：装備cost '+s.cost+'、基礎MP '+s.baseMp+'、修得AP '+s.learnAp+(s.upgradeAp.length?'、強化AP '+s.upgradeAp.join('／'):'、強化AP不要')+'\n- 継承：'+s.inheritance+'\n- 継続表示：'+(s.effectDisplay.sections.join('・')||'新しい継続状態なし')+'。'+s.effectDisplay.note+'\n\n| 段階 | 詳細効果 | ゲーム用の簡素説明 |\n|---|---|---|\n'+s.effects.map((effect,i)=>row([s.maxLevel===1?'修得時':'Lv'+(i+1),effect,s.simpleDescriptions[i]])).join('\n')+'\n\n';
 }
 const l=loadouts[j.id],info=perJob.find(x=>x.id===j.id);
 doc+='### 開発用の装備例\n\n- 通常（cost '+info.exampleActionCost+'/10）：'+l.actions.map(code=>byId.get(j.id+'_'+code).name).join('・')+'\n- パッシブ（cost '+info.examplePassiveCost+'/10）：'+l.passives.map(code=>byId.get(j.id+'_'+code).name).join('・')+'\n- 確認する流れ：'+l.cycle+'\n\n';
}
doc+='## 実装時の確認項目\n\n- 跳躍の準備・着地・中断・保存再開で、費用・英語回答・武器技資源・防御窓を重複させない。\n- 装弾は上限時に使えず、特殊弾は単体・全体・連撃でも行動単位の費用だけ。奥義の補充を通常装弾の反応に数えない。\n- 追跡、開幕窓、余勢はスキップ・再指定・複数対象・蘇生・強制行動で複製しない。\n- WBの物理技能分類とMSの魔法分類、鎌術の装備補助を分け、物理武器威力を一般魔法へ混入させない。\n- 属性付与の対応技・固定属性技・通常攻撃を区別し、場の双方への効果と付与者の期間を保存する。\n- 影写しと使い魔の優先枠は主撃前に確定し、不命中・撃破から別の追撃へ切り替えない。使い魔の型変更で残回数・期限を戻さない。\n- 呪印は敵が実行した行動の全対象・全打撃の後。所有者・相性・状態新規付与・通常反撃との優先、スキップによる期限消費を確認する。\n- 既存の加護・祈念・怒気・構え・分身・追撃・罠・装備効果との組合せを実エンジンで検証してから実装済みにする。\n\n## 設計検証\n\n'+validation.checks.map(s=>'- '+s).join('\n')+'\n\n生成コマンド：node scripts/design-additional-jobs-10-18.mjs。点検：node scripts/check-additional-jobs-10-18.mjs --write。詳細な数値の実戦評価・長期シミュレーションは個別実装後に行う。\n';
fs.writeFileSync(path.join(root,'docs/specs/additional-jobs-10-18-skills-v1.json'),JSON.stringify(source,null,2)+'\n');
fs.writeFileSync(path.join(root,'docs/additional-jobs-10-18-skills-v1.md'),doc);
console.log(JSON.stringify(validation,null,2));
