# English Quest 仕様索引

このディレクトリの文書は、**設計方針**と**現行mainの実装**を区別して読む。E〜Sランク表・依頼ポイント・5施設のLv1〜11投資・英語試験・旧セーブ移行・神殿Lv2〜9の追加36職解放は実装済み。町の倉庫施設と容量制限は廃止。C以降の正式な昇格素材、伝説6職、世界の全地域公開は今後の開発項目。

## 現行の正本

| 領域 | 参照先 |
| --- | --- |
| 冒険者ランク、昇級 | [E〜Sの現行仕様](rank-promotion.md) |
| 施設投資・神殿の職解放 | [5施設・11段階](town-facilities-11.md) |
| 世界地図・連続攻略（現行） | [ワールドストーンと連続攻略](world-journey.md)。A〜M各3戦、踏破後3択 |
| モンスターの強さ・エリート | [固定Lv・固定能力と同名エリート](fixed-monsters.md)。1024種の固定能力、レア素材・装備の優遇 |
| 旧入門ルート（途中セーブ互換） | [風渡りの原と初回進行](intro-route.md) |
| 旧★3の公開・D+素材経路（履歴） | [風鳴りの峡谷](howling-canyon-public.md) |
| 以前の5ダンジョン先行版（履歴） | [旧公開条件](trial-five-dungeons.md) |
| 教材の中身 | [教材基本版v1.0](../../data/learning/v1/README.md) |
| 職業・技能 | [50職の設計基準v2](../jobs-baseline-v2.md)。基本8職・追加36職の44職が実装済み。各追加職の実装記録は `docs/additional-jobs-*-implementation.md`、伝説6職は技能未実装 |
| 装備の★・レアリティ・強化値（実装） | [装備・素材・制作](equipment-crafting.md)。装備Lvの表示・計算と製作品質+15%を廃止 |
| データ数値と実際の処理 | `data/` と `game/js/`。設計との差分がある間は「実装済み」と読み替えない |

## 関連設計・履歴

[学習施設](learning-rank.md) · [世界・ダンジョン](world-dungeon.md) · [依頼と経済](quests-economy.md) · [装備と制作](equipment-crafting.md) · [戦闘・ジョブの旧整理](game-system.md) · [エンドゲーム](endgame.md) · [未解決事項](OPEN-ISSUES.md)

`docs/game-overview.md` と `docs/checklist.md` は旧時点の履歴資料。旧Rランク、旧教材数、月会費、旧職業・技能、旧12段階施設、ランクによるダンジョン入場条件は新仕様の根拠にしない。昇格素材の正式化、世界の拡張、伝説職は[未解決事項](OPEN-ISSUES.md)を参照。

更新：2026-11-28。
