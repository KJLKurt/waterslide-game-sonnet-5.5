// Character palettes, accessories and the (tiny) unlock tree.

export const PALETTES = [
  { id: 'sunny', name: 'Sunny', shirt: 0xffb81c, shorts: 0x2b7bff, skin: 0xf4c3a0, hair: 0x5a3a1e, accent: 0xff5a7a },
  { id: 'ocean', name: 'Ocean', shirt: 0x1fb6ff, shorts: 0xffffff, skin: 0xc98d62, hair: 0x1d1d26, accent: 0xffd23f },
  { id: 'flamingo', name: 'Flamingo', shirt: 0xff5fa2, shorts: 0x7a3cff, skin: 0xffd9bd, hair: 0xd9482b, accent: 0x33e0c4 },
  { id: 'mint', name: 'Mint', shirt: 0x3ee6b0, shorts: 0x1c5cff, skin: 0x8d5a3b, hair: 0x2a1a12, accent: 0xff9d2f },
  { id: 'grape', name: 'Grape', shirt: 0x8a4dff, shorts: 0xffd23f, skin: 0xe8b48f, hair: 0xf2e26a, accent: 0x33e0c4 },
  { id: 'gold', name: 'Gold', shirt: 0xffd21f, shorts: 0xff7a1a, skin: 0xf4c3a0, hair: 0x2a1a12, accent: 0xffffff },
  { id: 'ninja', name: 'Ninja', shirt: 0x2c3445, shorts: 0xe23b3b, skin: 0xd9a37e, hair: 0x101015, accent: 0xff4d4d },
  { id: 'lava', name: 'Lava', shirt: 0xff5a2a, shorts: 0x2a2a3a, skin: 0xb9784f, hair: 0x7a1e0e, accent: 0xffe14a },
];

// NPC skins/colours are drawn from this list so every racer looks different.
export const NPC_LOOKS = [
  { shirt: 0xff6b6b, shorts: 0x2b3a67, skin: 0xf0bd98, hair: 0x3a2412 },
  { shirt: 0x4dd0e1, shorts: 0xffca28, skin: 0xa86e47, hair: 0x14121a },
  { shirt: 0xb388ff, shorts: 0x2e7d32, skin: 0xffd9bd, hair: 0xe0a030 },
  { shirt: 0xffa726, shorts: 0x1565c0, skin: 0x7b4a2d, hair: 0x0e0e12 },
  { shirt: 0x66bb6a, shorts: 0xf06292, skin: 0xe8b48f, hair: 0x5a3a1e },
  { shirt: 0xef5350, shorts: 0xeceff1, skin: 0xc98d62, hair: 0x2a1a12 },
  { shirt: 0x26c6da, shorts: 0x6a1b9a, skin: 0xf4c3a0, hair: 0xb5651d },
  { shirt: 0xffee58, shorts: 0x00897b, skin: 0x8d5a3b, hair: 0x101015 },
  { shirt: 0xec407a, shorts: 0x37474f, skin: 0xffd9bd, hair: 0x8a2be2 },
  { shirt: 0x42a5f5, shorts: 0xff7043, skin: 0xd9a37e, hair: 0x3a2412 },
  { shirt: 0x9ccc65, shorts: 0x5c6bc0, skin: 0xf4c3a0, hair: 0xd9482b },
  { shirt: 0xff8a65, shorts: 0x00acc1, skin: 0xb9784f, hair: 0x1d1d26 },
];
export const NPC_ACCENTS = [0xff5a7a, 0x33e0c4, 0xffd23f, 0xff9d2f, 0x7aa0ff, 0xffffff];

// accessory index -> name. 0 = none (just hair)
export const ACCESSORIES = [
  { id: 'none', name: 'Bare' },
  { id: 'goggles', name: 'Goggles' },
  { id: 'ring', name: 'Swim ring' },
  { id: 'cap', name: 'Cap' },
];

/**
 * Unlocks. `test(result, stats)` runs after every finished/abandoned race.
 * result = { practice, finished, rank, time, shortcutLanded }
 */
export const UNLOCKS = [
  { id: 'pal:3', label: 'Mint palette', hint: 'Finish a race', test: (r) => r.finished },
  { id: 'pal:4', label: 'Grape palette', hint: 'Finish on the podium (top 3)', test: (r) => r.finished && !r.practice && r.rank <= 3 },
  { id: 'pal:5', label: 'Gold palette', hint: 'Win a race', test: (r) => r.finished && !r.practice && r.rank === 1 },
  { id: 'pal:6', label: 'Ninja palette', hint: 'Land the shortcut jump', test: (r) => r.shortcutLanded },
  { id: 'pal:7', label: 'Lava palette', hint: 'Finish 5 races', test: (r, s) => s.finished >= 5 },
  { id: 'acc:2', label: 'Swim ring', hint: 'Finish a practice run', test: (r) => r.finished && r.practice },
  { id: 'acc:3', label: 'Cap', hint: 'Finish in the top 5', test: (r) => r.finished && !r.practice && r.rank <= 5 },
];

export const FREE_UNLOCKS = ['pal:0', 'pal:1', 'pal:2', 'acc:0', 'acc:1'];

export function unlockHint(id) {
  return UNLOCKS.find((u) => u.id === id)?.hint ?? '';
}
