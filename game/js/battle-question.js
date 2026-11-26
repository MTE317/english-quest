/** 回答前の行動選択を取り消し、同じ問題を次の選択まで保持する。 */
export function cancelBattleQuestion(battle) {
  const pending = battle.pending;
  if (!pending || battle.result || battle.turn?.side !== 'ally' || battle.turn.i !== pending.actor) return false;
  battle.reservedQuestion = pending.question;
  battle.pending = null;
  return true;
}
