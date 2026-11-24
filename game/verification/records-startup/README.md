# 記録ページの起動エラー修正

基準main: `8f2df78ca8cf903e88ea729eda2f260cc7741d93`（#66マージ済み）。依頼時の基準27afd60と同じcatalog重複宣言が残っていた。作業開始時の開いているPRはなし。既存の別作業ツリーには図鑑の大きな改修が未コミットで残っているが、取り込み・書き換えをせず独立ブランチで修正した。

## 最小修正

`records-page.js`の教材変数だけを`learningCatalog`へ変更し、`learningStatistics`に渡す。図鑑を描画する既存の`catalog()`、ゲーム側の`game.catalog`、タブIDは維持。`records.html`の入口モジュール参照を`?v=records-startup-1`へ更新し、旧URLに残る壊れたJSのキャッシュを避ける。学習教材・セーブ形式・戦闘・訓練・図鑑機能の仕様変更なし。

## 検証

- 修正前mainの入口JSを`git show 8f2df78:game/js/pages/records-page.js`で取り出し、`node --check`で`Identifier 'catalog' has already been declared`を再現。
- `game/tests/page-syntax.test.js`を追加。全ページ入口JSを`node --check`し、この構文エラーを既定テストで検出する。
- `cd game && npm test`: **339/339成功、fail/skip 0**。
- `python -m http.server 8768 --bind 127.0.0.1`で配信、別ターミナルから`node game/verification/records-startup/browser-smoke.cjs`。PlaywrightとChromiumを使用し、依存追加はない。
- 新しい隔離context、390×844、Lv1の合成6人セーブで町が起動。通常英作文とチャンク集中をそれぞれ起動し、異なるモード表示とチャンクヒントの有無を確認。それぞれ1問を自己評価して記録。
- 冒険先を明示的に「苔むした洞窟」へ選択して出発し、本体の戦闘画面から通常攻撃→出題→正答。実際に遭遇したIDを保存状態から読み、記録ページの図鑑に対応する現在名が出ることを確認（図鑑用の遭遇IDを直接注入していない）。
- 学習記録が教材1600語を参照して起動し、単語1問・英作文2問の履歴が表示されることを確認。設定タブの翻訳方向を英→日から日→英へ変更し、再読込後も保持。
- ブラウザーpageerror 0。`git diff --check`成功。実セーブは参照・操作していない。

ローカルHTTPで最新HTMLとJSを読む検証であり、公開先のHTMLキャッシュ更新・実配信は未検証。戦闘は1行動の起動回帰で、踏破やバランス測定ではない。次のロードマップ項目・ドット絵・デバッグボタンは変更していない。マージ・デプロイ・定期処理は行わない。

指定された追加スキルは提供されていないため、既存CLAUDE.mdと依頼の明示条件に従った。
