# 技能成長方式 v2 の実装

基本8職の120技能をレベルなし28・最大Lv3 46・最大Lv5 46へ更新。各職9A/5P/1奥義、固定装備コスト、奥義の非奥義10種類条件を維持する。

設計正本は basic-jobs-skills-v2.md / jobs-baseline-v2.md。data/skill-growth-physical.json と skill-growth-magic.json に全段階の原文を保持し、scripts/build-basic-job-skills.mjs と skill-growth-v2.mjs で skills.csv を再生成する。v1設計書は旧効果の比較用。

レベルなし技能は修得後に強化不可。画面はLvを付けず、修得状態で表示する。成長する技能は修得済みの最高Lvで発動する。

既存セーブは技能ごとの上限超過のみを切り下げ、v1で支払った超過強化APを一度返す。Lv5→Lv3は75AP、Lv5→レベルなしは107AP。修得記録・装備・職業・所持品・学習記録を保持し、遠征開始前の写しにも適用する。

MP/APの帯・基礎容量・ゲージの暫定値は従来のまま。戦闘の長期バランスは今回の構造変更とは別に調整する。
