# English Quest 学習教材・基本版 v1.0

2026-11-24 に提供された `english_quest_learning_v1_0_basic_package` の正本CSVを読み込む。ここでは教材データと関連付けを管理し、ゲーム機能・報酬・学習履歴と分離する。

| ファイル | 件数 | 内容 |
| --- | ---: | --- |
| `words.csv` | 1,600 | 単語・熟語。`word_id` が学習ID |
| `phrases.csv` | 1,183 | 瞬間英作文。`phrase_id` が学習ID |
| `chunks.csv` | 215 | 反復練習の型。`chunk_id` で例文を検索 |
| `categories.csv` | 60 | 7メイン・60サブカテゴリー |
| `word_categories.csv` | 2,647 | 単語→メインカテゴリーの多対多関連 |
| `phrase_categories.csv` | 1,302 | フレーズ→サブカテゴリーの多対多関連 |
| `distractor_review.csv` | 74 | 同義語・4択誤答の手動検品資料（出題確定データではない） |

`00 最重要・実用英語` は他カテゴリーとも重複する**単一コレクション**。同一単語・フレーズはIDで一度だけ記録し、異なるカテゴリーから出題しても記録を共有する。`00` の主所属は800語・300文、関連付けを含むと807語・328文。教材マスターには優先度Sの300語・120文が含まれるが、ゲーム上の独立した学習セットとしては生成せず、00全体から出題する。

新しい教材範囲はここを正とする。`02_今回追加`、`03_追加単語`などのCSVはすでにマスターへ含まれるため、二重に読み込まない。

読み込みと検証は `game/js/learning-catalog.js` の `buildLearningCatalog` と `loadLearningCatalog` が担当する。`game/js/lexicon.js` は旧形式の単体テスト用ビルダーとしてのみ残す。既存の語彙90件・詠唱86件のCSVは削除済み。

**教材の収録範囲は確定だが、語義・品詞・誤答の最終検品は未完了。** `distractor_review.csv` の74項目などを基に別途レビューする。レビュー未完了のデータを学習アプリが無条件に正しいと保証しない。

原本ZIPから再生成する場合：

```bash
python scripts/import_learning_v1.py /path/to/english_quest_learning_v1_0_basic_package.zip
```

現在のゲームでは訓練場に単語・英作文・チャンク・SRS復習を統合済み。無料転職、二分野の昇格試験、学習統計を提供し、初期教材は00全体を選択する。
