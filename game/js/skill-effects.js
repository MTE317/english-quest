// スキル詳細用の説明。技能データの効果・属性・対象を共通の日本語へ変換する。
const pct = (value) => `${Math.round(Number(value) * 1000) / 10}%`;
const names = (value) => (Array.isArray(value) ? value : [value]).join('・');
const STATS = { hp: '最大HP', mp: '最大MP', str: 'STR', mag: 'MAG', def: 'DEF', res: 'RES', spd: 'SPD', luk: 'LUK' };
const PASSIVE_LABELS = {
  crt: '会心率', eva: '回避率', sres: '状態異常耐性', healp: '回復魔法の回復量',
  stat_rate: '状態異常の付与率', dot_power: '継続ダメージ', counter_power: '反撃ダメージ',
  drop: '素材入手率', xp: '獲得経験値', itemp: '道具の効果',
  weak_all: '弱点を突くダメージ', vs_debuffed: '弱体・状態異常中の敵への直接ダメージ',
};

function passiveText(data, key, value) {
  if (STATS[key] || PASSIVE_LABELS[key]) return `${STATS[key] ?? PASSIVE_LABELS[key]} +${pct(value)}`;
  if (key === 'wdmg') return `${names(value[0])}の武器攻撃ダメージ +${pct(value[1])}`;
  if (key === 'edmg') return `${names(value[0])}属性ダメージ +${pct(value[1])}`;
  if (key === 'tdmg') return `${names(value[0])}へのダメージ +${pct(value[1])}`;
  if (key === 'status_count_damage') return `${names(value[0].map(id => data.statusEffects.get(id)?.name ?? id))}のうち、対象に付いている1種類ごとに直接ダメージ +${pct(value[1])}`;
  const special = {
    bounty_chance: () => `賞金首の遭遇率 +${pct(value)}（パーティーで1人分）`,
    poison_spread: () => `毒・猛毒の敵を倒すと、別の敵1体に同じ状態を付与（基礎確率${pct(value)}、1巡1回）`,
    thunder_crit_mp: () => `正解した雷属性攻撃で会心ダメージを与えると、最大MPの${pct(value)}を回復（装備効果と合わせて1行動1回・技能は支払MPまで）`,
    lowhp_dmg: () => `HPが半分未満の時、与ダメージ +${pct(value)}`,
    kill_mp: () => `敵を倒すとMPを${value}回復`,
    cover: () => `単体攻撃を受ける味方をかばう（基礎確率${pct(value)}）`,
    party_sres: () => `味方全員の状態異常耐性 +${pct(value)}`,
    start_res: () => `開始3巡、味方全員のRES +${pct(value)}`,
    fist: () => `拳の武器攻撃を威力${pct(value)}の2連撃にする`,
    regen: () => `毎巡、自分の最大HPの${pct(value)}を回復`,
    hp_regen: () => `戦闘後に最大HPの${pct(value)}を回復`,
    mp_regen: () => `戦闘後に最大MPの${pct(value)}を回復`,
    endure: () => '戦闘中に一度、致命傷をHP1で耐える',
    auto_poison: () => `通常攻撃でダメージを与えると毒を付与（基礎付与率${pct(value)}）`,
    song_turns: () => `歌の全体強化が${value}巡延長`,
    dance_turns: () => `舞の全体強化が${value}巡延長`,
    weak_wew: () => `風・土・水で弱点を突くダメージ +${pct(value)}`,
    party_ecut: () => `味方全員の魔法・属性ダメージを${pct(value)}軽減`,
    party_eres: () => `味方全員の属性ダメージ耐性 +${pct(value)}`,
    first: () => '戦闘の最初の巡に先に行動する',
    bullet: () => `銃の物理攻撃技能ダメージ +${pct(value)}`,
    whip: () => `鞭の通常全体攻撃の威力を${pct(value)}にする`,
    mag2phys: () => `物理攻撃へMAGの${pct(value)}を加算`,
    mag_to_atk: () => `攻撃時の武器威力へMAGの${pct(value)}を加算`,
    open_curse: () => `戦闘開始時、敵全体のDEF・RESを${pct(value)}下げる`,
    save: () => `道具を消費しない基礎確率${pct(value)}`,
    nopoison: () => `${[...data.statusEffects.values()].filter((status) => status.kind.startsWith('dot') && status.cure.includes('毒消し')).map((status) => status.name).join('・')}を防ぐ`,
    song: () => `歌の与ダメージ強化に${pct(value)}を加算`,
    imbue: () => `剣気の威力補正 +${pct(value)}`,
  };
  return special[key]?.() ?? '';
}

function buffText(key, value) {
  if (STATS[key]) return `${STATS[key]} +${pct(value)}`;
  const labels = { dmg: '与ダメージ', eva: '回避率', magb: '魔法の威力' };
  if (labels[key]) return `${labels[key]} +${pct(value)}`;
  if (key === 'cut') return `被ダメージを${pct(value)}軽減`;
  if (key === 'pcut') return `物理ダメージを${pct(value)}軽減`;
  if (key === 'counter') return `物理被弾時の反撃率${pct(value)}`;
  if (key === 'immune') return `敵の追加状態異常を${pct(value)}防ぐ`;
  if (key === 'regen') return `毎巡、最大HPの${pct(value)}を回復`;
  if (key === 'taunt') return '敵に狙われやすくなる';
  return '';
}

function elementText(data, skill) {
  const effect = skill.effect ?? {};
  if (effect.element === 'best') return '相性のよい属性';
  const ids = effect.element ? [effect.element] : skill.elements ?? [];
  if (!effect.element && skill.kind === 'attack' && (effect.base ?? 'weapon') === 'weapon') return '武器の属性';
  return ids.length ? `${ids.map((id) => data.elements.get(id)?.name ?? id).join('・')}属性` : '無属性';
}

/** 装備・能力・相手による補正前の効果。実ダメージや実付与率を確定値として案内しない。 */
export function describeSkillEffect(data, skill) {
  const effect = skill.effect ?? {};
  const target = effect.tgt === 'all' ? '敵全体' : effect.tgt === 'random' ? 'ランダムな敵' : '敵一体';
  const parts = [];
  switch (skill.kind) {
    case 'passive':
      parts.push(...Object.entries(effect.mod ?? {}).map(([key, value]) => passiveText(data, key, value)).filter(Boolean));
      break;
    case 'attack': {
      const base = { weapon: '武器依存の攻撃', phys: 'STR依存の物理攻撃', mag: 'MAG依存の魔法攻撃' }[effect.base ?? 'weapon'];
      parts.push(`${target}に${base}（${elementText(data, skill)}・基礎倍率${effect.m ?? 1}倍）`);
      if (effect.tgt === 'random') parts.push(`${effect.n ?? 1}回攻撃`);
      if (effect.hits?.length > 1) parts.push(`${effect.hits.length}連撃`);
      if (effect.crt) parts.push(`会心率 +${pct(effect.crt)}`);
      if (effect.defign) parts.push(`敵DEFの${pct(effect.defign)}を無視`);
      if (effect.wb) parts.push(`弱点補正を${effect.wb}倍にする`);
      if (effect.noresist) parts.push('属性耐性による軽減を受けない');
      if (effect.beststat) parts.push('物理攻撃時、STRとMAGの高い方を使う');
      if (effect.selfcost) parts.push(`自分の最大HPの${pct(effect.selfcost)}を消費（HP1は残る）`);
      if (effect.drain) parts.push(`正解時、実ダメージの${pct(effect.drain / 10)}をMP回復（支払MPまで）`);
      if (effect.imbue_only) parts.push('剣気をまとっている時だけ使用できる');
      break;
    }
    case 'status':
      parts.push(`${target}に状態異常を与える${effect.base === 'mag' ? '魔法' : '技能'}`);
      break;
    case 'heal': case 'heal_all':
      parts.push(`${skill.kind === 'heal_all' ? '味方全員' : '味方一人'}のHPを回復（MAGと武器威力が基準・基礎倍率${effect.m ?? 1}倍）`);
      if (effect.cure) parts.push('状態異常も治す');
      if (effect.revive_all) parts.push(`倒れた味方を最大HPの${pct(effect.revive_all)}で蘇生（石化中を除く）`);
      break;
    case 'revive':
      parts.push(`倒れた味方一人を最大HPの${pct(effect.frac ?? .3)}で蘇生`);
      break;
    case 'cure': case 'cure_all': {
      const cured = [...data.statusEffects.values()].filter((status) => String(status.cure ?? '').split('・').includes(skill.name)).map((status) => status.name);
      parts.push(`${skill.kind === 'cure_all' ? '味方全員' : '味方一人'}の${cured.length ? cured.join('・') + 'を治す' : '状態異常を治療する（対応する状態異常なし）'}`);
      break;
    }
    case 'party_buff': case 'self_buff': case 'ally_buff': {
      const who = skill.kind === 'party_buff' ? '味方全員' : skill.kind === 'self_buff' ? '自分' : '味方一人';
      parts.push(`${who}を強化：${Object.entries(effect.buff ?? {}).map(([key, value]) => buffText(key, value)).filter(Boolean).join('・')}`);
      parts.push(`付与巡と続く${effect.turns ?? 1}巡に有効（強化量には上限あり）`);
      break;
    }
    case 'debuff':
      parts.push(`${target}を弱体：${Object.entries(effect.deb ?? {}).map(([key, value]) => `${STATS[key] ?? key} -${pct(value)}`).join('・')}`);
      parts.push(`付与巡と続く${effect.turns ?? 1}巡に有効`);
      break;
    case 'mp_give':
      parts.push(`味方一人の最大MPの${pct(effect.frac ?? 0)}を${effect.transfer ? '自分のMPから渡す（技能の消費MPに加え、渡した量も減る）' : '回復'}`);
      break;
    case 'imbue':
      parts.push(`物理武器の攻撃属性を${elementText(data, skill)}へ切り替え、威力を強化（戦闘中有効・別の剣気で上書き）`);
      break;
    case 'fixed_damage':
      parts.push(`敵全体に${elementText(data, skill)}攻撃（武器Lvが基準・敵のRESで軽減）`);
      break;
    case 'delayed':
      parts.push(`${effect.delay ?? 1}巡後、敵全体へMAG依存の${elementText(data, skill)}攻撃（基礎倍率${effect.m ?? 1}倍）`);
      break;
    case 'utility':
      parts.push(skill.id === 'hunter_p2_s1' ? '敵一体の弱点を調べ、図鑑に記録する'
        : '敵一体から通常素材を盗む（基礎成功率50%・一体につき一度）');
      break;
  }
  if (effect.st) {
    const [name, rate] = effect.st;
    const label = data.statusEffects.get(name)?.name ?? name;
    parts.push(`${skill.kind === 'attack' ? 'ダメージを与えた相手に' : ''}${label}を付与（基礎付与率${pct(rate)}・補正や耐性で変化）`);
  }
  if (effect.once) parts.push('一戦に一回まで');
  return parts.length ? `${parts.join('。')}。` : '効果の説明はありません。';
}
