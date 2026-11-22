# English Quest 仮データ（2026-11-22 ★12版）

シミュレーションとゲームの両方が読む「正」のデータです。数値はすべて叩き台です。
上級ジョブ・特殊ダンジョン・レジェンド級の装備はここに入っていません（ネタバレ防止のため別ファイル）。

## 決まりごと

- CSV の文字コードは UTF-8（BOMつき）。JSON はBOMなし。Excelで開いても文字化けしません。コードで読むときは先頭のBOMを取り除いてください。
- 1列目は英字のID。ほかのファイルからはIDで参照します。日本語の名前は自由に変えてかまいません。
- 1つのセルに複数の値があるときは `|` で区切ります（例：`fire|slash`）。
- 素材と個数は `素材ID:個数` の形にします（例：`goblin_mat:2|cave_rat_mat:2`）。
- 適正の `×` は装備できないことを表します。空のセルは「なし」です。
- スキルの細かい効果は skills.csv の effect_json に書きます。仕様書の数値とずれたときは CSV を正とします。

## ファイル一覧

| ファイル | 中身 |
|---|---|
| balance.json | 敵の強さ・経験値・お金・全滅の扱いなどの式。レベルの上限は99 |
| targets.csv | 合格ライン13項目（シミュレーションの判定に使う） |
| elements.csv / seasons.csv | 属性12種 / 季節4つ |
| jobs.csv / jobs_mid.csv | 基本ジョブ8種・中級ジョブ6種の能力値・初期装備。change_jp＝そのジョブに転職するときに払うJP |
| job_unlocks.csv | 中級ジョブの解放条件（素材 or 奥地で発見） |
| job_weapon_aptitude.csv / job_armor_aptitude.csv / aptitude.csv | 装備の適正と倍率 |
| skills.csv | 14ジョブのスキルツリー（5段目まで。効果は effect_json） |
| common_tree.csv | 全ジョブ共通のパッシブ |
| weapon_types.csv / armor_weights.csv | 武器14種・防具の重さ |
| equipment.csv | 装備672種（24段階＝★ごとに2段階。武器14種・防具9種・マント・アクセサリー4種） |
| uniques.csv | 固有装備108（ボスと賞金首が落とす。効果は固定） |
| sets.csv / set_items.csv | セット装備20セット（4部位） |
| enchant_sources.csv | エンチャントで素材から付く効果の系統 |
| quest_chains.csv | 連続クエスト（★ごとに2つ） |
| job_mastery.csv | ジョブを極めたときの、全ジョブへのボーナス |
| affixes.csv | 装備につく追加効果 |
| type_bonus.csv | 特効（種別に+30%） |
| status_effects.csv | 状態異常21種と効き方 |
| monster_types.csv / monsters.csv | 種別18種 / モンスター384体（role：normal 180・season 96・boss 60・bounty 48）。名前は仮 |
| elite_prefixes.csv | 強い個体の冠（どのモンスターにもつく） |
| materials.csv | 素材768種 |
| dungeons.csv | ダンジョン60か所（★ごとに5つ：標準・深層・近場・素材の宝庫・季節の地）。enemy_mul＝敵の強さ、income_mul＝お金の倍率 |
| dungeon_floors.csv / drop_tables.csv | 階ごとの敵Lv・戦闘数 / ドロップ率 |
| items.csv / shop_inventory.csv | 消耗品（回復は固定量と割合の2種類。能力を上げる薬は調合のみ）/ 店の品ぞろえ |
| alchemy_recipes.csv | 調合のレシピ（素材は種別と★で指定） |
| inn_rooms.csv / facilities.csv / facility_ranks.csv / facility_effects.csv | 宿屋・町の施設 |
| enhance_rates.csv / rarities.csv / recipes.csv | 強化（費用は1.8^強化値で増える）・レアリティ・制作 |
| enchant_grades.csv | エンチャントのグレード（工房のランク）ごとの費用 |
| economy_by_rank.csv | ★ごとのお金の目安（月末に払うのはギルドの会費だけ。倉庫は無料） |
| backpack.csv | バックパックの広さの段階と、広げる費用 |
| manifest.json | data/ にあるファイル名の一覧（ゲームが読み込みに使う） |
| adventurer_ranks.csv | 冒険者ランク25段階（★ごとに本ランクと＋、最後にS）。昇格試験・特典 |
| quest_types.csv / quests.csv | クエスト |
| rune_stones.csv | ルーンストーン（単語セット）。★・テーマ・種類・大きさ |
| lexicon.csv | 単語とフレーズ。stone_id でルーンストーンに属する。kind は word / phrasal_verb / idiom / phrase |
| rune_effects.csv | 刻印にはめた石の効果の系統（★ごとの効果・共鳴・輝きのボーナス） |
| kokuin_slots.csv | 刻印の枠を神殿で増やす費用 |
| exams.csv | 覚醒の試練・昇格試験・最終試験の問題数と合格ライン |
| srs.json | 出題と復習の設定（復習優先・1回の新出語数・目標の記憶率など） |
| chant.json | 詠唱（瞬間英作文）の設定：判定○△×とJP・1日の量・転職のJPの使い方 |
| grimoires.csv / chants.csv | 詠唱の教材。魔導書（まとまり）と、その中の文（日本語→英語、別解は alt_en に `\|` 区切り）。今は仮の3文 |
| appearance_icons.csv | キャラメイクのアイコン |

## 単語について

lexicon.csv は今はプロトタイプの90語だけです（★1〜★3、仮）。最終的には単語約12,000語とフレーズ約3,000を、約500個のルーンストーンに分けます。シミュレーションでは今のところ「★が1つ上がるごとに正答率が3%下がる」として扱っています（balance.json の accuracy_drop_per_rank）。
