// 正本から閲覧用一覧を更新する。能力・技の数値は書き換えない。
import fs from 'node:fs';
import {realGameData} from '../game/tests/helpers.js';
const data=realGameData({world:true});
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

39種すべてをA〜Mへ配置済み。季節限定種は該当季節だけ出現する。配置欄はダンジョンの記号。詳しい出現比率・単独出現は[配置一覧](region1-encounters.md)を参照。

| Lv | 名前 | 種族 | 役割 | 登録季節 | 配置 |
| ---: | --- | --- | --- | --- | --- |
${monsters.map(m=>`| ${m.fixedStats.level} | ${m.name} | ${m.types.map(t=>data.monsterTypes.get(t).name).join('・')} | ${m.skillProfile.role} | ${seasons[m.season]??m.season} | ${data.worldRoutes.nodes.filter(n=>n.pool.includes(m.id)||n.bossId===m.id).map(n=>n.key).join('・')} |`).join('\n')}

## 技の設定

倍率は通常攻撃の基準に対する値。状態異常率は耐性計算前。エリートも同じ技を使う。

| 名前 | 通常攻撃 | 特技（MP／効果） |
| --- | --- | --- |
${monsters.map(m=>`| ${m.name} | ${m.skillProfile.skills.find(s=>s.basic).name} | ${m.skillProfile.skills.filter(s=>!s.basic).map(s=>`${s.name}（${s.mp}／${skillDescription(s)}）`).join('、')} |`).join('\n')}

行動規則は[モンスターの技](specs/monster-skills.md)、能力の数値は[固定能力一覧](monster-stats-region1.md)。正本は[monster_skills.json](../data/monster_skills.json)と[monsters.csv](../data/monsters.csv)。
`);
write('monster-stats-region1.md',`# 地域1：固定モンスター能力（暫定）

2026-11-28。[仕様](specs/fixed-monsters.md)。地域1に配置した39種の通常個体の値。同じ敵はどこでも同じLv・能力となる。エリートは同名・同Lvで別途能力補正。配置は[出現一覧](region1-encounters.md)、数値は暫定。

| 名前 | ID | 固定Lv | HP | MP | 攻撃 | 魔力 | 防御 | 魔防 | 素早さ | エリート |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
${monsters.map(m=>`| ${m.name} | ${m.id} | ${['level','hp','mp','str','mag','def','res','spd'].map(k=>m.fixedStats[k]).join(' | ')} | ${m.eliteEligible?'対象':'—'} |`).join('\n')}

全1024種の正本：[monster_stats.csv](../data/monster_stats.csv)。上記以外の985種は既存設定から作成した暫定値。種族・技・配置状況は[行動一覧](monster-actions-region1.md)。
`);
const file=new URL('../docs/specs/fixed-monsters.md',import.meta.url);
let text=fs.readFileSync(file,'utf8');
text=text.replace('属性・耐性・技・素材などは従来のモンスターマスターを使用する。','属性・耐性・素材は従来のモンスターマスターを使用する。地域1の技は [monster_skills.json](../../data/monster_skills.json) で管理する。');
text=text.replace('地域1の15種は個別に暫定Lvを置いた。残る1009種','地域1の配置中15種と追加候補24種、計39種は個別に暫定Lvを置いた。残る985種');
text=text.replace(/\| 固定Lv \| 地域1の敵[^|\n]*\|[\s\S]*?\n\n正確な/,
 '| 固定Lv | 地域1の敵（配置済み） |\n| ---: | --- |\n'+
 Array.from({length:12},(_,i)=>`| ${i+1} | ${monsters.filter(m=>m.fixedStats.level===i+1).map(m=>m.name+(m.isBoss?'（ボス）':'')).join('、')} |`).join('\n')+'\n\n正確な');
fs.writeFileSync(file,text);
console.log('地域1の39種の一覧を更新');

const names=ids=>ids.map(id=>{const m=data.monsters.get(id);return `${m.name}Lv${m.fixedStats.level}`;}).join('、')||'—';
write('region1-encounters.md',`# 地域1の出現配置

2026-11-28。39種すべてに出現場所を割り当てる。正本は[world_routes.json](../data/world_routes.json)。敵Lv・能力・技は固定で、ダンジョンLvによる個体の強化はしない。すべて3戦、通常1〜2体、G・Kの3戦目はボス1体。

| 地点 | 通年の通常敵 | 季節の追加敵 | 最終戦ボス |
| --- | --- | --- | --- |
${data.worldRoutes.nodes.map(n=>`| ${n.key} ${n.name} | ${names(n.pool.filter(id=>data.monsters.get(id).season==='all'))} | ${n.pool.filter(id=>data.monsters.get(id).season!=='all').map(id=>`${seasons[data.monsters.get(id).season]}：${names([id])}`).join('、')||'—'} | ${names([n.bossId].filter(Boolean))} |`).join('\n')}

## 配置の意図

- AはLv1〜2を中心に最も入りやすくする。Eは毒・魔法、Hは妖精や季節の虫・小動物、MはLv3〜5の獣・人型で出発先の違いを作る。
- B・D・I・Lは次の行き先に備える中間地点。Cはアンデッドと状態異常、Fは水・土と毒、Gは硬い敵、Jは魔法、Kは速い獣・鳥と風魔法を中心にする。
- B→C、E→F、I→J、D→G、F→Kなどで強さの差を残す。Lv帯は重なりを許し、ダンジョンLv＝敵Lvにはしない。勝率や消耗の最終調整は実戦テストで続ける。
- 春のJへの出口制限と到達済みワールドストーンへの恒久ワープは維持する。季節は遠征開始後の日付を使い、連続攻略中は変わらない。

## 抽選と編成

各候補の重みで1体目を抽選する。季節外の候補を除き、残った重みの合計で割る。例えばAのスライムは春55/100、夏55/85。数値を固定確率と混同しない。

| 地点 | 出現の重み（名前：値） | 単独出現限定 |
| --- | --- | --- |
${data.worldRoutes.nodes.map(n=>`| ${n.key} | ${n.pool.map(id=>data.monsters.get(id).name+'：'+n.weights[id]).join('、')} | ${names(n.soloMonsters)} |`).join('\n')}

敵数は1／2体を等確率で抽選。ただし単独限定種が1体目なら1体で終える。2体目の候補から単独限定種を除く。回復技を持つ敵は1戦に1体までとし、回復役同士の長期戦を避ける。2体目は残った候補の重みで再抽選する。固定の出現順序は設けない。

Lv11〜12の通常敵は低い重みで単独出現。ボスはGの石の巨人Lv10、Kの嵐の大鷲Lv12を維持する。エリート対象4種・出現率・遠征上限・レアドロップ補正は既存設定を使う。

## 報酬と保存

今回採用した39種の経験値・APをすべて固定値で参照できるようにする。従来空欄だった5種だけを近いLvの既存種に合わせ、ワーグの仔19EXP/1AP、紙の兵隊38/2、動く魔導書41/2、見習い魔術師41/2、知恵のフクロウ43/3とする。報酬が空欄の敵を含むことで戦闘全体が旧計算へ戻る問題を防ぐ。

敵の素材とドロップ先は既存マスターを使用。ゴールド・装備抽選は既存のダンジョン別設定を使用する。進行中の戦闘は保存済みの敵を維持し、次の戦闘から新しい出現候補で抽選する。

## 検証

- 自動テスト798件成功。新しい配置の通常戦35,400回の抽選で、全39種の遭遇先、季節制限、出現比率、単独出現、回復役上限、固定報酬の適用を確認。
- Chromeで320／390／1000pxを確認。4入口・クリア後の3択・未選択の行先非表示・継続移動・保存再開・ワールドストーン解放が動作し、ブラウザ例外なし。
- 検証コードは game/tests/region1-encounters.test.js と scripts/verify-world-journey.cjs。抽選・進行の検証であり、連続攻略時の勝率・消耗の最終調整ではない。
`);
