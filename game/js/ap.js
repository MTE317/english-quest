// APはキャラごとの共通残高。転職経験は残高と独立して保持する。
export function normalizeAp(data, member) {
  const legacy = member.ap && typeof member.ap === 'object' ? member.ap : null;
  member.visitedJobs = [...new Set([...(member.visitedJobs ?? []), ...Object.keys(legacy ?? {}), member.job].filter(Boolean))];
  if (member.apVersion !== 1) {
    const balance = legacy ? Object.values(legacy).reduce((sum, value) => sum + validAp(value), 0) : validAp(member.ap);
    const spent = (member.common ?? []).reduce((sum, id) => sum + (data.commonTree?.find(node => node.id === id)?.points ?? 0), 0);
    const remaining = Math.max(0, (member.lv ?? 1) - 1 - spent);
    member.ap = balance + remaining * (data.balance?.ap_system?.legacy_common_point_ap ?? 10);
    member.apVersion = 1;
  } else member.ap = validAp(member.ap);
  // 旧訓練のジョブ別小数も合算。整数になった分は一度だけ残高へ。
  const credit = member.trainingCredit;
  if (credit?.ap && typeof credit.ap === 'object') {
    const total = Object.values(credit.ap).reduce((sum, value) => sum + validAp(value), 0);
    const whole = Math.floor(total + 1e-9);
    member.ap += whole;
    credit.ap = Math.round((total - whole) * 1e6) / 1e6;
  }
  return member.ap;
}
function validAp(value) { return Number.isFinite(value) && value >= 0 ? value : 0; }
export function availableAp(data, member) { return normalizeAp(data, member); }
export function gainAp(data, member, amount) {
  normalizeAp(data, member);
  member.ap += validAp(amount);
}
export function spendAp(data, member, amount) {
  const balance = availableAp(data, member);
  if (!Number.isFinite(amount) || amount < 0 || balance < amount) throw new Error('APが足りない');
  member.ap -= amount;
}
export function hasVisitedJob(member, job) {
  return member.job === job || (member.visitedJobs ?? []).includes(job)
    || Boolean(member.ap && typeof member.ap === 'object' && Object.hasOwn(member.ap, job));
}

