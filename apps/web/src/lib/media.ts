/** Curated free Unsplash 3D cartoon / NFT-style characters for drop covers */

const coverQ = "auto=format&fit=crop&w=1200&q=85";
const detailQ = "auto=format&fit=crop&w=1600&q=85";

function u(id: string, q = coverQ) {
  return `https://images.unsplash.com/photo-${id}?${q}`;
}

/** Ten unique HD 3D cartoon characters — never reuse across seeded drops */
export const CARTOON_CHARACTERS = {
  /** Homepage hero background — 4K UHD */
  heroBg: "/hero-bg.webp",
  heroBgPng: "/hero-bg.png",
} as const;

const COVER_IDS = [
  "1699524826369-57870e627c43",
  "1636622433525-127afdf3662d",
  "1638803040283-7a5ffd48dad5",
  "1639503611585-1054af5dbfab",
  "1728729729215-00ae703063ff",
  "1740252117012-bb53ad05e370",
  "1740252117013-4fb21771e7ca",
  "1740252117027-4275d3f84385",
  "1759950616527-15c2818f2f3c",
  "1759950616453-4f4a161c0c8d",
] as const;

/** Larger variants for drop detail hero — same 10, unique */
export const DROP_DETAIL_FALLBACKS = COVER_IDS.map((id) => u(id, detailQ));

/** Kept for hero / brand atmosphere (not drop cards) */
export const MEDIA_3D = {
  heroCubes:
    "https://images.unsplash.com/photo-1697388685394-9b241ec81374?auto=format&fit=crop&w=1600&q=70",
} as const;

/** Ten unique HD covers for See all / wallet / detail fallbacks */
export const DROP_COVER_FALLBACKS = COVER_IDS.map((id) => u(id, coverQ));
