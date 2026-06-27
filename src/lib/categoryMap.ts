// Cross-platform unified category taxonomy.
//
// The unified set is used for the merged "Global (KS + Indiegogo)" frontend
// views and for cross-platform filtering. Each platform keeps its own raw
// category for single-platform views; this module only normalizes both sides
// onto a shared parent.
//
// Built from the 2026-06 category census:
//   - Kickstarter: 15 parent categories
//   - Indiegogo: 35 stored categories (webrobots strings + search catalog names)
//
// Design: keep KS's 15 parents as the backbone, merge Theater+Dance (Indiegogo
// only ships them combined), and add 4 unified-only parents for Indiegogo
// concepts that have no clean KS home. Everything maps explicitly so nothing
// silently falls into "Other" except genuinely generic buckets.

export const UNIFIED_CATEGORIES = [
  'Film & Video',
  'Music',
  'Art',
  'Publishing',
  'Comics',
  'Photography',
  'Games',
  'Technology',
  'Design',
  'Fashion',
  'Food & Drink',
  'Crafts',
  'Theater & Dance',
  'Journalism & Media',
  'Health & Fitness',
  'Travel & Outdoors',
  'Community & Causes',
  'Other',
] as const;

export type UnifiedCategory = (typeof UNIFIED_CATEGORIES)[number];

export type PlatformKey = 'kickstarter' | 'indiegogo';

// Chinese display labels for unified parents (UI uses these in cn mode).
export const UNIFIED_CATEGORY_LABELS_ZH: Record<UnifiedCategory, string> = {
  'Film & Video': '影视',
  Music: '音乐',
  Art: '艺术',
  Publishing: '出版',
  Comics: '漫画',
  Photography: '摄影',
  Games: '游戏',
  Technology: '科技',
  Design: '设计',
  Fashion: '时尚',
  'Food & Drink': '美食',
  Crafts: '手工',
  'Theater & Dance': '戏剧与舞蹈',
  'Journalism & Media': '新闻媒体',
  'Health & Fitness': '健康健身',
  'Travel & Outdoors': '旅行户外',
  'Community & Causes': '社区公益',
  Other: '其他',
};

// Kickstarter parent category -> unified parent.
const KS_TO_UNIFIED: Record<string, UnifiedCategory> = {
  'film & video': 'Film & Video',
  music: 'Music',
  publishing: 'Publishing',
  games: 'Games',
  technology: 'Technology',
  art: 'Art',
  food: 'Food & Drink',
  fashion: 'Fashion',
  design: 'Design',
  comics: 'Comics',
  crafts: 'Crafts',
  photography: 'Photography',
  theater: 'Theater & Dance',
  journalism: 'Journalism & Media',
  dance: 'Theater & Dance',
};

// Indiegogo stored category -> unified parent.
// Judgment calls (hardware vs. content): Camera Gear / Audio / Phones /
// Transportation / Energy & Green Tech are all physical-product buckets, so they
// map to Technology rather than Photography/Music/Design.
const IGG_TO_UNIFIED: Record<string, UnifiedCategory> = {
  film: 'Film & Video',
  'web series & tv shows': 'Film & Video',
  music: 'Music',
  audio: 'Technology',
  art: 'Art',
  'other creations': 'Other',
  'writing & publishing': 'Publishing',
  comics: 'Comics',
  photography: 'Photography',
  'camera gear': 'Technology',
  'board & card games': 'Games',
  'video games': 'Games',
  'tabletop games': 'Games',
  ttrpg: 'Games',
  'phones & accessories': 'Technology',
  productivity: 'Technology',
  'energy & green tech': 'Technology',
  transportation: 'Technology',
  home: 'Design',
  'fashion & wearables': 'Fashion',
  accessories: 'Fashion',
  'food & beverages': 'Food & Drink',
  'dance & theater': 'Theater & Dance',
  'podcasts, blogs & vlogs': 'Journalism & Media',
  'health & fitness': 'Health & Fitness',
  wellness: 'Health & Fitness',
  'travel & outdoors': 'Travel & Outdoors',
  'human rights': 'Community & Causes',
  environment: 'Community & Causes',
  culture: 'Community & Causes',
  'local businesses': 'Community & Causes',
  education: 'Community & Causes',
  'other community projects': 'Community & Causes',
  general: 'Other',
  others: 'Other',
};

/**
 * Map a platform's raw stored category onto the shared unified parent.
 * Matching is case-insensitive and whitespace-tolerant; unknown values fall
 * back to "Other" so new upstream categories never break filtering.
 */
export function toUnifiedCategory(platform: PlatformKey, raw: string | null | undefined): UnifiedCategory {
  const key = (raw ?? '').trim().toLowerCase();
  if (!key) return 'Other';
  const table = platform === 'kickstarter' ? KS_TO_UNIFIED : IGG_TO_UNIFIED;
  return table[key] ?? 'Other';
}

export function unifiedCategoryLabel(category: UnifiedCategory, cn: boolean): string {
  return cn ? UNIFIED_CATEGORY_LABELS_ZH[category] : category;
}
