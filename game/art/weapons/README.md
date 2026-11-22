# 武器種アイコン

English Quest 用の32×32px・透過PNG。`data/weapon_types.csv` の武器種IDとファイル名を対応させる。

| ID | 武器種 |
|---|---|
| sword | 剣 |
| greatsword | 大剣 |
| katana | 刀 |
| dagger | 短剣 |
| axe | 斧 |
| spear | 槍 |
| bow | 弓 |
| hammer | 鎚 |
| fist | 拳 |
| staff | 杖 |
| tome | 魔導書 |
| instrument | 楽器 |
| gun | 銃 |
| whip | 鞭 |
| scythe | 鎌 |
| fan | 扇 |

扇は、他の武器と輪郭・配色を揃えて作り直した32×32px版を使用。
表示は `js/ui/weapon-icons.js` の `weaponIcon(kind)` にまとめ、CSSの
`image-rendering: pixelated` でドットの輪郭を保つ。武器の名前は画像の隣に表示する。
