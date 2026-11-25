// CSVの基準単位から現在のGへ。比率・AP・素材・状態効果のgold倍率は変換しない。
export const goldScale = data => data.balance.gold_economy?.scale ?? 1;
export const goldVersion = data => data.balance.gold_economy?.version ?? 0;

/** 新しい見積額だけ丸める。残高・返金・預かり金・まとめ買い合計は丸めない。 */
export function roundGold(data, amount, mode = 'round') {
  const scale = goldScale(data);
  const oldRounded = Math[mode](amount / scale) * scale;
  if (!oldRounded) return amount > 0 ? scale : 0;
  const rule = data.balance.gold_economy;
  if (!rule) return oldRounded;
  const step = Math.max(rule.minimum_step, 10 ** (Math.floor(Math.log10(oldRounded)) - rule.significant_digits + 1));
  // 大きい桁へ丸めるときは元の額を使い、二段階の四捨五入を避ける。
  return Math.max(step, Math.round((step > scale ? amount : oldRounded) / step) * step);
}


/** 融資上限だけは切り上げ、旧単位で合法だった借入枠を縮めない。 */
export function goldLimit(data, amount) {
  const rule = data.balance.gold_economy;
  if (!rule) return Math.floor(amount);
  const step = Math.max(rule.minimum_step, 10 ** (Math.floor(Math.log10(amount)) - rule.significant_digits + 1));
  return Math.ceil(amount / step) * step;
}

/** 生の正式データは旧単位のまま保ち、構築済みGameDataだけ一度変換する。 */
export function denominateGoldData(data) {
  const scale = goldScale(data);
  if (scale === 1) return data;
  const quote = n => roundGold(data, Number(n) * scale);
  for (const row of data.economy?.values() ?? []) for (const key of ['run_income','guild_fee','inn_cheap','inn_good','revive_per_person','curse_cure','craft_gold']) {
    if (row[key] != null) row[key] = ['run_income','guild_fee'].includes(key) ? Number(row[key]) * scale : quote(row[key]);
  }
  for (const item of data.items?.values() ?? []) item.price = quote(item.price);
  for (const [rows, key] of [[data.backpackTiers,'gold'],[data.recipes,'gold'],[data.alchemyRecipes,'gold'],[data.enchantGrades,'gold'],[data.facilityRanks,'invest_cost']]) {
    for (const row of rows ?? []) row[key] = quote(row[key]);
  }
  // 記録済み支払額の返還なので、新価格の丸めを適用しない。
  for (const row of data.kokuinSlots ?? []) row.gold = Number(row.gold) * scale;
  if (data.balance.new_game) data.balance.new_game.gold *= scale;
  if (data.balance.temple?.cure_gold != null) data.balance.temple.cure_gold = quote(data.balance.temple.cure_gold);
  for (const story of data.balance.exploration_stories ?? []) story.reward.gold = quote(story.reward.gold);
  return data;
}

/** 旧残高と契約を正確に換算。game/run/復元元はそれぞれマーカーを持つ。 */
export function migrateGold(data, game, run = null) {
  const version = goldVersion(data), scale = goldScale(data);
  if (!version) return;
  const field = (object, key) => {
    if (object && object[key] != null && Number.isFinite(Number(object[key]))) object[key] = Number(object[key]) * scale;
  };
  if ((game.goldVersion ?? 0) < version) {
    for (const key of ['gold','loan']) field(game,key);
    const contracts = new Set([...(game.board ?? []), ...(game.quests ?? []), game.specialQuest, ...Object.values(game.questBoardByArea ?? {}).flat()].filter(q => q && typeof q === 'object'));
    for (const q of contracts) {
      q.goldLegacyContract = true;
      for (const key of ['rewardGold','depositGold','depositPaid']) field(q,key);
    }
    field(game.runeRetirement,'gold');
    for (const record of Object.values(game.retiredQuestChains ?? {})) field(record.settlement,'gold');
    game.goldVersion = version;
    game.notices ??= [];
    game.notices.push(`ゴールドの単位を変更し、所持金・借入・保存済みの契約額を${scale}倍に換算しました。過去のお知らせの金額は変更前の単位です。`);
  }
  if (run && (run.goldVersion ?? 0) < version) {
    field(run,'expeditionFee');field(run.earned,'gold');
    for (const notice of run.explorationNotices ?? []) field(notice,'gold');
    // 保存済み戦闘結果/拾得待ちにもGがある旧形式を保持する。
    for (const loot of run.pendingLoot ?? []) field(loot,'gold');
    field(run.lastResult?.loot,'gold');
    run.goldVersion = version;
  }
}
