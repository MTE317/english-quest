import { createNewGame, defaultPartySpecs } from '../../js/game-state.js';
import { buyGear, buyItem } from '../../js/town.js';
import { equipFromStorage } from '../../js/character.js';
import { learnSkill, equipSkill, learnBlock, equipBlock } from '../../js/growth.js';

// 通常の購入・習得・装着APIだけで初期支度金を使う。ドロップ装備は使わない。
export function preparedNewGame(data) {
  const game = createNewGame(data, defaultPartySpecs(data));
  const weapons = ['greatsword_t1', 'sword_t1', 'tome_t1', 'staff_t1', 'dagger_t1', 'instrument_t1'];
  const armors = ['heavy_body_t1', 'heavy_body_t1', 'light_body_t1', 'light_body_t1', 'medium_body_t1'];
  const purchases = [];
  game.party.forEach((member, i) => {
    for (const [slot, id] of [['weapon', weapons[i]], ['body', armors[i]]]) {
      if (!id) continue;
      const before = game.gold;
      const gear = buyGear(data, game, id);
      equipFromStorage(data, game, member, slot, gear.uid);
      purchases.push({ member: i, id, gold: before - game.gold });
    }
    for (const skill of [...data.skills.values()].filter(s => s.job === member.job && !s.isFinal)) {
      if (!learnBlock(data, member, skill)) {
        learnSkill(data, member, skill.id);
        if (!equipBlock(data, member, skill)) equipSkill(data, member, skill.id);
      }
    }
  });
  for (const [id, count] of Object.entries({ potion: 3, ether: 2, revive_salts: 1, antidote: 2 })) {
    const before = game.gold;
    buyItem(data, game, id, count);
    purchases.push({ id, count, gold: before - game.gold });
  }
  return { game, purchases };
}
