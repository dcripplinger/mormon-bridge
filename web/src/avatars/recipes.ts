/**
 * DiceBear generation recipes for curated seat avatars.
 *
 * Humans: style `avataaars` (https://api.dicebear.com/10.x/avataaars/svg)
 * Bots:   style `bottts`    (https://api.dicebear.com/10.x/bottts/svg)
 *
 * Shared human defaults (merge under each entry unless overridden):
 *   accessoriesProbability=0
 *   clothesGraphicProbability=0
 *   facialHairProbability=0
 *   eyesVariant=default
 *   mouthVariant=smile
 *   eyebrowsVariant=defaultNatural
 *   backgroundColor=e8e6e1
 *
 * To regenerate one avatar, build a query string from the shared defaults +
 * that entry's `params`, fetch the SVG, and overwrite
 * `src/assets/avatars/{human|bot}/{id}.svg`.
 *
 * Catalog display order (MMFF repeating) lives in `src/avatars/catalog.ts`.
 */

export type DiceBearStyle = 'avataaars' | 'bottts'

export interface AvatarRecipe {
  id: string
  style: DiceBearStyle
  /** Short note for humans (gender presentation used for MMFF ordering). */
  note?: string
  params: Record<string, string | number>
}

export const HUMAN_AVATAR_DEFAULTS: Record<string, string | number> = {
  accessoriesProbability: 0,
  clothesGraphicProbability: 0,
  facialHairProbability: 0,
  eyesVariant: 'default',
  mouthVariant: 'smile',
  eyebrowsVariant: 'defaultNatural',
  backgroundColor: 'e8e6e1',
}

/** File-id order (h01…h12), not catalog display order. */
export const HUMAN_AVATAR_RECIPES: AvatarRecipe[] = [
  {
    id: 'h01',
    style: 'avataaars',
    note: 'male — short dark',
    params: {
      seed: 'h01',
      topVariant: 'shortFlat',
      hairColor: '2c1b18',
      skinColor: 'f2d3b1',
      clothesVariant: 'blazerAndShirt',
      clothesColor: '51636f',
    },
  },
  {
    id: 'h02',
    style: 'avataaars',
    note: 'female — bob',
    params: {
      seed: 'h02',
      topVariant: 'bob',
      hairColor: '4a312c',
      skinColor: 'd08b5b',
      clothesVariant: 'collarAndSweater',
      clothesColor: '6b7f71',
    },
  },
  {
    id: 'h03',
    style: 'avataaars',
    note: 'female — straight auburn',
    params: {
      seed: 'h03',
      topVariant: 'straight01',
      hairColor: 'b58143',
      skinColor: 'ae5d29',
      clothesVariant: 'shirtCrewNeck',
      clothesColor: '5c6b7a',
    },
  },
  {
    id: 'h04',
    style: 'avataaars',
    note: 'male — short curly',
    params: {
      seed: 'h04',
      topVariant: 'shortCurly',
      hairColor: '1c1c1c',
      skinColor: '614335',
      clothesVariant: 'hoodie',
      clothesColor: '3d4f5f',
    },
  },
  {
    id: 'h05',
    style: 'avataaars',
    note: 'male — silver long + matching beard',
    params: {
      seed: 'h05',
      topVariant: 'longButNotTooLong',
      hairColor: '8a8a8a',
      skinColor: 'edb98a',
      clothesVariant: 'blazerAndSweater',
      clothesColor: '7a6a58',
      facialHairProbability: 100,
      facialHairVariant: 'beardMedium',
      facialHairColor: '8a8a8a',
    },
  },
  {
    id: 'h06',
    style: 'avataaars',
    note: 'male — side part + light beard',
    params: {
      seed: 'h06',
      topVariant: 'theCaesarAndSidePart',
      hairColor: '4a312c',
      skinColor: 'fd9841',
      clothesVariant: 'shirtVNeck',
      clothesColor: '5e6d5a',
      facialHairProbability: 100,
      facialHairVariant: 'beardLight',
      facialHairColor: '4a312c',
    },
  },
  {
    id: 'h07',
    style: 'avataaars',
    note: 'female — bun, closed-mouth smile',
    params: {
      seed: 'h07',
      topVariant: 'bun',
      hairColor: '2c1b18',
      skinColor: 'f2d3b1',
      clothesVariant: 'collarAndSweater',
      clothesColor: '8a6d5a',
      mouthVariant: 'default',
    },
  },
  {
    id: 'h08',
    style: 'avataaars',
    note: 'male — waved, closed-mouth smile',
    params: {
      seed: 'h08',
      topVariant: 'shortWaved',
      hairColor: 'a55728',
      skinColor: 'c68642',
      clothesVariant: 'blazerAndShirt',
      clothesColor: '4f5d73',
      mouthVariant: 'default',
    },
  },
  {
    id: 'h09',
    style: 'avataaars',
    note: 'female — blonde',
    params: {
      seed: 'h09',
      topVariant: 'straight02',
      hairColor: 'd6b370',
      skinColor: 'ffdbb4',
      clothesVariant: 'shirtScoopNeck',
      clothesColor: '6d7a68',
      eyesVariant: 'happy',
    },
  },
  {
    id: 'h10',
    style: 'avataaars',
    note: 'female — curly dark, closed mouth',
    params: {
      seed: 'h10',
      topVariant: 'curly',
      hairColor: '1c1c1c',
      skinColor: '8d5524',
      clothesVariant: 'hoodie',
      clothesColor: '5a4e44',
      mouthVariant: 'default',
    },
  },
  {
    id: 'h11',
    style: 'avataaars',
    note: 'female — long dark, closed-mouth smile',
    params: {
      seed: 'h11',
      topVariant: 'miaWallace',
      hairColor: '4a312c',
      skinColor: 'f2d3b1',
      clothesVariant: 'blazerAndSweater',
      clothesColor: '6b5b4a',
      mouthVariant: 'default',
    },
  },
  {
    id: 'h12',
    style: 'avataaars',
    note: 'male — full beard, closed mouth',
    params: {
      seed: 'h12',
      topVariant: 'shortRound',
      hairColor: '724133',
      skinColor: 'ae5d29',
      clothesVariant: 'shirtCrewNeck',
      clothesColor: '4a5c6a',
      facialHairProbability: 100,
      facialHairVariant: 'beardMedium',
      facialHairColor: '724133',
      mouthVariant: 'default',
    },
  },
]

/** File-id order (b01…b08). */
export const BOT_AVATAR_RECIPES: AvatarRecipe[] = [
  {
    id: 'b01',
    style: 'bottts',
    note: 'green antenna',
    params: {
      seed: 'b01',
      headVariant: 'round01',
      eyesVariant: 'happy',
      mouthVariant: 'smile01',
      topVariant: 'antenna',
      sidesVariant: 'round',
      textureProbability: 0,
      baseColor: '2f9e6b',
      backgroundColor: 'd9f2e5',
    },
  },
  {
    id: 'b02',
    style: 'bottts',
    note: 'blue robocop',
    params: {
      seed: 'b02',
      headVariant: 'square01',
      eyesVariant: 'robocop',
      mouthVariant: 'grill02',
      topVariant: 'lights',
      sidesVariant: 'square',
      textureProbability: 0,
      baseColor: '3b6ea5',
      backgroundColor: 'd6e4f5',
    },
  },
  {
    id: 'b03',
    style: 'bottts',
    note: 'orange radar + circuits',
    params: {
      seed: 'b03',
      headVariant: 'round02',
      eyesVariant: 'sensor',
      mouthVariant: 'diagram',
      topVariant: 'radar',
      sidesVariant: 'antenna01',
      textureProbability: 40,
      textureVariant: 'circuits',
      baseColor: 'c47a2c',
      backgroundColor: 'f5e6d2',
    },
  },
  {
    id: 'b04',
    style: 'bottts',
    note: 'purple glow bulb',
    params: {
      seed: 'b04',
      headVariant: 'square04',
      eyesVariant: 'glow',
      mouthVariant: 'square01',
      topVariant: 'glowingBulb01',
      sidesVariant: 'cables02',
      textureProbability: 0,
      baseColor: '7b4ea3',
      backgroundColor: 'ebe0f5',
    },
  },
  {
    id: 'b05',
    style: 'bottts',
    note: 'red horns',
    params: {
      seed: 'b05',
      headVariant: 'square02',
      eyesVariant: 'shade01',
      mouthVariant: 'bite',
      topVariant: 'horns',
      sidesVariant: 'squareAssymetric',
      textureProbability: 0,
      baseColor: 'b54040',
      backgroundColor: 'f5d9d9',
    },
  },
  {
    id: 'b06',
    style: 'bottts',
    note: 'teal pyramid',
    params: {
      seed: 'b06',
      headVariant: 'round01',
      eyesVariant: 'eva',
      mouthVariant: 'smile02',
      topVariant: 'pyramid',
      sidesVariant: 'antenna02',
      textureProbability: 30,
      textureVariant: 'dots',
      baseColor: '2f7f8a',
      backgroundColor: 'd5eef0',
    },
  },
  {
    id: 'b07',
    style: 'bottts',
    note: 'olive cables, no top',
    params: {
      seed: 'b07',
      headVariant: 'square03',
      eyesVariant: 'frame2',
      mouthVariant: 'grill01',
      topProbability: 0,
      sidesVariant: 'cables01',
      textureProbability: 0,
      baseColor: '6d6a4a',
      backgroundColor: 'ebe8d8',
    },
  },
  {
    id: 'b08',
    style: 'bottts',
    note: 'slate bulb, no sides',
    params: {
      seed: 'b08',
      headVariant: 'round02',
      eyesVariant: 'roundFrame02',
      mouthVariant: 'square02',
      topVariant: 'bulb01',
      sidesProbability: 0,
      textureProbability: 0,
      baseColor: '4a5c6a',
      backgroundColor: 'dce3e8',
    },
  },
]

/** Merge human defaults with per-avatar overrides (overrides win). */
export function humanRecipeParams(recipe: AvatarRecipe): Record<string, string | number> {
  return { ...HUMAN_AVATAR_DEFAULTS, ...recipe.params }
}
