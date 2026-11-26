// 追加7〜9職の実行定義。設計の文章を実行時には解釈しない。
export const specialistJobs = ['ascetic','executioner','ninja'];
export const specialistPlans = new Map();
const add=(id,kind,build)=>specialistPlans.set(id,{kind,build});
const weapon=(m,element,rules={})=>({base:'weapon',m,element,rules});
const qi=(m,element,rules={})=>({base:'phys',m,element,rules:{no_weapon_power:true,...rules}});
const values=[.04,.06,.08,.10,.12],damage=[.05,.07,.09,.11,.13];
add('ascetic_A01','heal',i=>({tgt:'self',rules:{heal_frac:[.06,.08,.10,.12,.14][i]}}));
add('ascetic_A02','attack',i=>qi([1.1,1.25,1.4,1.55,1.7][i],'blunt'));
add('ascetic_A03','attack',i=>qi([1.15,1.3,1.45,1.6,1.75][i],'none'));
add('ascetic_A04','self_buff',i=>({buff:{res:.15},turns:i+2}));
add('ascetic_A05','cure',i=>({tgt:'self',rules:{cure_statuses:[['poison'],['poison','toxic','burn'],['poison','toxic','burn','bleed','weaken']][i]}}));
add('ascetic_A06','attack',i=>qi([.95,1.1,1.25,1.4,1.55][i],'earth',{attack_after:{rate:.8,debuff:{res:.1},turns:2}}));
add('ascetic_A07','self_buff',()=>({rules:{status_resist:{statuses:['bind','fear','stun'],rate:.3,multiplicative:true,turns:3}}}));
add('ascetic_A08','self_buff',i=>({rules:{regen:{frac:.03,trigger:'end',turns:i+2}}}));
add('ascetic_A09','attack',i=>qi([1.5,1.7,1.9,2.1,2.3][i],'none',{previous_self_recovery:.25}));
add('ascetic_P01','passive',()=>({rules:{breath_cycle:{rate:.15}}}));
add('ascetic_P02','passive',i=>({mod:{hp:values[i]}}));
add('ascetic_P03','passive',i=>({rules:{condition_cut:[{when:'self_status',scope:'all',rate:.12,statuses:[['poison'],['poison','burn','bleed'],['poison','burn','bleed','toxic','weaken']][i]}]}}));
add('ascetic_P04','passive',i=>({rules:{on_self_heal:{res:.12,turns:i+1}}}));
add('ascetic_P05','passive',i=>({mod:{res:values[i]}}));
add('ascetic_U01','heal',()=>({tgt:'self',buff:{res:.4},turns:3,rules:{heal_frac:.6,
  cure_before_heal:['poison','toxic','burn','bleed','weaken','blind','fear','bind'],qigong_damage:{rate:.3,turns:3}}}));
add('executioner_A01','attack',i=>weapon([1.2,1.35,1.5,1.65,1.8][i],'slash'));
add('executioner_A02','attack',i=>({...weapon(1,'slash'),st:['bleed',.35],status_turns:i+2}));
add('executioner_A03','self_buff',i=>({tgt:'selected_enemy',rules:{next_target_crit:{threshold:[.4,.55,.7][i],rate:.2,turns:2}}}));
add('executioner_A04','attack',i=>({...weapon(.75,'slash'),tgt:'all',target_limit:[2,3,8][i],select_targets:true}));
add('executioner_A05','attack',i=>weapon([1.1,1.25,1.4,1.55,1.7][i],'dark'));
add('executioner_A06','status',()=>({st:['fear',.5],status_turns:2,rules:{low_hp_status:{threshold:.5,rate:.7}}}));
add('executioner_A07','self_buff',()=>({rules:{next_accuracy:{tag:'weapon',rate:.3,turns:2}}}));
add('executioner_A08','attack',i=>weapon([1.45,1.65,1.85,2.05,2.25][i],'slash',{condition_damage:[{when:'target_hp_below',threshold:.3,scope:'weapon',rate:.4}]}));
add('executioner_A09','attack',i=>weapon([1.5,1.7,1.9,2.1,2.3][i],'slash',{kill_followup:{m:.6,element:'slash'}}));
add('executioner_P01','passive',()=>({rules:{condition_damage:[{when:'target_hp_below',threshold:.35,scope:'weapon',rate:.18}]}}));
add('executioner_P02','passive',i=>({rules:{condition_damage:[{when:'weapon_type',weapons:['axe','scythe'],scope:'weapon',rate:damage[i]}]}}));
add('executioner_P03','passive',i=>({rules:{condition_damage:[{when:'target_status',statuses:['bleed','poison','burn'].slice(0,i+1),scope:'weapon',rate:.1}]}}));
add('executioner_P04','passive',()=>({rules:{on_primary_kill:{tag:'weapon',rate:.2,turns:2}}}));
add('executioner_P05','passive',i=>({rules:{low_hp_source_cut:{threshold:.35,rate:[.08,.12,.16][i]}}}));
add('executioner_U01','attack',()=>weapon(5,'slash',{condition_damage:[{when:'target_hp_below',threshold:.35,scope:'weapon',rate:.3}],kill_followup:{m:1.5,element:'slash'}}));
add('ninja_A01','self_buff',i=>({rules:{clones:{count:i+1,max:3,turns:3,evasion:.2}}}));
add('ninja_A02','self_buff',()=>({rules:{spend_clone:true,substitute:{expire:'start'}}}));
add('ninja_A03','attack',i=>weapon([1.05,1.2,1.35,1.5,1.65][i],'slash'));
add('ninja_A04','attack',i=>({base:'mag',m:[.95,1.05,1.15,1.25,1.35][i],element:'wind'}));
add('ninja_A05','attack',i=>({base:'mag',m:[.95,1.05,1.15,1.25,1.35][i],element:'dark'}));
add('ninja_A06','attack',i=>({...qi(.6,'pierce'),tgt:'all',target_limit:[2,3,8][i],select_targets:true,st:['bind',.4],status_turns:2}));
add('ninja_A07','self_buff',i=>({buff:{spd:.15},turns:i+1,rules:{next_accuracy:{tag:'weapon',rate:.15,turns:i+1}}}));
add('ninja_A08','attack',i=>weapon([1.4,1.6,1.8,2,2.2][i],'slash',{optional_clone:.2}));
add('ninja_A09','self_buff',()=>({rules:{spend_clone:true,require_direct_magic:true,next_magic_echo:{m:.35,turns:2}}}));
add('ninja_P01','passive',()=>({rules:{on_clone_spend:{evasion:.1,turns:1}}}));
add('ninja_P02','passive',i=>({mod:{spd:values[i]}}));
add('ninja_P03','passive',i=>({rules:{condition_damage:[{when:'element',scope:'magic',elements:['wind','dark'],rate:damage[i]}]}}));
add('ninja_P04','passive',i=>({rules:{clone_magic_cut:[.06,.09,.12][i]}}));
add('ninja_P05','passive',i=>({rules:{clone_focus:{count:3-i,rate:.1}}}));
add('ninja_U01','attack',()=>({base:'mag',m:2.4,element:'wind',tgt:'all',rules:{
  clones:{count:3,max:3,turns:3,evasion:.2,replace:true},
  clone_empower:{evasion:.3,magic:{elements:['wind','dark'],rate:.25,normalOnly:true},turns:3}
}}));
