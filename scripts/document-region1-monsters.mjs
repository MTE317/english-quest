// 正本から閲覧用一覧を更新する。能力・技の数値は書き換えない。
import fs from 'node:fs';
import {realGameData} from '../game/tests/helpers.js';
const data=realGameData({world:true});
const current=new Set(data.worldRoutes.nodes.flatMap(n=>[...n.pool,n.bossId]).filter(Boolean));
const monsters=[...data.monsters.values()].filter(m=>m.skillProfile).sort((a,b)=>a.fixedStats.level-b.fixedStats.level);
const seasons={all:'通年',spring:'春',summer:'夏',autumn:'秋',winter:'冬'};
const write=(name,text)=>fs.writeFileSync(new URL('../docs/'+name,import.meta.url),text);
const skillDescription=s=>s.kind==='heal'?`味方単体HP${s.rate*100}%回復`
 :s.kind==='buff'?`${{str:'攻撃',mag:'魔力',def:'防御',res:'魔防'}[s.stat]}+${s.rate*100}%`
 :`${s.sweep?'全体':'単体'}${s.magic?'魔法':'物理'}×${s.power}`
  +(s.element?'・'+data.elements.get(s.element).name:'')
  +(s.status?'・'+data.statusEffects.get(s.status).name+`${s.statusRate*100}%`:'');
write('monster-actions-region1.md',`# 地域1：種族・技・行動一覧

2026-11-28。既存15種にLv1〜12各2種を加え、計39種を設定。1024種の登録済みマスターから選定し、同名の別Lv個体は作らない。各種のLvは固定。

「配置中」は現在のA〜Mに出現。「候補」は追加24種で、出現ダンジョン・編成・確率は次段階で決める。季節欄は既存マスター上の設定であり、現在の世界経路は明示されたpoolを使う。追加候補の季節条件も配置時に適用を検討する。

| Lv | 名前 | 種族 | 役割 | 登録季節 | 配置 |
| ---: | --- | --- | --- | --- | --- |
${monsters.map(m=>`| ${m.fixedStats.level} | ${m.name} | ${m.types.map(t=>data.monsterTypes.get(t).name).join('・')} | ${m.skillProfile.role} | ${seasons[m.season]??m.season} | ${current.has(m.id)?'配置中':'候補'} |`).join('\n')}

## 技の設定

倍率は通常攻撃の基準に対する値。状態異常率は耐性計算前。エリートも同じ技を使う。

| 名前 | 通常攻撃 | 特技（MP／効果） |
| --- | --- | --- |
${monsters.map(m=>`| ${m.name} | ${m.skillProfile.skills.find(s=>s.basic).name} | ${m.skillProfile.skills.filter(s=>!s.basic).map(s=>`${s.name}（${s.mp}／${skillDescription(s)}）`).join('、')} |`).join('\n')}

行動規則は[モンスターの技](specs/monster-skills.md)、能力の数値は[固定能力一覧](monster-stats-region1.md)。正本は[monster_skills.json](../data/monster_skills.json)と[monsters.csv](../data/monsters.csv)。
`);
write('monster-stats-region1.md',`# 地域1：固定モンスター能力（暫定）

2026-11-28。[仕様](specs/fixed-monsters.md)。地域1の配置中15種と追加候補24種、計39種の通常個体の値。同じ敵はどこでも同じLv・能力となる。エリートは同名・同Lvで別途能力補正。追加候補の配置・編成・難度調整は次段階。

| 名前 | ID | 固定Lv | HP | MP | 攻撃 | 魔力 | 防御 | 魔防 | 素早さ | エリート |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
${monsters.map(m=>`| ${m.name} | ${m.id} | ${['level','hp','mp','str','mag','def','res','spd'].map(k=>m.fixedStats[k]).join(' | ')} | ${m.eliteEligible?'対象':'—'} |`).join('\n')}

全1024種の正本：[monster_stats.csv](../data/monster_stats.csv)。上記以外の985種は既存設定から作成した暫定値。種族・技・配置状況は[行動一覧](monster-actions-region1.md)。
`);
const file=new URL('../docs/specs/fixed-monsters.md',import.meta.url);
let text=fs.readFileSync(file,'utf8');
text=text.replace('属性・耐性・技・素材などは従来のモンスターマスターを使用する。','属性・耐性・素材は従来のモンスターマスターを使用する。地域1の技は [monster_skills.json](../../data/monster_skills.json) で管理する。');
text=text.replace('地域1の15種は個別に暫定Lvを置いた。残る1009種','地域1の配置中15種と追加候補24種、計39種は個別に暫定Lvを置いた。残る985種');
text=text.replace(/\| 固定Lv \| 地域1の敵 \|[\s\S]*?\n\n正確な/,
 '| 固定Lv | 地域1の敵（配置中・候補を含む） |\n| ---: | --- |\n'+
 Array.from({length:12},(_,i)=>`| ${i+1} | ${monsters.filter(m=>m.fixedStats.level===i+1).map(m=>m.name+(m.isBoss?'（ボス）':'')).join('、')} |`).join('\n')+'\n\n正確な');
fs.writeFileSync(file,text);
console.log('地域1の39種の一覧を更新');
