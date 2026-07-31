/** Curated free Unsplash cartoon characters for drop covers */

const coverQ = "auto=format&fit=crop&w=800&q=75";
const detailQ = "auto=format&fit=crop&w=1200&q=75";

export const CARTOON_CHARACTERS = {
  /** Local transparent hero mascot (background removed) */
  hoodieAvatar: "/hero-character.png",
  /** Soft 3D character, red nose, black backdrop */
  redNose: `https://images.unsplash.com/photo-1699524826369-57870e627c43?${coverQ}`,
  /** Blue & white 3D cartoon figure */
  blueBuddy: `https://images.unsplash.com/photo-1592561199818-6b69d3d1d6e2?${coverQ}`,
  /** Running cartoon character with mask */
  runner: `https://images.unsplash.com/photo-1637858868799-7f26a0640eb6?${coverQ}`,
  /** Yellow duck cartoon character */
  duck: `https://images.unsplash.com/photo-1628260412297-a3377e45006f?${coverQ}`,
  /** Orange cartoon with backpack */
  orangePack: `https://images.unsplash.com/photo-1639628735078-ed2f038a193e?${coverQ}`,
  /** Cute white/brown robot toy character */
  robot: `https://images.unsplash.com/photo-1620428268482-cf1851a36764?${coverQ}`,
  /** Yellow character toy */
  yellowBot: `https://images.unsplash.com/photo-1593085512500-5d55148d6f0d?${coverQ}`,
  /** Hoodie toy character */
  hoodie: `https://images.unsplash.com/photo-1531214159280-079b95d26139?${coverQ}`,
} as const;

/** Larger variants for drop detail hero */
export const DROP_DETAIL_FALLBACKS = [
  `https://images.unsplash.com/photo-1699524826369-57870e627c43?${detailQ}`,
  `https://images.unsplash.com/photo-1592561199818-6b69d3d1d6e2?${detailQ}`,
  `https://images.unsplash.com/photo-1637858868799-7f26a0640eb6?${detailQ}`,
] as const;

/** Kept for hero / brand atmosphere (not drop cards) */
export const MEDIA_3D = {
  heroCubes:
    "https://images.unsplash.com/photo-1697388685394-9b241ec81374?auto=format&fit=crop&w=1600&q=70",
} as const;

/** Rotating covers for Open drops / wallet / detail fallbacks */
export const DROP_COVER_FALLBACKS = [
  CARTOON_CHARACTERS.redNose,
  CARTOON_CHARACTERS.blueBuddy,
  CARTOON_CHARACTERS.runner,
  CARTOON_CHARACTERS.duck,
  CARTOON_CHARACTERS.orangePack,
  CARTOON_CHARACTERS.robot,
  CARTOON_CHARACTERS.yellowBot,
  CARTOON_CHARACTERS.hoodie,
] as const;
