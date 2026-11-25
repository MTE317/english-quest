// 専用のテスト戦闘だけで使う。保存先はメモリ内に限定する。
import { GameSession } from './save.js?v=rune-study-1';
import { createBattle } from './battle.js?v=basic-skill-levels-1';
import { makeEncounter } from './encounter.js?v=basic-skill-levels-1';
import { maxHp, maxMp } from './character.js?v=basic-skill-levels-1';

export function applyPartyDebugStatus(data, game, battle, statusId) {
  const status = statusId ? data.statusEffects.get(statusId) : null;
  if (statusId && !status) throw new Error('状態異常が見つかりません。');
  if (battle.allies.length !== game.party.length) throw new Error('パーティー人数が一致しません。');
  game.party.forEach((member, index) => {
    member.persist = [];
    delete member.persistState;
    // 敵から受けたときと同じデータ形式。耐性を無視して確実に付与する。
    battle.allies[index].statuses = status ? { [status.id]: { turns: status.turns, n: 1 } } : {};
  });
  battle.log.push(status ? `【デバッグ】全員を${status.name}にした` : '【デバッグ】全員の状態異常を解除した');
}

export function createStatusDebugSession(data, sourceGame, { dungeonId, stoneId, statusId = '', seed = 317 } = {}) {
  if (!sourceGame?.party?.length) throw new Error('先にパーティーを作ってください。');
  if (!data.dungeons.has(dungeonId)) throw new Error('ダンジョンが見つかりません。');
  if (statusId && !data.statusEffects.has(statusId)) throw new Error('状態異常が見つかりません。');
  const entries = new Map();
  const memory = {
    getItem: key => entries.get(key) ?? null,
    setItem: (key, value) => entries.set(key, String(value)),
    removeItem: key => entries.delete(key),
  };
  const session = new GameSession({ storage: memory });
  session.startNew(sourceGame);
  for (const member of session.game.party) {
    member.persist = [];
    delete member.persistState;
    member.hp = maxHp(data, member);
    member.mp = maxMp(data, member);
  }
  session.enterDungeon({ dungeonId, stoneId });
  let rngState = seed >>> 0;
  const rng = () => { rngState = (Math.imul(rngState, 1664525) + 1013904223) >>> 0; return rngState / 2 ** 32; };
  const enemies = makeEncounter(data, dungeonId, 1, rng, { elites: false });
  const battle = createBattle(data, session.game, { enemies, seed, firstBattle: true });
  applyPartyDebugStatus(data, session.game, battle, statusId);
  session.setBattle(battle);
  return session;
}
