# 固定モンスター・エリートの検証

2026-11-28。[仕様](../../../docs/specs/fixed-monsters.md)・[地域1の固定能力](../../../docs/monster-stats-region1.md)。

- node --test game/tests/*.test.js：786件成功、失敗0。
- fixed-monsters.test.js：全1024種の場所・指定Lv非依存、同じダンジョン内の異種Lv、マスター検証、対象種・同名・同Lv・能力上昇、レア素材確率、レア装備抽選、1遠征の上限、保存再開、図鑑の通常値、旧戦闘保存値の維持を確認。
- node scripts/verify-fixed-monsters.cjs：幅320px・390px・1000pxで同じスライムLv1の通常個体とエリートを表示。◆、能力差、再読み込み後の保持を確認。横はみ出し・JavaScriptエラーなし。[結果JSON](browser-results.json)。

ブラウザ検証は専用のセーブを作って両個体を配置する。実際の確率で遭遇するまでの手動攻略や、全モンスターの戦闘バランスを検証したものではない。次段階で出現候補・体数・編成を調整する。

PlaywrightとChromeを使用する。必要に応じてNODE_PATH・CHROME_PATHを設定する。ローカルファイルをPlaywrightから配信するため、HTTPサーバー・実ユーザーのセーブは不要。
