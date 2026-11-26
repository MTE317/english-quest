import test from 'node:test';
import assert from 'node:assert/strict';
import {realGameData} from './helpers.js';
import {createNewGame,normalizeGame} from '../js/game-state.js';
import {upgradeSkill,skillMaxLevel} from '../js/growth.js';
import {prerequisiteText} from '../js/ui/skill-presentation.js';
const data=realGameData();
const fresh=()=>createNewGame(data,['warrior','knight','monk','thief','hunter','bard'].map(job=>({job,name:job,icon:'x'})));
test('成長方式28/46/46、全奥義固定、前提は参照先の上限以内',()=>{
 const list=[...data.skills.values()].filter(s=>s.effect.master&&data.jobsById.get(s.job)?.tier==='base');
 assert.deepEqual([1,3,5].map(n=>list.filter(s=>skillMaxLevel(s)===n).length),[28,46,46]);
 for(const s of list){if(s.isFinal)assert.equal(skillMaxLevel(s),1);for(const p of s.effect.prerequisites)assert.ok(p.level<=skillMaxLevel(data.skills.get(p.id)));}
});
test('既存Lv5の超過APだけを本人と遠征前へ一度返し、修得・装備・所持品を保持する',()=>{
 const game=fresh(), m=game.party[0];delete m.skillGrowthVersion;
 m.ap=100;m.learned=['warrior_A02','knight_A01','warrior_A01'];
 m.skillLevels={warrior_A02:5,knight_A01:5,warrior_A01:5};
 m.loadout.actions=['warrior_A02','knight_A01'];
 const run={snapshot:structuredClone(game)};const gear=structuredClone(game.storage);
 normalizeGame(data,game,run);
 assert.equal(m.ap,282);assert.equal(run.snapshot.party[0].ap,282);
 // レベルなし技能は修得記録だけを保持し、Lv辞書からは除く。
 assert.deepEqual(m.skillLevels,{warrior_A02:3,warrior_A01:5});
 assert.deepEqual(m.learned,['warrior_A02','knight_A01','warrior_A01']);
 assert.deepEqual(m.loadout.actions,['warrior_A02','knight_A01']);assert.deepEqual(game.storage,gear);
 normalizeGame(data,game,run);normalizeGame(data,run.snapshot);
 assert.equal(m.ap,282);assert.equal(run.snapshot.party[0].ap,282);
 assert.throws(()=>upgradeSkill(data,m,'knight_A01'));
 assert.doesNotMatch(prerequisiteText(data,m,data.skills.get('knight_A08')),/Lv/);
});
