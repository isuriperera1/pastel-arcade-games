/**
 * Fidget Trading — item catalog & starting inventory generation
 *
 * Tiers: normal (2♦), glitter (5♦), butter (9♦)
 * Shared silhouettes; tiers differ by material / CSS effects.
 */

const FIDGET_TIER_COST = {
  normal: 2,
  glitter: 5,
  butter: 9,
};

/** Reusable blob silhouettes (viewBox 0 0 64 64). */
const FIDGET_SHAPES = {
  round: `
    <ellipse cx="32" cy="34" rx="22" ry="20" />
  `,
  tall: `
    <ellipse cx="32" cy="34" rx="18" ry="24" />
  `,
  wide: `
    <ellipse cx="32" cy="36" rx="26" ry="16" />
  `,
  ears: `
    <circle cx="18" cy="18" r="8" />
    <circle cx="46" cy="18" r="8" />
    <ellipse cx="32" cy="36" rx="22" ry="20" />
  `,
};

/**
 * Catalog entries: { id, name, tier, cost, svgShape, colorway }
 * colorway: { fill, accent? } — pastel fills for SVG / CSS.
 */
const FIDGET_ITEMS = [
  /* ---------- normal (cost 2) ---------- */
  {
    id: "bao-bun",
    name: "Bao Bun",
    tier: "normal",
    cost: 2,
    svgShape: "round",
    colorway: { fill: "#F2D0D3", accent: "#E8B4B8" },
  },
  {
    id: "donut",
    name: "Donut",
    tier: "normal",
    cost: 2,
    svgShape: "round",
    colorway: { fill: "#E8B4B8", accent: "#F5EFE3" },
  },
  {
    id: "strawberry",
    name: "Strawberry",
    tier: "normal",
    cost: 2,
    svgShape: "tall",
    colorway: { fill: "#E8B4B8", accent: "#7FC7C4" },
  },
  {
    id: "panda",
    name: "Panda",
    tier: "normal",
    cost: 2,
    svgShape: "ears",
    colorway: { fill: "#F5EFE3", accent: "#3A3159" },
  },
  {
    id: "cloud",
    name: "Cloud",
    tier: "normal",
    cost: 2,
    svgShape: "wide",
    colorway: { fill: "#A8DAD8", accent: "#F5EFE3" },
  },
  {
    id: "frog",
    name: "Frog",
    tier: "normal",
    cost: 2,
    svgShape: "wide",
    colorway: { fill: "#7FC7C4", accent: "#3A3159" },
  },
  {
    id: "peach",
    name: "Peach",
    tier: "normal",
    cost: 2,
    svgShape: "round",
    colorway: { fill: "#F2D0D3", accent: "#E8B4B8" },
  },
  {
    id: "egg",
    name: "Egg",
    tier: "normal",
    cost: 2,
    svgShape: "tall",
    colorway: { fill: "#F5EFE3", accent: "#B9A9D6" },
  },
  {
    id: "kitty",
    name: "Kitty",
    tier: "normal",
    cost: 2,
    svgShape: "ears",
    colorway: { fill: "#B9A9D6", accent: "#3A3159" },
  },
  {
    id: "mint-drop",
    name: "Mint Drop",
    tier: "normal",
    cost: 2,
    svgShape: "tall",
    colorway: { fill: "#A8DAD8", accent: "#7FC7C4" },
  },

  /* ---------- glitter (cost 5) ---------- */
  {
    id: "galaxy-swirl",
    name: "Galaxy Swirl",
    tier: "glitter",
    cost: 5,
    svgShape: "round",
    colorway: { fill: "#B9A9D6", accent: "#7FC7C4" },
  },
  {
    id: "sparkle-bunny",
    name: "Sparkle Bunny",
    tier: "glitter",
    cost: 5,
    svgShape: "ears",
    colorway: { fill: "#D4C9E8", accent: "#E8B4B8" },
  },
  {
    id: "crystal-bear",
    name: "Crystal Bear",
    tier: "glitter",
    cost: 5,
    svgShape: "ears",
    colorway: { fill: "#A8DAD8", accent: "#B9A9D6" },
  },
  {
    id: "rainbow-drop",
    name: "Rainbow Drop",
    tier: "glitter",
    cost: 5,
    svgShape: "tall",
    colorway: { fill: "#E8B4B8", accent: "#7FC7C4" },
  },
  {
    id: "stardust-blob",
    name: "Stardust Blob",
    tier: "glitter",
    cost: 5,
    svgShape: "wide",
    colorway: { fill: "#7FC7C4", accent: "#B9A9D6" },
  },
  {
    id: "glitter-peach",
    name: "Glitter Peach",
    tier: "glitter",
    cost: 5,
    svgShape: "round",
    colorway: { fill: "#F2D0D3", accent: "#B9A9D6" },
  },

  /* ---------- butter (cost 9) ---------- */
  {
    id: "golden-butter-bear",
    name: "Golden Butter Bear",
    tier: "butter",
    cost: 9,
    svgShape: "ears",
    colorway: { fill: "#E8D5A3", accent: "#D4B56A" },
  },
  {
    id: "honeycomb-blob",
    name: "Honeycomb Blob",
    tier: "butter",
    cost: 9,
    svgShape: "round",
    colorway: { fill: "#F5EFE3", accent: "#E8D5A3" },
  },
  {
    id: "butterscotch-cat",
    name: "Butterscotch Cat",
    tier: "butter",
    cost: 9,
    svgShape: "ears",
    colorway: { fill: "#D4B56A", accent: "#F5EFE3" },
  },
  {
    id: "melty-cream",
    name: "Melty Cream",
    tier: "butter",
    cost: 9,
    svgShape: "wide",
    colorway: { fill: "#F5EFE3", accent: "#D4B56A" },
  },
];

const FIDGET_BY_TIER = {
  normal: FIDGET_ITEMS.filter((i) => i.tier === "normal"),
  glitter: FIDGET_ITEMS.filter((i) => i.tier === "glitter"),
  butter: FIDGET_ITEMS.filter((i) => i.tier === "butter"),
};

let _fidgetInstanceSeq = 0;

function cloneFidgetItem(def) {
  _fidgetInstanceSeq += 1;
  return {
    ...def,
    colorway: { ...def.colorway },
    instanceId: `ft-${_fidgetInstanceSeq}`,
  };
}

/**
 * Weighted tier pick among tiers still affordable with `budget`.
 * ~70% normal, ~25% glitter, ~5% butter (renormalized when some tiers are too costly).
 */
function pickAffordableTier(budget) {
  const weights = [];
  if (budget >= FIDGET_TIER_COST.normal) weights.push({ tier: "normal", w: 70 });
  if (budget >= FIDGET_TIER_COST.glitter) weights.push({ tier: "glitter", w: 25 });
  if (budget >= FIDGET_TIER_COST.butter) weights.push({ tier: "butter", w: 5 });
  if (!weights.length) return null;

  const total = weights.reduce((s, x) => s + x.w, 0);
  let roll = Math.random() * total;
  for (const entry of weights) {
    roll -= entry.w;
    if (roll <= 0) return entry.tier;
  }
  return weights[weights.length - 1].tier;
}

function pickRandomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Spend ALL of a 20-diamond budget (or as close without going over).
 * Biased toward normals so inventories typically land ~7–10 items
 * (hard max is 10 at 2♦ each under a 20♦ budget; soft target 7–15 for QA).
 * Weighted picks; stop when remaining diamonds can't afford any item.
 * Returns item instances (def copies — duplicates allowed).
 */
function generateInventoryFromBudget(budget = 20) {
  const inventory = [];
  let remaining = budget;
  const minCost = FIDGET_TIER_COST.normal;
  const targetMin = 7;

  while (remaining >= minCost) {
    const itemsLeftRoom = Math.floor(remaining / minCost);
    const needMoreItems = inventory.length < targetMin && itemsLeftRoom > 1;

    let tier;
    if (needMoreItems) {
      // Reserve enough normals to approach targetMin when possible
      const reserve = Math.max(0, targetMin - inventory.length - 1) * minCost;
      const spendCap = remaining - reserve;
      if (spendCap < FIDGET_TIER_COST.glitter || Math.random() < 0.82) {
        tier = "normal";
      } else {
        tier = pickAffordableTier(Math.min(remaining, spendCap));
      }
    } else {
      tier = pickAffordableTier(remaining);
    }
    if (!tier) break;

    const pool = FIDGET_BY_TIER[tier];
    const def = pickRandomFrom(pool);
    inventory.push(cloneFidgetItem(def));
    remaining -= def.cost;
  }

  return inventory;
}

function generateStartingInventory() {
  return generateInventoryFromBudget(20);
}

function generateAIInventory() {
  return generateInventoryFromBudget(20);
}

if (typeof window !== "undefined") {
  window.FIDGET_SHAPES = FIDGET_SHAPES;
  window.FIDGET_ITEMS = FIDGET_ITEMS;
  window.FIDGET_TIER_COST = FIDGET_TIER_COST;
  window.generateStartingInventory = generateStartingInventory;
  window.generateAIInventory = generateAIInventory;
  window.cloneFidgetItem = cloneFidgetItem;
}
