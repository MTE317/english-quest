# English Quest 仮データ（2026-11-22 夜間シミュレーション後）

シミュレーションとゲームの両方が読む「正」のデータです。数値はすべて叩き台です。
上級ジョブ・特殊ダンジョン・レジェンド級の装備はここに入っていません（ネタバレ防止のため別ファイル）。

## 決まりごと

- 文字コードは UTF-8（BOMつき）。Excelで開いても文字化けしません。コードで読むときは先頭のBOMを取り除いてください。
- 1列目は英字のID。ほかのファイルからはIDで参照します。日本語の名前は自由に変えてかまいません。
- 1つのセルに複数の値があるときは `|` で区切ります（例：`fire|slash`）。
- 素材と個数は `素材ID:個数` の形にします（例：`goblin_mat:2|cave_rat_mat:2`）。
- 適正の `×` は装備できないことを表します。空のセルは「なし」です。
- スキルの細かい効果は skills.csv の effect_json に書きます。仕様書の数値とずれたときは CSV を正とします。

## ファイル一覧

| ファイル | 中身 |
|---|---|
| balance.json | 敵の強さ・経験値・お金・全滅の扱いなどの式 |
| targets.csv | 合格ライン13項目（シミュレーションの判定に使う） |
| elements.csv / seasons.csv | 属性12種 / 季節4つ |
| jobs.csv / jobs_mid.csv | 基本ジョブ8種・中級ジョブ6種の能力値・初期装備 |
| job_unlocks.csv | 中級ジョブの解放条件（素材 or 奥地で発見） |
| job_weapon_aptitude.csv / job_armor_aptitude.csv / aptitude.csv | 装備の適正と倍率 |
| skills.csv | 14ジョブのスキルツリー（効果は effect_json） |
| common_tree.csv | 全ジョブ共通のパッシブ |
| weapon_types.csv / armor_weights.csv | 武器14種・防具の重さ |
| equipment.csv | 装備140種（武器14種×5段階・防具・マント・アクセサリ） |
| affixes.csv | 装備につく追加効果 |
| type_bonus.csv | 特効（種別に+30%） |
| status_effects.csv | 状態異常21種と効き方 |
| monster_types.csv / monsters.csv | 種別18種 / モンスター70体（季節の入れ替え・ボスを含む） |
| materials.csv | 素材140種 |
| dungeons.csv | ダンジョン10か所（★ごとに2つ）。enemy_mul＝敵の強さ、income_mul＝お金の倍率 |
| dungeon_floors.csv / drop_tables.csv | 階ごとの敵Lv・戦闘数 / ドロップ率 |
| items.csv / shop_inventory.csv | 消耗品 / 店の品ぞろえ |
| inn_rooms.csv / facilities.csv / facility_ranks.csv / facility_effects.csv | 宿屋・町の施設 |
| enhance_rates.csv / rarities.csv / recipes.csv | 強化・レアリティ・制作 |
| economy_by_rank.csv | ★ごとのお金の目安 |
| adventurer_ranks.csv | 冒険者ランク11段階・必要ポイント・特典（quest_bonus / shop_discount / perk） |
| quest_types.csv / quests.csv | クエスト |
| rune_stones.csv | ルーンストーン（単語セット）。★・テーマ・種類・大きさ |
| lexicon.csv | 単語とフレーズ。stone_id でルーンストーンに属する。kind は word / phrasal_verb / idiom / phrase |
| rune_effects.csv | 刻印にはめた石の効果の系統（★ごとの効果・共鳴・輝きのボーナス） |
| kokuin_slots.csv | 刻印の枠を神殿で増やす費用 |
| exams.csv | 覚醒の試練・昇格試験・最終試験の問題数と合格ライン |
| srs.json | 出題と復習の設定（復習優先・1回の新出語数・目標の記憶率など） |
| appearance_icons.csv | キャラメイクのアイコン |

## 単語について

lexicon.csv は今はプロトタイプの90語だけです（★1〜★3、仮）。最終的には単語約12,000語とフレーズ約3,000を、約500個のルーンストーンに分けます。シミュレーションでは今のところ「★が1つ上がるごとに正答率が3%下がる」として扱っています（balance.json の accuracy_drop_per_rank）。
