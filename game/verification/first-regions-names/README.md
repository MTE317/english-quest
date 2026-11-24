# 苔むした洞窟・木漏れ日の森の表示名整理

基準main: `a61b6ab78111b6ef528939602bbcc357f42817bf`（#64）。#63は既にmainへマージ済み。独立ブランチで作業し、並行する#47/#52や既存作業ツリーを変更していない。

## 方針と範囲

実在動物をそのまま名にしたものや機械的な地域接頭辞を、短い幻想種族名・造語へ置き換えた。ゴブリン等の定番名は維持。種別、属性、状態付与、絵文字は変更せず、植物は植物、精霊は精霊として読める名を選んだ。ウィスプ2種は結晶／葉の違い、ドリームピクシーとソムニルは既存の睡眠、ワーグの仔は既存の小型獣という特徴を残す。新たな設定や能力を追加する改名ではない。

対象の出現元はmonsters.csvのdungeons/role/season/replaces、dungeons.csvのboss_id、dungeon_floors.csv、quests.csv、arena_battles.csvを照合。本体のmonsterPool/encounterWeights/makeEncounter/questTextで検証した。地域討伐は地域名、ボス・賞金首と旧個別討伐はIDから現在名を表示するため、quests.csvやコードの変更は不要。

対象44体のうち19体を改名し25体を据え置く。対象外地域または闘技場と共有する個体は例外なく据え置き。候補「グラヴォル」の元となる苔影岩食い鼠は闘技場arena_01にも登場するため今回は採用しない。「フォーン」「岩窟のグラム」は専用個体として採用した。

## 変更一覧

| ID | 変更前 | 変更後 |
|---|---|---|
| `cave_rat` | 洞窟ネズミ | ラットル |
| `goblin_boss` | ゴブリン親分 | 岩窟のグラム |
| `wolf_pup` | 森オオカミの仔 | ワーグの仔 |
| `nut_squirrel` | 木の実リス | スクル |
| `grove_guardian` | 大樹の守り手 | 大樹のエルダ |
| `bounty_01_1` | 血塗れの槍兵 | 血槍のヴァルド |
| `bounty_01_2` | 鉄牙の大蜘蛛 | 鉄牙のアラネア |
| `exp_mossy_cave_5` | 苔影結晶の精 | クリスタルウィスプ |
| `exp_mossy_cave_6` | 苔影胞子茸 | スポアリング |
| `exp_mossy_cave_7` | 苔影石殻人形 | ストーンゴーレム |
| `exp_mossy_cave_8` | 苔影夜翼蝙蝠 | ノクティル |
| `exp_sunlit_forest_1` | 陽森森の小鹿 | フォーン |
| `exp_sunlit_forest_2` | 陽森葉擦れの精 | リーフウィスプ |
| `exp_sunlit_forest_3` | 陽森蔦の守人 | ヴァインウォーカー |
| `exp_sunlit_forest_4` | 陽森木霊妖精 | ドリームピクシー |
| `exp_sunlit_forest_5` | 陽森樹皮巨人 | バークジャイアント |
| `exp_sunlit_forest_6` | 陽森蜜吸い蜂 | メリル |
| `exp_sunlit_forest_7` | 陽森森影狼 | ソムニル |
| `exp_sunlit_forest_8` | 陽森芽吹き樹人 | スプラウト |

## 共有敵の据え置き

全13季節個体も他地域と共有するためそのまま。洞窟コウモリ・雪ウサギ等の動物名や一部の機械的接頭辞はこの制約により残る。

| ID | 名前 | 対象外の出現元 |
|---|---|---|
| `slime` | スライム | twisted_tunnel, blooming_hill, 闘技場 arena_01 |
| `goblin` | ゴブリン | goblin_quarry |
| `cave_bat` | 洞窟コウモリ | blooming_hill |
| `pollen_bug` | 花粉ムシ | twisted_tunnel, goblin_quarry, blooming_hill |
| `glowmoss_sprite` | ヒカリゴケの精 | twisted_tunnel, goblin_quarry, blooming_hill |
| `mushroom_soldier` | キノコ兵 | twisted_tunnel, goblin_quarry, blooming_hill |
| `snow_hare` | 雪ウサギ | twisted_tunnel, goblin_quarry, blooming_hill |
| `poison_cap` | 毒キノコ | 闘技場 arena_01 |
| `prank_pixie` | いたずら妖精 | goblin_quarry |
| `m01_001` | 大蜘蛛 | twisted_tunnel, goblin_quarry, blooming_hill, 闘技場 arena_01 |
| `m01_003` | まだらのいたずら妖精 | blooming_hill, twisted_tunnel |
| `m01_007` | 毒蜂 | twisted_tunnel |
| `exp_mossy_cave_1` | 苔影苔玉 | 闘技場 arena_01 |
| `exp_mossy_cave_2` | 苔影岩食い鼠 | 闘技場 arena_01 |
| `exp_mossy_cave_3` | 苔影穴堀り小鬼 | 闘技場 arena_01 |
| `exp_mossy_cave_4` | 苔影地底甲虫 | 闘技場 arena_01 |
| `exp_season_01_spring_1` | 若木の芽吹きの妖精 | twisted_tunnel |
| `exp_season_01_spring_2` | 若木の花冠の獣 | goblin_quarry |
| `exp_season_01_summer_2` | 若木の雷鳴の鳥 | goblin_quarry |
| `exp_season_01_summer_3` | 若木の炎舞の精霊 | blooming_hill |
| `exp_season_01_autumn_1` | 若木の紅葉の樹人 | blooming_hill |
| `exp_season_01_autumn_2` | 若木の黄昏の亡霊 | twisted_tunnel |
| `exp_season_01_autumn_3` | 若木の実りの妖精 | goblin_quarry |
| `exp_season_01_winter_1` | 若木の霜刃の剣士 | goblin_quarry |
| `exp_season_01_winter_3` | 若木の雪光の霊獣 | goblin_quarry |

## 明示参照の整合

素材・固有装備の名前だけ変更。汎用素材名（毛皮、どんぐり等）や地域素材名（苔影の秘晶等）は維持。素材は他の敵も落とすがドロップIDは変更せず、改名対象の旧名を明示するものだけ整合させた。工房・倉庫等で同じ素材を表示すると新名になるのはこの整合の範囲である。

| データ | ID | 変更前 | 変更後 |
|---|---|---|---|
| materials | `cave_rat_rare` | ネズミの前歯 | ラットルの前歯 |
| materials | `goblin_boss_mat` | 親分のバンダナ | グラムのバンダナ |
| materials | `goblin_boss_rare` | 親分の金貨袋 | グラムの金貨袋 |
| materials | `bounty_01_1_mat` | 血塗れの槍兵の布切れ | 血槍のヴァルドの布切れ |
| materials | `bounty_01_1_rare` | 血塗れの槍兵の紋章 | 血槍のヴァルドの紋章 |
| materials | `bounty_01_2_mat` | 鉄牙の大蜘蛛の殻 | 鉄牙のアラネアの殻 |
| materials | `bounty_01_2_rare` | 鉄牙の大蜘蛛の毒腺 | 鉄牙のアラネアの毒腺 |
| uniques | `u_goblin_boss` | ゴブリン親分の拳 | 岩窟のグラムの拳 |
| uniques | `u_grove_guardian` | 大樹の守り手の楽器 | 大樹のエルダの楽器 |
| uniques | `u_bounty_01_1` | 血塗れの槍兵の革の帽子 | 血槍のヴァルドの革の帽子 |
| uniques | `u_bounty_01_2` | 鉄牙の大蜘蛛の革鎧 | 鉄牙のアラネアの革鎧 |

## 検証と再現

- `cd game && npm test`: 全331テスト成功、fail/skip 0。
- `node game/verification/first-regions-names/verify.mjs a61b6ab`: 正式ロード対象データを基準と比較し、承認一覧のname列以外が完全一致。ID・種別・強さ・状態・出現・ドロップ・素材数・レシピ・セーブ形式に変更なし。モンスター1,024体を維持。新名19件は既存名と重複なし。
- 全60ダンジョン×4季節の240出現候補・重みが一致。通常／ボス、賞金首あり／なし、seed 1〜10の4,800遭遇でname以外が一致。改名対象が他地域・闘技場と共有しないこと、全19件の討伐・ボス・賞金首文言がIDから新名を取得することも検証。
- `python -m http.server 8766 --bind 127.0.0.1`で配信し、別ターミナルから`node game/verification/first-regions-names/browser-smoke.cjs`。PlaywrightとChromiumが必要（リポジトリに依存追加なし）。390×844の隔離context・合成セーブを使用。ボス依頼1件、賞金首依頼2件の表示を確認。図鑑画面は既存の構文エラーにより未検証（下記）。実セーブは参照・操作しない。
- ゲームJS・HTML・CSS・教材は変更なし。名前だけのためダメージ・勝率計測は再実施していない。全出現候補の一致と同seed遭遇比較を代わりに使用。

ブラウザー確認は新しいデータを読み込んだローカル環境であり、公開先の配信キャッシュや既存ブラウザーの更新時期は未検証。命名評価は対象2地域の限定試行であり、共有個体の一括改名や全地域の命名統一はこのPRの範囲外。

## 図鑑画面の既存ブロッカー

最新mainの`game/js/pages/records-page.js:51`で`Identifier 'catalog' has already been declared`が発生する。loadLearningCatalogの結果を受け取るconst名と図鑑を描くfunction名が重複しており、ブラウザーと`node --check`の双方で再現。`git show a61b6ab:game/js/pages/records-page.js`でも同一の構文エラーを確認した。全331テストはこのページの構文を検査していない。

このPRでは修正しない。既存の別作業ツリーで図鑑改修中のため重複も避けた。図鑑の描画コードが`data.monsters`の現在名をIDから参照することは確認したが、実画面での新名表示は未検証。browser-smokeはこの既知エラーを記録してから独立した依頼画面へ進む診断用スクリプトで、図鑑成功を意味しない。

CSVのBOM・元の改行形式を維持。`git -c core.whitespace=cr-at-eol diff --check`で検査（既存CRLFを末尾空白と扱わない）。
