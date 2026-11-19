const SOURCE_URL = 'https://www.dota2.com/patches/7.42';
const ITEM_SOURCE_URL = 'https://github.com/SteamTracking/GameTracking-Dota2/blob/2ad4e6b7bd40b0fbdbd4a85bd9f11f7a992c4300/game/dota/pak01_dir/scripts/npc/items.txt';

// Valve 7.42 notes and pinned client build 6978. These scalars apply to the named effects only.
const attackSources = [
  { key: 'hero', label: 'Normal hero attack', potency: 100 },
  { key: 'illusion', label: 'Standard illusion', potency: 20 },
  { key: 'illusion-rune', label: 'Illusion Rune', potency: 40 },
  { key: 'manta', label: 'Manta Style illusion', potency: 35, requirement: 'manta' },
  { key: 'swashbuckle', label: 'Pangolier Swashbuckle', potency: 60, hits: 4, heroId: 120 },
  { key: 'blade-fury-scepter', label: 'Juggernaut Blade Fury Scepter attack', potency: 75, heroId: 8, requirement: 'ultimate_scepter' },
  { key: 'phantasm', label: 'Chaos Knight Phantasm', potency: 100, heroId: 81 },
  { key: 'chaos-knight-shard', label: 'Chaos Knight Shard illusion', potency: 25, heroId: 81, requirement: 'aghanims_shard' },
  { key: 'haunt', label: 'Spectre Haunt illusion', potency: 40, heroId: 67 },
  { key: 'shadow-step', label: 'Spectre Shadow Step illusion', potency: 25, heroId: 67 },
  { key: 'vengeful-scepter', label: 'Vengeful Spirit Scepter illusion', potency: 100, heroId: 20, requirement: 'ultimate_scepter' },
];

const affectedItems = [
  { key: 'desolator', kind: 'armor-reduction', effect: 'Corruption', unit: 'armor reduction', base: 6 },
  { key: 'diffusal_blade', kind: 'mana-burn', effect: 'Manabreak', unit: 'mana per hit', base: 40 },
  { key: 'disperser', kind: 'mana-burn', effect: 'Manabreak', unit: 'mana per hit', base: 40 },
  { key: 'maelstrom', kind: 'proc-chance', effect: 'Chain Lightning', unit: '% proc chance', base: 25 },
];

export function buildItemPotencyComparison(items, { targetMana = null } = {}) {
  if (targetMana !== null && (!Number.isFinite(targetMana) || targetMana < 0)) {
    throw new RangeError('Target mana must be a nonnegative number.');
  }
  const byKey = new Map(items.map(({ key, name, cost }) => [key, { key, name, cost }]));
  const selected = affectedItems.filter(({ key }) => byKey.has(key));
  return {
    patch: '7.42',
    sourceUrl: SOURCE_URL,
    itemSourceUrl: ITEM_SOURCE_URL,
    items: selected.map(({ key, kind, effect, unit, base }) => ({ ...byKey.get(key), kind, effect, unit, base })),
    sources: attackSources.map(({ key, label, potency, hits = null, heroId = null, requirement }) => ({
      key, label, potency, hits, heroId,
      requiredItem: byKey.get(requirement) ?? null,
      effects: selected.map(({ key: itemKey, base, kind }) => {
        const value = base * potency / 100;
        const sequenceValue = kind === 'mana-burn' && hits !== null
          ? Math.min(targetMana ?? Infinity, value * hits)
          : null;
        return { itemKey, value, sequenceValue };
      }),
    })),
    assumptions: [
      'Item Potency scales these specific on-hit effects. Values describe one attacker landing an eligible hit.',
      'Corruption uses the strongest active application of the same debuff. Repeated hits retain one armor reduction.',
      'Manabreak is limited by the target’s remaining mana. The four-hit Swashbuckle total assumes every slash connects with the same target.',
      'Chain Lightning shows nominal proc chance on a ready eligible attack. Its 0.2s cooldown and proc roll behavior affect the number of procs in a sequence.',
      'This comparison shows individual effects. Direct attack damage, illusion uptime, and full-fight DPS require a separate model.',
    ],
  };
}
