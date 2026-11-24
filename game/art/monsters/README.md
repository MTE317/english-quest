# 苔むした洞窟の敵ドット絵（試験導入）

| ID | PNG | 原寸 |
|---|---|---:|
| slime | slime.png | 32×32 |
| exp_mossy_cave_7 | stone-golem.png | 32×32 |
| goblin_boss | gram.png | 48×48 |

English Quest 用に描き下ろした静止画。従来の敵アイコンはそのまま維持する。苔むした洞窟の通常遠征の戦闘パネルと、そのパネル内の個別図鑑でだけ表示する。敵を識別するキーは表示名でなく既存の敵 ID。画像のない敵、読み込めない画像、その他の地域・挑戦では従来アイコンに戻る。

モバイルでの再現は、リポジトリルートから `python -m http.server 8767` を起動し、Chromium と Playwright が使える環境で `node game/verification/mossy-sprites/browser-smoke.cjs`。セーブはテストのメモリ内に作成する。
