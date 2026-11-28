// 初回移行用。以降の調整は monster_stats.csv を正とし、再生成は明示指定する。
import fs from 'node:fs';
import { realGameData, readCsv } from '../game/tests/helpers.js';
import { makeEnemy } from '../game/js/battle.js';

const output = new URL('../data/monster_stats.csv', import.meta.url);
if (fs.existsSync(output) && !process.argv.includes('--overwrite')) throw new Error('再生成には --overwrite が必要です。地域1以外の暫定値を上書きします。');
const data = realGameData();
// 編集済みの地域1の固定能力は再生成でも保持する。
const reviewed = new Map(readCsv('monster_stats.csv').rows.filter(r=>r.review==='region1').map(r=>[r.monster_id,r]));
for (const monster of data.monsters.values()) delete monster.fixedStats;
const current = {
  slime: [1, 'windward_plain', .58], nut_squirrel: [2, 'sunlit_forest', .58],
  cave_rat: [3, 'mossy_cave', .58], wolf_pup: [4, 'sunlit_forest', .58],
  goblin: [5, 'goblin_quarry', .58], skeleton: [6, 'ruined_fort', .85],
  fort_bandit: [7, 'ruined_fort', .85], marsh_frog: [5, 'misty_marsh', .85],
  mud_slime: [6, 'misty_marsh', .85], stone_statue: [8, 'ruined_fort', .85],
  wandering_armor: [8, 'misty_marsh', .85], canyon_wolf: [9, 'howling_canyon', .85],
  wind_spirit: [10, 'howling_canyon', .85], stone_giant: [10, 'ruined_fort', .82],
  storm_eagle: [12, 'howling_canyon', .82],
};
const median = values => [...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
const rows = [];
for (const m of data.monsters.values()) {
  if (reviewed.has(m.id)) {
    const row=reviewed.get(m.id);
    rows.push(['monster_id','level','hp','mp','str','mag','def','res','spd','review'].map(k=>row[k]).join(','));
    continue;
  }
  const ownRows = data.dungeonFloors.filter(row => m.dungeons.includes(row.dungeonId)
    && data.dungeons.get(row.dungeonId)?.rank === m.rank);
  const reference = ownRows.length ? ownRows : data.dungeonFloors.filter(row => data.dungeons.get(row.dungeonId)?.rank === m.rank);
  const levels = reference.filter(row => m.isBoss ? row.lastBattleIsBoss : !row.lastBattleIsBoss).map(row=>row.enemyLevel);
  const lv = current[m.id]?.[0] ?? median(levels.length ? levels : reference.map(row=>row.enemyLevel));
  if (!Number.isInteger(lv)) throw new Error('基準Lvがない: '+m.id);
  const enemy = makeEnemy(data,m.id,{lv,dungeonId:current[m.id]?.[1],boss:m.isBoss});
  const hp = Math.round(enemy.maxHp * (current[m.id]?.[2] ?? 1));
  rows.push([m.id,lv,hp,enemy.maxMp,...['str','mag','def','res','spd'].map(k=>Math.round(enemy[k]*100)/100),
    current[m.id] ? 'region1' : 'provisional'].join(','));
}
fs.writeFileSync(output,'\uFEFFmonster_id,level,hp,mp,str,mag,def,res,spd,review\n'+rows.join('\n')+'\n');
console.log('固定能力を作成: '+rows.length+'種（地域1の編集済み能力を保持）');
