import test from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../sim/balance.mjs';
import { createNewGame, defaultPartySpecs, normalizeGame } from '../js/game-state.js';
import { unlockJob, offeringRevealed } from '../js/temple.js';
import { changeJob, learnSkill, availableJobs, equipSkill } from '../js/growth.js';
import { maxMp, makeGear } from '../js/character.js';
import { countKills, reportQuest } from '../js/town.js';
import { returnToTown } from '../js/dungeon.js';
import { GameSession } from '../js/save.js';
import { MemoryStorage } from './helpers.js';
import { makeEnemy, createBattle, actionOptions, setPending, resolvePending, skillMp } from '../js/battle.js';
const data = loadData();
const fresh = () => createNewGame(data, defaultPartySpecs(data));
const jobs = ['infernalist','seal_archer','neutralist'];
const materials = { infernalist: {lava_golem_rare:2,lava_golem_mat:4}, neutralist:{paper_golem_rare:2,paper_golem_mat:4} };
function train(job) {
 const game=fresh(); game.unlockedJobs.push(job); game.jp=1000;
 changeJob(data,game,0,job); const m=game.party[0]; m.lv=45; m.ap[job]=65;
 m.loadout={actions:[job+'_art'],passives:[]};
 learnSkill(data,m,job+'_passive');learnSkill(data,m,job+'_ultimate');
 m.equip.weapon=makeGear(game,job==='seal_archer'?'bow_t1':'tome_t1');m.mp=maxMp(data,m);
 return game;
}
function act(game, skillId, {statuses=[],passive=true,immune=false,correct=true,weapon,seed=2,evasion=0}={}) {
 game=structuredClone(game);const m=game.party[0];if(!passive)m.loadout.passives=[];if(weapon)m.equip.weapon=makeGear(game,weapon);
 const enemies=[0,1].map(()=>{const e=makeEnemy(data,'slime',{lv:15});e.hp=e.maxHp=100000;e.evasion=evasion;e.statusAffinity={burn:immune?'×':'★',seal:immune?'×':'★'};for(const s of statuses)e.statuses[s]={turns:2,n:1};return e;});
 const b=createBattle(data,game,{enemies,seed});b.round=1;b.turn={side:'ally',i:0};
 setPending(b,{type:'skill',skillId,target:0},{});resolvePending(data,game,b,correct);
 return {game,b,enemies,damage:100000-enemies[0].hp};
}
test('3職・9技能を追加し、6人と1024体・既存の適性を維持',()=>{
 assert.equal(data.jobs.length,20);assert.equal(data.monsters.size,1024);assert.equal(fresh().party.length,6);
 for(const job of jobs){assert.equal([...data.skills.values()].filter(s=>s.job===job).length,3);assert.ok(!availableJobs(data,fresh()).some(j=>j.id===job));}
});
for(const job of ['infernalist','neutralist'])test(`${job}: 奉納は安全帰還後に発見、全滅で巻戻し、必要数だけ消費`,()=>{
 const storage=new MemoryStorage(),session=new GameSession({storage});session.startNew(fresh());
 const enter=()=>session.enterDungeon({dungeonId:'sky_isles',state:'return_point',backpack:{gear:[],materials:{...materials[job]}},earned:{xp:0}});
 enter();assert.equal(offeringRevealed(data,session.game,data.jobUnlocks.get(job)),false);session.wipe();assert.equal(offeringRevealed(data,session.game,data.jobUnlocks.get(job)),false);
 enter();returnToTown(data,session);assert.equal(offeringRevealed(data,session.game,data.jobUnlocks.get(job)),true);
 unlockJob(data,session.game,job);assert.deepEqual(session.game.storage.materials,{});assert.ok(session.game.unlockedJobs.includes(job));
});
test('封技弓士は対象の封印使いを実際に討伐して依頼報告した時だけ解放',()=>{
 const game=fresh();const q={uid:100,questId:'q_bounty_07_2',type:'bounty',rank:7,count:1,progress:0,target:'bounty_07_2',targetIds:['bounty_07_2'],dungeonId:'sky_isles'};
 game.quests.push(q); const storage=new MemoryStorage(),s=new GameSession({storage});s.startNew(game);s.enterDungeon({dungeonId:'sky_isles'});
 const enemy=makeEnemy(data,'bounty_07_2',{lv:45});enemy.hp=0;assert.equal(enemy.status,'seal');
 countKills(s.game,[enemy],'sky_isles');assert.ok(!s.game.unlockedJobs.includes('seal_archer'));s.wipe();assert.throws(()=>reportQuest(data,s.game,100));
 countKills(s.game,[enemy],'sky_isles');reportQuest(data,s.game,100,()=>0);assert.ok(s.game.unlockedJobs.includes('seal_archer'));
});
for(const job of jobs)test(`${job}: AP65・転職費・持出し・現職奥義・保存再読込`,()=>{
 const game=train(job),m=game.party[0];assert.equal(game.jp,1000-data.jobsById.get(job).changeJp);assert.equal(m.ap[job],0);
 const out=act(game,job+'_ultimate');assert.equal(actionOptions(data,out.game,out.b,0).skills.find(x=>x.skill.id===job+'_ultimate').reason,'この戦闘ではもう使った');
 const s=new GameSession({storage:new MemoryStorage()});s.startNew(game);const reread=new GameSession({storage:s.store.storage});normalizeGame(data,reread.game);
 assert.deepEqual(reread.game.party[0].loadout,m.loadout);
 changeJob(data,game,0,job==='seal_archer'?'hunter':'black_mage');assert.ok(m.loadout.actions.includes(job+'_art'));assert.ok(m.loadout.passives.includes(job+'_passive'));assert.ok(!m.loadout.actions.includes(job+'_ultimate'));assert.throws(()=>equipSkill(data,m,job+'_ultimate'));
});
test('炎は全体・火傷中の炎直接ダメージのみ増加し、封印追撃は弓だけ。初回に先付与しない',()=>{
 for(const [job,status] of [['infernalist','burn'],['seal_archer','seal']]){
 const game=train(job),id=job+'_art';const base=act(game,id,{statuses:[status],passive:false}).damage;
 assert.ok(Math.abs(act(game,id,{statuses:[status]}).damage-base*1.15)<=2);
 assert.equal(act(game,id).damage,act(game,id,{passive:false}).damage);
 assert.equal(act(game,id,{immune:true}).enemies[0].statuses[status],undefined);
 if(job==='infernalist')assert.ok(act(game,id).enemies[1].hp<100000);
 else assert.equal(act(game,id,{statuses:[status],weapon:'tome_t1'}).damage,act(game,id,{statuses:[status],weapon:'tome_t1',passive:false}).damage);
 }
 const g=train('infernalist');const cold=[...data.skills.values()].find(s=>s.kind==='attack'&&s.effect.base==='mag'&&s.elements.includes('ice'));
 assert.equal(act(g,cold.id,{statuses:['burn']}).damage,act(g,cold.id,{statuses:['burn'],passive:false}).damage);
});
test('無相の節約は直接無属性魔法だけ。MP_SAVEと加算し50%上限・切上げを保つ',()=>{
 const game=train('neutralist'),m=game.party[0],skill=data.skills.get('neutralist_art');
 const base=structuredClone(m);base.loadout.passives=[];
 assert.equal(skillMp(data,m,skill),Math.ceil(skill.mp*(1+data.balance.mp_rules.skill_mp_per_lv*(m.lv-1))*.9));
 for(const change of [{kind:'heal'},{kind:'delayed'},{effect:{base:'weapon'}},{elements:['fire']},{effect:{base:'mag',element:'fire'}}]){const s={...skill,...change};assert.equal(skillMp(data,m,s),skillMp(data,base,s));}
 for(const n of [35,48,70]){m.equip.weapon.affixes={MP_SAVE:n};base.equip.weapon.affixes={MP_SAVE:n};const raw=skill.mp*(1+data.balance.mp_rules.skill_mp_per_lv*(m.lv-1));assert.equal(skillMp(data,m,skill),Math.ceil(raw*(1-Math.min(.5,n/100+.1))));}
});
test('状態特効は既存の60%上限を共有し、封印奥義のミス時は付与しない',()=>{
 for(const [job,status] of [['infernalist','burn'],['seal_archer','seal']]){
  const game=train(job);game.party[0].equip.weapon.affixes={['VS_STATUS:'+status]:60};
  assert.equal(act(game,job+'_art',{statuses:[status]}).damage,act(game,job+'_art',{statuses:[status],passive:false}).damage);
 }
 const game=train('seal_archer');let missed=false;
 for(let seed=1;seed<=100;seed++){const out=act(game,'seal_archer_ultimate',{seed,evasion:1});if(out.damage===0){missed=true;assert.equal(out.enemies[0].statuses.seal,undefined);break;}}
 assert.ok(missed);
});
test('新技能でも不正解の支払MPと既存の不正解処理を保つ',()=>{
 for(const job of jobs){const game=train(job),m=game.party[0],mp=m.mp,skill=data.skills.get(job+'_art');const out=act(game,skill.id,{correct:false});assert.equal(out.game.party[0].mp,mp-skillMp(data,m,skill));}
});
test('未経験職の新しいAP0技能は解放・装着されない',()=>{
 const m=fresh().party[0];
 for(const job of jobs)assert.throws(()=>equipSkill(data,m,job+'_art'),/覚えていない/);
});
