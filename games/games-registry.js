/**
 * =============================================================================
 * GAMES REGISTRY — single source of truth for the arcade hub
 * =============================================================================
 *
 * HOW TO ADD A NEW GAME
 * ---------------------
 * 1. Create a folder:  games/<your-game-id>/
 *    Required files inside it:
 *      - index.html   (game page; import ../../styles/theme.css + your styles)
 *      - style.css    (game-specific styles only)
 *      - script.js    (game logic)
 *
 * 2. In index.html:
 *    - Include the shared nav mount:
 *        <div id="site-nav" data-base="../.."></div>
 *        <script src="../../js/shell.js"></script>
 *    - Reuse theme classes: .page, .page-main--game, .card, .btn, .hud,
 *      .stat, .board-wrap, .modal-backdrop, .modal-card, .seg, etc.
 *    - Use CSS variables from theme.css (--teal, --lavender, --cream,
 *      --pink, --ink, --radius-*, --shadow-*) for any custom colors.
 *
 * 3. Add ONE object to the GAMES_REGISTRY array below with:
 *      id          — unique kebab-case id (must match folder name)
 *      name        — display title on the hub card
 *      description — one-line blurb shown under the title
 *      path        — relative path from repo root to the game's index.html
 *      iconSvg     — inline SVG string (flat pastel geometric icon, ~64×64 viewBox)
 *
 * 4. That's it. The hub (index.html) renders cards from this array automatically.
 *    Do NOT edit other game folders or the hub HTML to list your game.
 *
 * Metadata shape:
 *   {
 *     id: string,
 *     name: string,
 *     description: string,
 *     path: string,       // e.g. "games/2048/index.html"
 *     iconSvg: string     // full <svg>...</svg> markup
 *   }
 * =============================================================================
 */

const GAMES_REGISTRY = [
  {
    id: "2048",
    name: "2048",
    description: "Slide and merge pastel tiles until you reach 2048.",
    path: "games/2048/index.html",
    iconSvg: `
      <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect width="64" height="64" rx="14" fill="#7FC7C4"/>
        <rect x="8" y="8" width="20" height="20" rx="6" fill="#F5EFE3"/>
        <rect x="36" y="8" width="20" height="20" rx="6" fill="#B9A9D6"/>
        <rect x="8" y="36" width="20" height="20" rx="6" fill="#E8B4B8"/>
        <rect x="36" y="36" width="20" height="20" rx="6" fill="#3A3159"/>
        <text x="46" y="50" text-anchor="middle" font-size="11" font-family="Quicksand,sans-serif" font-weight="700" fill="#F5EFE3">2</text>
      </svg>
    `,
  },
  {
    id: "memory-match",
    name: "Memory Match",
    description: "Flip cards and find matching pastel pairs.",
    path: "games/memory-match/index.html",
    iconSvg: `
      <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect width="64" height="64" rx="14" fill="#B9A9D6"/>
        <rect x="10" y="12" width="20" height="28" rx="6" fill="#F5EFE3" transform="rotate(-8 20 26)"/>
        <rect x="34" y="14" width="20" height="28" rx="6" fill="#7FC7C4" transform="rotate(10 44 28)"/>
        <circle cx="20" cy="26" r="5" fill="#E8B4B8"/>
        <circle cx="44" cy="28" r="5" fill="#3A3159"/>
      </svg>
    `,
  },
  {
    id: "tic-tac-toe",
    name: "Tic-Tac-Toe",
    description: "Classic XO — play a friend or a gentle AI.",
    path: "games/tic-tac-toe/index.html",
    iconSvg: `
      <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect width="64" height="64" rx="14" fill="#E8B4B8"/>
        <rect x="20" y="10" width="6" height="44" rx="3" fill="#3A3159" opacity="0.2"/>
        <rect x="38" y="10" width="6" height="44" rx="3" fill="#3A3159" opacity="0.2"/>
        <rect x="10" y="20" width="44" height="6" rx="3" fill="#3A3159" opacity="0.2"/>
        <rect x="10" y="38" width="44" height="6" rx="3" fill="#3A3159" opacity="0.2"/>
        <circle cx="18" cy="18" r="7" fill="none" stroke="#7FC7C4" stroke-width="4"/>
        <path d="M38 38 L50 50 M50 38 L38 50" stroke="#3A3159" stroke-width="4" stroke-linecap="round"/>
      </svg>
    `,
  },
  {
    id: "whack-a-mole",
    name: "Peek-a-Boo",
    description: "Tap popping shapes before they duck away.",
    path: "games/whack-a-mole/index.html",
    iconSvg: `
      <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect width="64" height="64" rx="14" fill="#7FC7C4"/>
        <ellipse cx="32" cy="48" rx="18" ry="8" fill="#3A3159" opacity="0.25"/>
        <ellipse cx="32" cy="46" rx="14" ry="6" fill="#F5EFE3"/>
        <rect x="22" y="22" width="20" height="24" rx="10" fill="#B9A9D6"/>
        <circle cx="27" cy="32" r="2.5" fill="#3A3159"/>
        <circle cx="37" cy="32" r="2.5" fill="#3A3159"/>
        <path d="M28 38 Q32 42 36 38" stroke="#3A3159" stroke-width="2" fill="none" stroke-linecap="round"/>
      </svg>
    `,
  },
  {
    id: "crownward",
    name: "Crownward",
    description: "Walk, jump, and climb from village to the Grand Castle.",
    path: "games/crownward/index.html",
    iconSvg: `
      <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect width="64" height="64" rx="14" fill="#B9A9D6"/>
        <rect x="8" y="38" width="14" height="16" rx="2" fill="#E8B4B8"/>
        <rect x="26" y="28" width="16" height="26" rx="2" fill="#7FC7C4"/>
        <rect x="40" y="18" width="16" height="36" rx="2" fill="#3A3159"/>
        <path d="M42 18 L46 10 L50 18 L54 10 L56 18" fill="#F5EFE3"/>
        <circle cx="48" cy="12" r="2.5" fill="#E8B4B8"/>
      </svg>
    `,
  },
];

/* Expose for non-module script tags */
if (typeof window !== "undefined") {
  window.GAMES_REGISTRY = GAMES_REGISTRY;
}
