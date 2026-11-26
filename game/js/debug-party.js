import { normalizeAp } from './ap.js?v=skill-growth-2';
// 開発用メニュー専用。通常の画面からは読み込まない。
import { gainXp, xpToNext, levelCap } from './character.js?v=advanced-jobs-1';

export const DEBUG_PARTY_LABEL = '全員をLv99・AP999に設定';
export const DEBUG_PARTY_CONFIRM = 'パーティ全員をLv99にし、各メンバーのAPを999に設定します（加算ではありません）。HP/MPは通常のレベルアップ規則に従い、全回復・復活はしません。現在のセーブに保存されます。ほかのゲームタブを閉じてから実行してください。よろしいですか？';

export function canDebugParty(data, session) {
  return !!data && levelCap(data) === 99 && !session.readOnly && !session.inDungeon
    && !!session.game?.party?.length;
}

export function confirmDebugParty(data, session, confirm) {
  // 開いた後に別タブで遠征を開始した場合も、古い町の状態で上書きしない。
  session.load();
  if (!canDebugParty(data, session)) return '町にいる編集可能なパーティでのみ実行できます。';
  if (!confirm(DEBUG_PARTY_CONFIRM)) return 'キャンセルしました。変更はありません。';
  session.load();
  if (!canDebugParty(data, session)) return 'セーブの状態が変わったため実行しませんでした。';
  session.update(game => {
    for (const member of game.party) {
      let xp = 0;
      for (let lv = member.lv; lv < 99; lv++) xp += xpToNext(data, lv);
      gainXp(data, member, Math.max(0, xp - member.xp));
      normalizeAp(data, member);
      member.ap = 999;
    }
  });
  return '全員をLv99・AP999に設定し、現在のセーブに保存しました。';
}

