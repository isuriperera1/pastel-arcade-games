# Arcade Games

A static multi-game arcade hub meant for **GitHub Pages**. Plain HTML, CSS, and vanilla JavaScript — no build step, no frameworks, no backend.

Soft teal / lavender / cream pastels, flat geometric UI, and a shared design system so new games plug in without touching existing ones.

## Play locally

Open `index.html` in a browser, or serve the folder:

```bash
# any static server works, e.g.
npx serve .
# or
python -m http.server 8080
```

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. **Settings → Pages → Build and deployment**
3. Source: **Deploy from a branch**
4. Branch: `main` (or `master`), folder: `/ (root)`
5. Save — the site will be at `https://<user>.github.io/<repo>/`

All asset paths are relative to the repo root so root-based Pages hosting works as-is.

## Folder structure

```
/
├── index.html                 # Arcade hub (game grid)
├── README.md
├── styles/
│   └── theme.css              # Shared pastel design system
├── js/
│   ├── shell.js               # Shared top nav injector
│   └── hub.js                 # Renders cards from the registry
├── assets/                    # Optional shared SVGs / images
└── games/
    ├── games-registry.js      # ← add new games here
    ├── 2048/
    │   ├── index.html
    │   ├── style.css
    │   └── script.js
    ├── flow/
    │   ├── index.html
    │   ├── style.css
    │   ├── script.js
    │   └── levels.js
    ├── tic-tac-toe/
    ├── whack-a-mole/          # UI title: "Peek-a-Boo"
    └── crownward/             # Side-scroller path to the Grand Castle
```

## Design system (`styles/theme.css`)

Reuse these CSS custom properties in every game:

| Token        | Role                          |
|--------------|-------------------------------|
| `--teal`     | Primary accent `#7FC7C4`      |
| `--lavender` | Secondary accent `#B9A9D6`    |
| `--cream`    | Page / soft surface `#F5EFE3` |
| `--pink`     | Warm accent `#E8B4B8`         |
| `--ink`      | Text / deep accent `#3A3159`  |

Useful shared classes: `.card`, `.btn`, `.btn--primary`, `.hud`, `.stat`, `.board-wrap`, `.modal-backdrop`, `.modal-card`, `.seg`, `.page-main--game`.

## How to add a new game

Follow these steps exactly — you should **not** edit other games or hard-code the new title into `index.html`.

### 1. Create the game folder

```
games/<your-game-id>/
  index.html
  style.css
  script.js
```

Use a kebab-case `id` that matches the folder name (e.g. `snake`, `connect-four`).

### 2. Scaffold `index.html`

- Link the shared theme: `../../styles/theme.css`
- Link your game CSS: `style.css`
- Mount the shared nav (paths relative to the game folder):

```html
<div id="site-nav" data-base="../.."></div>
<script src="../../js/shell.js"></script>
<script src="script.js"></script>
```

- Wrap content in `.page` → `.page-main.page-main--game`
- Prefer theme components (`.btn`, `.hud`, `.stat`, modals) over one-off UI chrome

### 3. Register the game

Open `games/games-registry.js` and append **one** object to `GAMES_REGISTRY`:

```js
{
  id: "your-game-id",
  name: "Display Name",
  description: "One-line blurb for the hub card.",
  path: "games/your-game-id/index.html",
  iconSvg: `<svg viewBox="0 0 64 64" ...>...</svg>`,
}
```

The hub reads this array and builds the card grid automatically.

### 4. Persist scores (optional)

Use `localStorage` with a namespaced key, e.g. `arcade-games-<id>-best`. Never add a backend.

### 5. Done

Refresh the hub — your card should appear. Existing games stay untouched.

## Games included

| Game | Folder | Notes |
|------|--------|--------|
| **2048** | `games/2048` | Arrows + swipe, best score saved |
| **Flow** | `games/flow` | Rotate pipes to connect source → target; 10 levels (multi-color, locked, oneway, limited rotations, Level 10 soft time attack); stars in localStorage |
| **Tic-Tac-Toe** | `games/tic-tac-toe` | 2-player or vs AI, round scores saved |
| **Peek-a-Boo** | `games/whack-a-mole` | Timed tap game, difficulty ramps, high score saved |
| **Crownward** | `games/crownward` | Side-scroller to the Grand Castle; 30:00 timer, checkpoints, analytics in localStorage |

## Architecture notes

- **Multi-page**, not a SPA — simplest clean URLs on GitHub Pages and trivial to extend.
- **`games-registry.js`** is the only place that lists games for the hub.
- **`js/shell.js`** injects the shared header (logo, “Back to Arcade”, profile placeholder).
- **No npm / bundler** — what you push is what Pages serves.
