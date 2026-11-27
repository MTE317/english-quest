# English Quest 仕様索引

このディレクトリの文書は、**設計方針**と**現行mainの実装**を区別して読む。E〜Sランク表・依頼ポイント・6施設への投資・英語試験・旧セーブ移行は実装済み。正式な昇格素材、神殿の職業解放、倉庫容量などの未実装項目は各正本で確認する。

## 現行の正本

| 領域 | 参照先 |
| --- | --- |
| 冒険者ランク、昇級、施設解放 | [ランク・昇級設計](rank-promotion.md)。施設Lv1〜12の解放内容は仮案。旧ランク表・試験表より優先 |
| 入門ルート（実装PR・旧依頼の特殊移行は対象外） | [風渡りの原と初回進行](intro-route.md) |
| ★3の公開・D+素材経路 | [風鳴りの峡谷](howling-canyon-public.md) |
| 従来5ダンジョンの公開・入場 | [5ダンジョン先行版](trial-five-dungeons.md) |
| 教材の中身 | [教材基本版v1.0](../../data/learning/v1/README.md) |
| 職業・技能 | [50職の設計基準v2](../jobs-baseline-v2.md)、[基本8職の技能v2](../basic-jobs-skills-v2.md)、追加10〜18職の[135技能の設計](../additional-jobs-10-18-skills-v1.md)。追加10〜12の[実装](../additional-jobs-10-12-implementation.md)、追加13〜15の[実装](../additional-jobs-13-15-implementation.md)、追加16〜18の[実装](../additional-jobs-16-18-implementation.md)を参照 |
| 装備の★・レアリティ・強化値（実装） | [装備・素材・制作](equipment-crafting.md)。装備Lvの表示・計算と製作品質+15%を廃止 |
| データ数値と実際の処理 | `data/` と `game/js/`。設計との差分がある間は「実装済み」と読み替えない |

## 関連設計・履歴

[学習施設](learning-rank.md) · [世界・ダンジョン](world-dungeon.md) · [依頼と経済](quests-economy.md) · [装備と制作](equipment-crafting.md) · [戦闘・ジョブの旧整理](game-system.md) · [エンドゲーム](endgame.md) · [未解決事項](OPEN-ISSUES.md)

`docs/game-overview.md` と `docs/checklist.md` は旧時点の履歴資料。旧Rランク、旧教材数、月会費、旧職業・技能、ランクによるダンジョン入場条件は新仕様の根拠にしない。英語試験の現行仕様はランク・昇級設計を参照する。D以外の正式な昇格素材、神殿の職業解放、倉庫容量の実装は別途進める。

更新：2026-11-27。
