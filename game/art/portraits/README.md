# 仲間の顔

人間10・ファンタジー8・どうぶつ8、合計26種類のドット絵調ポートレート。
`data/appearance_icons.csv` のIDと並び順に対応する。セーブのIDは変更しない。

| 画像 | 配置 | 対応ID |
|---|---|---|
| human.png | 5列×2行 | human_01〜human_10 |
| fantasy.png | 4列×2行 | fantasy_01〜fantasy_08 |
| animal.png | 4列×2行 | animal_01〜animal_08 |

各画像は左上から行優先で読み、`js/ui/portrait.js` がCSS背景位置で切り出す。
パーティの顔は64px、見た目の選択・戦闘・勝利・装備比較は32pxで表示する。
`image-rendering: pixelated` で拡縮し、端末の絵文字フォントに依存しない。
未知のIDは `human_01` の表示に戻すが、保存されたIDは変更しない。

画像は組み込みの `image_gen` で生成した背景透過PNG。32px論理グリッドの表現を
指定した高解像度アトラスであり、32×32pxの原画ではない。採用したプロンプト全文は
`generation-prompts-human-fantasy.json` と `generation-prompts-animal.json` に保存。

表示先はパーティ作成・一覧・個人詳細、遠征の仲間一覧、戦闘、勝利、装備屋の比較。
名前を隣に表示する装飾として読み上げを重複させず、選択ボタンには外見名を付ける。
