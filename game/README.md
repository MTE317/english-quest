# game/ — English Quest 本体

ビルドなしの素の JavaScript（ES モジュール）。GitHub Pages でそのまま動く。

## 開き方（ローカル）

`fetch` で `data/` を読むので、`file://` では動かない。リポジトリの一番上でサーバーを立てて開く。

```
python3 -m http.server 8000
```

→ http://localhost:8000/game/

## 画面

| ファイル | 内容 |
|---|---|
| `index.html` | 入口 |
| `data.html` | データ確認（ファイルごとの行数・中身の表・絞り込み・`|` と `素材ID:個数` の分解表示） |
| `quiz.html` | 動作確認用：ルーンストーンを選んで4択を10問。日付をずらして復習の出方を確かめられる |

## しくみ（`js/`）

| ファイル | 内容 |
|---|---|
| `csv.js` | CSV の読み込み（BOM の除去・引用符）、`|` 区切り、`素材ID:個数` の分解 |
| `data.js` / `manifest.js` | `data/` の CSV・JSON を読む / 読むファイルの一覧 |
| `lexicon.js` | ルーンストーンとルーン（単語）を使いやすい形にする |
| `srs.js` | 復習の時期の計算（FSRS を参考。設定は `data/srs.json`） |
| `storage.js` | 学習記録の保存（localStorage）。ゲームの進み具合とは別のキー |
| `picker.js` | 出題する単語を選ぶ（復習優先 → 間違えた単語 → 新しい単語 → 練習） |
| `quiz.js` | 4択の問題を作る（英→日・日→英、誤答の選び方） |
| `speech.js` | 英語の読み上げ（Web Speech API） |

## テスト

```
cd game
node --test tests/*.test.js
```
