import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../game/js/csv.js';

// 職名・役割・S/A武器・属性・技能の方向性は設計基準表を正とする。
// 能力適性の具体値は既存基本職を土台にした調整用の初期配分。
const root = fileURLToPath(new URL('../', import.meta.url));
const read = (name) => readFileSync(`${root}${name}`, 'utf8');
const writeCsv = (name, header, rows) => {
  const cell = (value) => /[",\n\r]/.test(String(value ?? ''))
    ? `"${String(value ?? '').replaceAll('"', '""')}"` : String(value ?? '');
  writeFileSync(`${root}data/${name}`, '\ufeff' + [header, ...rows.map(row => header.map(key => row[key] ?? ''))]
    .map(row => row.map(cell).join(',')).join('\n') + '\n');
};
const baseline = read('docs/jobs-baseline-v1.md').split('\n').filter(line => /^\| \d+ \|/.test(line))
  .map(line => line.split('|').slice(1, -1).map(cell => cell.trim()));
const ids = [
  'warrior','knight','monk','thief','hunter','black_mage','white_mage','bard',
  'paladin','dark_knight','berserker','samurai','gladiator','warrior_monk','ascetic','executioner',
  'ninja','assassin','bounty_hunter','dragoon','gunner','pirate','spellblade','elementalist',
  'witch','hexer','necromancer','onmyoji','shrine_maiden','summoner','druid','astrologer',
  'beastmaster','puppeteer','dancer','strategist','jester','gambler','apothecary','alchemist',
  'machinist','merchant','cook','archaeologist','hero','demon_lord','sword_saint','sage','saint','overlord',
];
if (baseline.length !== 50 || ids.length !== 50) throw new Error('設計基準表は50職必要');
const weapons = { 剣:'sword',大剣:'greatsword',刀:'katana',短剣:'dagger',斧:'axe',槍:'spear',弓:'bow',鎚:'hammer',拳:'fist',杖:'staff',魔導書:'tome',楽器:'instrument',銃:'gun',鞭:'whip',鎌:'scythe',扇:'fan' };
const elements = { 斬撃:'slash',刺突:'pierce',打撃:'blunt',無:'none',炎:'fire',氷:'ice',風:'wind',土:'earth',雷:'thunder',水:'water',光:'light',闇:'dark' };
const split = (text, table) => text === '―' ? [] : text.split('・').map(key => {
  if (!table[key]) throw new Error(`設計基準表の未知の値: ${key}`);
  return table[key];
});
const gradeKeys = ['hp','mp','str','mag','def','res','spd','luk'];
const profiles = {
  warrior:'B C A D B D B C', knight:'A C C D A B D C', monk:'A C A D C D B C',
  thief:'C C B D C D A A', hunter:'B C A D B C C C', black_mage:'C A D A D A B C',
  white_mage:'C A D A C A C B', bard:'C A D B D B A B',
  paladin:'A B B C A A D C', dark_knight:'A C A C B C D C', berserker:'A D A D C D B C',
  samurai:'B C A D B C B B', gladiator:'B C A D A C C B', warrior_monk:'B B A C B A C D',
  ascetic:'A C A D C A B D', executioner:'B C A D B D C A', ninja:'C B B B D C A B',
  assassin:'C C A D D C A A', bounty_hunter:'B C A D B C B B', dragoon:'A C A D B C B D',
  gunner:'B C B D B C A A', pirate:'A C A D B D B B', spellblade:'B B A B C C B C',
  elementalist:'C A D A C A B C', witch:'C A D A D B B A', hexer:'C A D A D A B B',
  necromancer:'C A D A D A C B', onmyoji:'C A D A C A C B', shrine_maiden:'C A D B C A B B',
  summoner:'C A D A D A C B', druid:'B A D A C A C C', astrologer:'C A D A D A B B',
  beastmaster:'A C A D B C B C', puppeteer:'C A D A A B C C', dancer:'C B C B D B A B',
  strategist:'B B C C B B A C', jester:'C B C B D C A A', gambler:'C C B C C C A A',
  apothecary:'B B C C B B A C', alchemist:'C A D A C B B B', machinist:'B C A C B C C B',
  merchant:'B B C C B B B A', cook:'A A C C B B D C', archaeologist:'B B C A C B C B',
  hero:'A B A B B B B C', demon_lord:'A A B A C B D C', sword_saint:'B C A D B B A A',
  sage:'C A D A C A B C', saint:'B A D A C A C B', overlord:'A C A C B B B C',
};
const armorProfiles = {
  warrior:['S','A','C'], knight:['S','A','C'], monk:['D','S','A'], thief:['D','S','A'],
  hunter:['C','S','A'], black_mage:['D','C','S'], white_mage:['D','B','S'], bard:['D','B','S'],
  paladin:['S','A','C'], dark_knight:['S','A','C'], berserker:['A','S','D'], samurai:['B','S','C'],
  gladiator:['A','S','C'], warrior_monk:['B','S','A'], ascetic:['D','S','A'], executioner:['A','S','C'],
  ninja:['D','S','A'], assassin:['D','S','A'], bounty_hunter:['C','S','A'], dragoon:['A','S','C'],
  gunner:['C','S','A'], pirate:['B','S','C'], spellblade:['A','S','B'], elementalist:['D','B','S'],
  witch:['D','C','S'], hexer:['D','B','S'], necromancer:['D','B','S'], onmyoji:['D','B','S'],
  shrine_maiden:['D','B','S'], summoner:['D','B','S'], druid:['D','A','S'], astrologer:['D','B','S'],
  beastmaster:['C','S','A'], puppeteer:['D','B','S'], dancer:['D','A','S'], strategist:['C','S','A'],
  jester:['D','A','S'], gambler:['D','S','A'], apothecary:['B','S','A'], alchemist:['D','A','S'],
  machinist:['A','S','C'], merchant:['C','S','A'], cook:['B','S','A'], archaeologist:['C','S','A'],
  hero:['A','S','B'], demon_lord:['A','S','B'], sword_saint:['B','S','A'], sage:['D','A','S'],
  saint:['D','A','S'], overlord:['S','A','C'],
};
const magical = new Set(['staff','tome','instrument','fan']);
const oldApt = new Map(parseCsv(read('data/job_weapon_aptitude.csv')).rows.map(row => [row.job_id,row]));
const implemented = new Set(parseCsv(read('data/skills.csv')).rows.filter(row=>JSON.parse(row.effect_json||'{}').master).map(row=>row.job));
const previousUnlocks = new Map(parseCsv(read('data/job_unlocks.csv')).rows.map(row=>[row.job_id,row]));
const rows = baseline.map((row, index) => {
  const [, section, name, role, s, a, main, support, reference, style, ultimate] = row;
  const id = ids[index];
  const tier = section === '基本職' ? 'base' : section === '伝説' ? 'legendary' : 'additional';
  const sWeapons = split(s,weapons), aWeapons = split(a,weapons);
  const grades = Object.fromEntries(gradeKeys.map((key,i) => [key,profiles[id].split(' ')[i]]));
  return { id,name,role,tier,...grades,main_elements:split(main,elements).join('|'),support_elements:split(support,elements).join('|'),
    s_weapons:sWeapons.join('|'),a_weapons:aWeapons.join('|'),stat_reference:reference,style,ultimate_concept:ultimate,
    skills_ready:tier === 'base' || implemented.has(id) ? 1 : 0,weakness:'',start_weapon:sWeapons[0],
    start_armor_weight:['heavy','medium','light'][armorProfiles[id].indexOf('S')],
    unlock:tier === 'base' ? '' : implemented.has(id) ? '初期解放（条件は後日設定）' : '個別技能の実装待ち',dmg_mul:1.0 };
});
const header = ['id','name','role','tier',...gradeKeys,'main_elements','support_elements','s_weapons','a_weapons','stat_reference','style','ultimate_concept','skills_ready','weakness','start_weapon','start_armor_weight','unlock','dmg_mul'];
writeCsv('jobs.csv',header,rows.filter(row=>row.tier==='base'));
writeCsv('jobs_mid.csv',header,rows.filter(row=>row.tier==='additional'));
writeCsv('jobs_advanced.csv',header,rows.filter(row=>row.tier==='legendary'));
writeCsv('job_weapon_aptitude.csv',['job_id',...Object.values(weapons)],rows.map(row=>({job_id:row.id,...Object.fromEntries(Object.values(weapons).map(weapon=>{
  const s=row.s_weapons.split('|'),a=row.a_weapons.split('|');
  if(s.includes(weapon))return [weapon,'S'];
  if(a.includes(weapon))return [weapon,'A'];
  const old=oldApt.get(row.id)?.[weapon];
  const fallback=magical.has(row.start_weapon) ? (magical.has(weapon)?'C':'D') : (magical.has(weapon)?'D':'C');
  return [weapon,old && old!=='×' ? (['S','A'].includes(old)?'B':old) : fallback];
}))})));
writeCsv('job_armor_aptitude.csv',['job_id','heavy','medium','light'],rows.map(row=>({job_id:row.id,...Object.fromEntries(['heavy','medium','light'].map((weight,i)=>[weight,armorProfiles[row.id][i]]))})));
writeCsv('aptitude.csv',['grade','multiplier'],[{grade:'S',multiplier:1.2},{grade:'A',multiplier:1.0},{grade:'B',multiplier:0.85},{grade:'C',multiplier:0.7},{grade:'D',multiplier:0.55}]);
// 個別実装した職の初期解放を保持し、未実装の職はカタログのみに残す。
writeCsv('job_unlocks.csv',['job_id','method','materials','discover_dungeon','discover_chance_after_boss','discover_guarantee_clears','report_enemy_status'],rows.filter(row=>row.tier!=='base').map(row=>
  implemented.has(row.id) ? previousUnlocks.get(row.id)??{job_id:row.id,method:'初期',discover_chance_after_boss:0}
    : {job_id:row.id,method:'実装待ち',discover_chance_after_boss:0}));
// 修得完了の記録は残せるが、装備枠外の恒常能力ボーナスはない。
writeCsv('job_mastery.csv',['job','condition','bonus_all_jobs'],rows.filter(row=>row.skills_ready).map(row=>({job:row.id,condition:'この職の15種類の技能を修得（強化回数は種類数に含めない）',bonus_all_jobs:''})));
const weaponTypes = parseCsv(read('data/weapon_types.csv'));
const instrument = weaponTypes.rows.find(row=>row.id==='instrument');
instrument.elements = 'none';
instrument.feature = 'MAG依存の無属性通常攻撃。歌の強化は修得・装備した技能で行う';
instrument.traits_json = '{}';
writeCsv('weapon_types.csv',weaponTypes.header,weaponTypes.rows);
console.log(`職業マスター生成: 基本${rows.filter(r=>r.tier==='base').length}/追加${rows.filter(r=>r.tier==='additional').length}/伝説${rows.filter(r=>r.tier==='legendary').length}`);
