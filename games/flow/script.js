/**
 * Flow — rotate pipes to connect source light(s) to matching target(s).
 * Levels 1–10 playable (Parts 1–3).
 *
 * Oneway tiles: two ports like straight (opposite) or curve (adjacent).
 * flowDirection "A-to-B" means flow may enter from A and leave via B only.
 * Base at rotation 0 is always N-to-S (straight-like) or N-to-E (curve-like);
 * rotating the tile rotates connections and flowDirection together.
 *
 * Limited rotations: optional maxRotations; each click increments
 * rotationsUsed and locks the tile when the budget is spent.
 */
(function () {
  const TOTAL_LEVELS = 10;
  const UNLOCKED_THROUGH = 10;
  const STARS_KEY = (n) => `arcade-games-flow-level-${n}-stars`;
  const FLOW_KEY_PREFIX = "arcade-games-flow-";

  const DIR = { N: 0, E: 1, S: 2, W: 3 };
  const DIR_NAMES = ["N", "E", "S", "W"];

  /** Neighbor delta for each direction index */
  const DELTA = [
    [-1, 0], // N
    [0, 1], // E
    [1, 0], // S
    [0, -1], // W
  ];

  const OPPOSITE = [DIR.S, DIR.W, DIR.N, DIR.E];

  /* -------------------------------------------------------------------- */
  /* Connections                                                          */
  /* -------------------------------------------------------------------- */

  /**
   * Base openings at rotation 0 (N, E, S, W).
   * Source/target: rotation picks the single open side (not a geometric spin
   * of a multi-arm piece — see computeConnections).
   *
   * Oneway is not in BASE — ports come from flowDirection (see below).
   * Straight-like oneway (opposite sides) mirrors `straight` geometry;
   * curve-like oneway (adjacent sides) mirrors `curve` geometry.
   */
  const BASE = {
    empty: [false, false, false, false],
    straight: [true, false, true, false], // N–S
    curve: [true, true, false, false], // N–E
    tjunction: [true, true, false, true], // N, E, W
  };

  function parseFlowDirection(fd) {
    if (!fd || typeof fd !== "string") return null;
    const parts = fd.split("-to-");
    if (parts.length !== 2) return null;
    const entry = DIR[parts[0]];
    const exit = DIR[parts[1]];
    if (entry === undefined || exit === undefined || entry === exit) return null;
    return { entry, exit };
  }

  function formatFlowDirection(entry, exit) {
    return `${DIR_NAMES[entry]}-to-${DIR_NAMES[exit]}`;
  }

  /** Rotate a cardinal direction index `steps` × 90° clockwise. */
  function rotateDirIndex(d, steps) {
    const t = ((steps % 4) + 4) % 4;
    return (d + t) % 4;
  }

  function rotateFlowDirection(fd, steps) {
    const parsed = parseFlowDirection(fd);
    if (!parsed) return fd;
    return formatFlowDirection(
      rotateDirIndex(parsed.entry, steps),
      rotateDirIndex(parsed.exit, steps)
    );
  }

  /**
   * Rotate a [N,E,S,W] boolean mask 90° clockwise `times` times.
   * N→E→S→W→N
   */
  function rotateMask(mask, times) {
    const t = ((times % 4) + 4) % 4;
    const out = mask.slice();
    for (let i = 0; i < t; i++) {
      const [n, e, s, w] = out;
      out[0] = w;
      out[1] = n;
      out[2] = e;
      out[3] = s;
    }
    return out;
  }

  /**
   * @param {string} type
   * @param {0|90|180|270|number} rotation
   * @param {string} [flowDirection] required for oneway
   * @returns {[boolean,boolean,boolean,boolean]} [N,E,S,W]
   */
  function computeConnections(type, rotation, flowDirection) {
    const steps = ((Number(rotation) / 90) % 4 + 4) % 4;

    if (type === "empty") {
      return [false, false, false, false];
    }

    if (type === "source" || type === "target") {
      // Exactly one fixed side: rotation 0=N, 90=E, 180=S, 270=W
      const side = steps;
      const conn = [false, false, false, false];
      conn[side] = true;
      return conn;
    }

    if (type === "oneway") {
      // Ports from flowDirection (already in current orientation).
      // rotation is kept in sync when the player turns the tile; callers
      // that only pass rotation must also pass the matching flowDirection.
      const parsed = parseFlowDirection(flowDirection);
      if (!parsed) return [false, false, false, false];
      const conn = [false, false, false, false];
      conn[parsed.entry] = true;
      conn[parsed.exit] = true;
      return conn;
    }

    const base = BASE[type];
    if (!base) return [false, false, false, false];
    return rotateMask(base, steps);
  }

  /* -------------------------------------------------------------------- */
  /* Path validation                                                      */
  /* -------------------------------------------------------------------- */

  /**
   * Can flow leave `tile` in direction `d`?
   * Oneway: only via the exit side (entry is inbound-only).
   */
  function canLeave(tile, d) {
    if (!tile.connections[d]) return false;
    if (tile.type === "oneway") {
      const parsed = parseFlowDirection(tile.flowDirection);
      if (!parsed) return false;
      return d === parsed.exit;
    }
    return true;
  }

  /**
   * Can flow enter `tile` from side `entrySide` (the side on this tile)?
   * Oneway: only via the flowDirection entry.
   */
  function canEnter(tile, entrySide) {
    if (!tile.connections[entrySide]) return false;
    if (tile.type === "oneway") {
      const parsed = parseFlowDirection(tile.flowDirection);
      if (!parsed) return false;
      return entrySide === parsed.entry;
    }
    return true;
  }

  /**
   * Multi-color BFS. Each source reaches only the target with the same
   * colorId. Tiles visited by one color are reserved so paths cannot share.
   * Oneway tiles enforce entry/exit direction.
   * @param {ReturnType<typeof buildGrid>} grid
   * @returns {boolean} true when every color pair is solved
   */
  function checkSolved(grid) {
    const { rows, cols, cells } = grid;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells[r][c].flowing = false;
        cells[r][c].flowColorId = -1;
      }
    }

    /** @type {Array<typeof cells[0][0]>} */
    const sources = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (cells[r][c].type === "source") sources.push(cells[r][c]);
      }
    }
    if (!sources.length) return false;

    /** @type {Set<string>} tiles reserved by a completed color path */
    const used = new Set();
    let allOk = true;

    // Stable order by colorId then position
    sources.sort((a, b) => a.colorId - b.colorId || a.row - b.row || a.col - b.col);

    for (const start of sources) {
      const colorId = start.colorId;
      const visited = new Set();
      const queue = [start];
      const startKey = `${start.row},${start.col}`;
      visited.add(startKey);

      /** @type {Map<string, string|null>} */
      const parent = new Map();
      parent.set(startKey, null);

      let targetTile = null;

      while (queue.length) {
        const tile = queue.shift();
        if (tile.type === "target" && tile.colorId === colorId) {
          targetTile = tile;
          break;
        }

        for (let d = 0; d < 4; d++) {
          if (!canLeave(tile, d)) continue;
          const [dr, dc] = DELTA[d];
          const nr = tile.row + dr;
          const nc = tile.col + dc;
          if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;

          const neighbor = cells[nr][nc];
          const key = `${nr},${nc}`;
          if (visited.has(key)) continue;
          if (neighbor.type === "empty") continue;
          if (used.has(key) && key !== startKey) continue;

          // Other colors' terminals are off-limits
          if (
            (neighbor.type === "source" || neighbor.type === "target") &&
            neighbor.colorId !== colorId
          ) {
            continue;
          }

          const entrySide = OPPOSITE[d];
          // Mutual ports + oneway entry rule
          if (!neighbor.connections[entrySide]) continue;
          if (!canEnter(neighbor, entrySide)) continue;

          visited.add(key);
          parent.set(key, `${tile.row},${tile.col}`);
          queue.push(neighbor);
        }
      }

      if (!targetTile) {
        // Partial feedback: light reachable tiles for this color (not reserved)
        for (const key of visited) {
          const [rr, cc] = key.split(",").map(Number);
          const t = cells[rr][cc];
          if (t.flowColorId < 0) {
            t.flowing = true;
            t.flowColorId = colorId;
          }
        }
        allOk = false;
        continue;
      }

      // Reconstruct path and reserve it
      const pathKeys = [];
      let cur = `${targetTile.row},${targetTile.col}`;
      while (cur) {
        pathKeys.push(cur);
        cur = parent.get(cur) || null;
      }

      for (const key of pathKeys) {
        used.add(key);
        const [rr, cc] = key.split(",").map(Number);
        const t = cells[rr][cc];
        t.flowing = true;
        t.flowColorId = colorId;
      }
    }

    return allOk;
  }

  /* -------------------------------------------------------------------- */
  /* DOM refs                                                             */
  /* -------------------------------------------------------------------- */

  const selectScreen = document.getElementById("select-screen");
  const playScreen = document.getElementById("play-screen");
  const levelGridEl = document.getElementById("level-grid");
  const levelMapTrail = document.getElementById("level-map-trail");
  const flowGridEl = document.getElementById("flow-grid");
  const hudLevel = document.getElementById("hud-level");
  const hudMoves = document.getElementById("hud-moves");
  const hudPar = document.getElementById("hud-par");
  const hudTimerStat = document.getElementById("hud-timer-stat");
  const hudTimer = document.getElementById("hud-timer");
  const levelNameEl = document.getElementById("level-name");
  const completeModal = document.getElementById("complete-modal");
  const completeCard = document.getElementById("complete-card");
  const completeMsg = document.getElementById("complete-msg");
  const completeStars = document.getElementById("complete-stars");
  const perfectBadge = document.getElementById("perfect-badge");
  const btnNext = document.getElementById("btn-next");
  const btnReplay = document.getElementById("btn-replay");
  const btnReplayModal = document.getElementById("btn-replay-modal");
  const btnLevels = document.getElementById("btn-levels");
  const btnResetProgress = document.getElementById("btn-reset-progress");

  /** @type {ReturnType<typeof buildGrid>|null} */
  let grid = null;
  let currentLevelId = 1;
  let moveCount = 0;
  let solved = false;
  /** @type {Map<string, HTMLElement>} */
  const tileEls = new Map();

  /** Soft timer (Level 10) */
  let timerInterval = null;
  let levelStartMs = 0;
  let elapsedSec = 0;

  /* -------------------------------------------------------------------- */
  /* Stars / storage                                                      */
  /* -------------------------------------------------------------------- */

  function getBestStars(levelId) {
    const n = Number(localStorage.getItem(STARS_KEY(levelId)) || 0);
    return Number.isFinite(n) ? Math.max(0, Math.min(3, n)) : 0;
  }

  function saveBestStars(levelId, stars) {
    const prev = getBestStars(levelId);
    if (stars > prev) {
      localStorage.setItem(STARS_KEY(levelId), String(stars));
    }
  }

  function clearAllFlowProgress() {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(FLOW_KEY_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  }

  function starsForMoves(moves, par) {
    if (moves <= par) return 3;
    if (moves <= par * 1.5) return 2;
    return 1;
  }

  function starMarkup(count) {
    let html = "";
    for (let i = 1; i <= 3; i++) {
      html += `<span class="star${i <= count ? "" : " star--empty"}">${
        i <= count ? "★" : "☆"
      }</span>`;
    }
    return html;
  }

  /* -------------------------------------------------------------------- */
  /* Soft timer                                                           */
  /* -------------------------------------------------------------------- */

  function formatTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  }

  function stopTimer() {
    if (timerInterval) {
      clearInterval(timerInterval);
      timerInterval = null;
    }
  }

  function updateTimerDisplay() {
    if (hudTimer) hudTimer.textContent = formatTime(elapsedSec);
  }

  function startTimer() {
    stopTimer();
    levelStartMs = Date.now();
    elapsedSec = 0;
    updateTimerDisplay();
    timerInterval = window.setInterval(() => {
      elapsedSec = Math.floor((Date.now() - levelStartMs) / 1000);
      updateTimerDisplay();
    }, 250);
  }

  function syncTimerHud(levelDef) {
    const show = !!(levelDef && levelDef.perfectTime != null);
    if (hudTimerStat) {
      hudTimerStat.classList.toggle("is-hidden", !show);
      hudTimerStat.setAttribute("aria-hidden", show ? "false" : "true");
    }
    if (show) startTimer();
    else stopTimer();
  }

  /* -------------------------------------------------------------------- */
  /* Level select                                                         */
  /* -------------------------------------------------------------------- */

  /** Snake order for the progression map: 1–5 L→R, then 6–10 R→L. */
  function mapSlotIndex(levelNum) {
    if (levelNum <= 5) return levelNum - 1;
    return 5 + (10 - levelNum);
  }

  function renderMapTrail() {
    if (!levelMapTrail) return;
    // Thin pastel polyline through node centers in play order 1→10
    const positions = [];
    for (let n = 1; n <= TOTAL_LEVELS; n++) {
      const slot = mapSlotIndex(n);
      const row = Math.floor(slot / 5);
      const colInRow = slot % 5;
      const col = row === 0 ? colInRow : 4 - colInRow;
      // Percent centers of a 5-col × 2-row grid
      const x = ((col + 0.5) / 5) * 100;
      const y = ((row + 0.5) / 2) * 100;
      positions.push(`${x},${y}`);
    }
    levelMapTrail.innerHTML = `
      <svg class="level-map__svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <polyline
          class="level-map__line"
          fill="none"
          points="${positions.join(" ")}"
        />
      </svg>`;
  }

  function renderLevelSelect() {
    levelGridEl.innerHTML = "";
    renderMapTrail();

    // Render in snake visual order so DOM matches the trail layout
    const order = [1, 2, 3, 4, 5, 10, 9, 8, 7, 6];
    order.forEach((n) => {
      const unlocked = n <= UNLOCKED_THROUGH;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "level-card";
      btn.setAttribute("role", "listitem");
      btn.disabled = !unlocked;
      btn.setAttribute(
        "aria-label",
        unlocked ? `Level ${n}` : `Level ${n}, locked`
      );

      const best = unlocked ? getBestStars(n) : 0;
      btn.innerHTML = `
        <span class="level-card__num">${n}</span>
        <span class="level-card__stars" aria-hidden="true">${
          unlocked ? starMarkup(best) : ""
        }</span>
        ${
          unlocked
            ? ""
            : `<span class="level-card__lock" aria-hidden="true">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor" opacity="0.85"/>
                  <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
                </svg>
              </span>`
        }
      `;

      if (unlocked) {
        btn.addEventListener("click", () => loadLevel(n));
      }
      levelGridEl.appendChild(btn);
    });
  }

  function showSelect() {
    solved = false;
    stopTimer();
    closeCompleteModal();
    playScreen.classList.add("is-hidden");
    selectScreen.classList.remove("is-hidden");
    renderLevelSelect();
  }

  function showPlay() {
    selectScreen.classList.add("is-hidden");
    playScreen.classList.remove("is-hidden");
  }

  /* -------------------------------------------------------------------- */
  /* Grid build / render                                                  */
  /* -------------------------------------------------------------------- */

  function getLevelDef(id) {
    const levels = window.FLOW_LEVELS || [];
    return levels.find((l) => l.id === id) || null;
  }

  function buildGrid(levelDef) {
    const { rows, cols, tiles } = levelDef;
    /** @type {Array<Array<object>>} */
    const cells = [];

    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        row.push({
          type: "empty",
          rotation: 0,
          visualRotation: 0,
          connections: [false, false, false, false],
          locked: false,
          maxRotations: null,
          rotationsUsed: 0,
          colorId: 0,
          flowColorId: -1,
          flowDirection: null,
          flowing: false,
          row: r,
          col: c,
        });
      }
      cells.push(row);
    }

    tiles.forEach((t) => {
      const cell = cells[t.row][t.col];
      cell.type = t.type;
      cell.rotation = t.rotation;
      cell.visualRotation = t.rotation;
      cell.locked = !!t.locked;
      cell.maxRotations =
        t.maxRotations != null && t.maxRotations >= 0
          ? Number(t.maxRotations)
          : null;
      cell.rotationsUsed = 0;
      cell.colorId = t.colorId != null ? t.colorId : 0;
      cell.flowDirection = t.flowDirection || null;
      cell.connections = computeConnections(
        t.type,
        t.rotation,
        cell.flowDirection
      );
      cell.flowing = false;
      cell.flowColorId = -1;
    });

    return {
      rows,
      cols,
      cells,
      par: levelDef.par,
      name: levelDef.name,
      id: levelDef.id,
      perfectTime:
        levelDef.perfectTime != null ? Number(levelDef.perfectTime) : null,
    };
  }

  function pipePathForBase(type) {
    // Drawn at rotation 0; CSS transform rotates the whole SVG group.
    const c = 50;
    const edge = { N: [50, 0], E: [100, 50], S: [50, 100], W: [0, 50] };

    if (type === "straight") {
      return `M ${edge.N[0]} ${edge.N[1]} L ${c} ${c} L ${edge.S[0]} ${edge.S[1]}`;
    }
    if (type === "curve") {
      return `M ${edge.N[0]} ${edge.N[1]} L ${c} ${c} L ${edge.E[0]} ${edge.E[1]}`;
    }
    if (type === "tjunction") {
      return `M ${edge.W[0]} ${edge.W[1]} L ${c} ${c} L ${edge.E[0]} ${edge.E[1]} M ${c} ${c} L ${edge.N[0]} ${edge.N[1]}`;
    }
    return "";
  }

  function stubToward(side) {
    const edge = [
      [50, 0],
      [100, 50],
      [50, 100],
      [0, 50],
    ][side];
    return `M 50 50 L ${edge[0]} ${edge[1]}`;
  }

  /** Oneway pipe + chevron drawn in current flowDirection (no CSS spin). */
  function onewaySvg(tile) {
    const parsed = parseFlowDirection(tile.flowDirection);
    if (!parsed) return "";
    const edges = [
      [50, 0],
      [100, 50],
      [50, 100],
      [0, 50],
    ];
    const [ex, ey] = edges[parsed.entry];
    const [xx, xy] = edges[parsed.exit];
    const path = `M ${ex} ${ey} L 50 50 L ${xx} ${xy}`;

    // Chevron near center, pointing toward exit
    const dx = xx - 50;
    const dy = xy - 50;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const px = -uy;
    const py = ux;
    const tipX = 50 + ux * 14;
    const tipY = 50 + uy * 14;
    const bX = 50 - ux * 4;
    const bY = 50 - uy * 4;
    const chevron = `M ${bX + px * 8} ${bY + py * 8} L ${tipX} ${tipY} L ${
      bX - px * 8
    } ${bY - py * 8}`;

    return `
      <svg class="flow-tile__svg" viewBox="0 0 100 100" aria-hidden="true">
        <path class="flow-pipe" d="${path}"/>
        <path class="flow-oneway-arrow" d="${chevron}"/>
      </svg>`;
  }

  function colorStops(colorId) {
    if (colorId === 1) {
      return { a: "var(--teal-soft)", b: "var(--teal)", glow: "var(--teal)" };
    }
    if (colorId === 2) {
      return {
        a: "var(--flow-gold-soft)",
        b: "var(--flow-gold)",
        glow: "var(--flow-gold)",
      };
    }
    return { a: "var(--pink)", b: "var(--lavender)", glow: "var(--pink)" };
  }

  function tileSvg(tile) {
    const type = tile.type;

    if (type === "empty") {
      return "";
    }

    if (type === "source") {
      const cs = colorStops(tile.colorId);
      return `
        <svg class="flow-tile__svg" viewBox="0 0 100 100" aria-hidden="true">
          <defs>
            <radialGradient id="source-orb-grad-${tile.row}-${tile.col}" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="${cs.a}"/>
              <stop offset="55%" stop-color="${cs.b}"/>
              <stop offset="100%" stop-color="${cs.b}" stop-opacity="0.35"/>
            </radialGradient>
          </defs>
          <path class="flow-pipe" d="${stubToward(DIR.N)}"/>
          <circle class="flow-source-orb" cx="50" cy="50" r="16"
            fill="url(#source-orb-grad-${tile.row}-${tile.col})"
            style="filter: drop-shadow(0 0 6px ${cs.glow})"/>
        </svg>`;
    }

    if (type === "target") {
      return `
        <svg class="flow-tile__svg" viewBox="0 0 100 100" aria-hidden="true">
          <path class="flow-pipe" d="${stubToward(DIR.N)}"/>
          <circle class="flow-target-ring flow-target-core" cx="50" cy="50" r="18"/>
        </svg>`;
    }

    if (type === "oneway") {
      return onewaySvg(tile);
    }

    return `
      <svg class="flow-tile__svg" viewBox="0 0 100 100" aria-hidden="true">
        <path class="flow-pipe" d="${pipePathForBase(type)}"/>
      </svg>`;
  }

  function isRotatable(type) {
    return (
      type === "straight" ||
      type === "curve" ||
      type === "tjunction" ||
      type === "oneway"
    );
  }

  function remainingRotations(tile) {
    if (tile.maxRotations == null) return null;
    return Math.max(0, tile.maxRotations - tile.rotationsUsed);
  }

  function lockedBadgeHtml() {
    return `<span class="flow-tile__lock" aria-hidden="true">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
        <rect x="5" y="11" width="14" height="10" rx="2" fill="currentColor" opacity="0.7"/>
        <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
      </svg>
    </span>`;
  }

  function rotationsBadgeHtml(left) {
    return `<span class="flow-tile__budget" aria-hidden="true">${left} left</span>`;
  }

  function tileAriaLabel(tile) {
    if (tile.locked && isRotatable(tile.type)) {
      return `${tile.type} pipe, locked at ${tile.rotation} degrees`;
    }
    if (isRotatable(tile.type)) {
      const left = remainingRotations(tile);
      const budget =
        left != null ? ` ${left} rotation${left === 1 ? "" : "s"} left.` : "";
      return `${tile.type} pipe, rotation ${tile.rotation} degrees.${budget} Activate to rotate.`;
    }
    if (tile.type === "source") {
      return `Source light, color ${tile.colorId}`;
    }
    if (tile.type === "target") {
      return `Target socket, color ${tile.colorId}`;
    }
    return "";
  }

  function syncTileChrome(tile) {
    const el = tileEls.get(`${tile.row},${tile.col}`);
    if (!el) return;

    el.classList.toggle("flow-tile--locked", !!tile.locked);
    if (el.tagName === "BUTTON") {
      el.disabled = !!tile.locked;
    }

    const oldLock = el.querySelector(".flow-tile__lock");
    const oldBudget = el.querySelector(".flow-tile__budget");
    if (oldLock) oldLock.remove();
    if (oldBudget) oldBudget.remove();

    if (tile.locked && isRotatable(tile.type)) {
      el.insertAdjacentHTML("beforeend", lockedBadgeHtml());
    } else if (
      isRotatable(tile.type) &&
      !tile.locked &&
      tile.maxRotations != null
    ) {
      const left = remainingRotations(tile);
      if (left != null && left > 0) {
        el.insertAdjacentHTML("beforeend", rotationsBadgeHtml(left));
      }
    }

    const label = tileAriaLabel(tile);
    if (label) el.setAttribute("aria-label", label);
  }

  function renderBoard() {
    if (!grid) return;
    flowGridEl.innerHTML = "";
    tileEls.clear();

    flowGridEl.style.gridTemplateColumns = `repeat(${grid.cols}, minmax(0, 1fr))`;

    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const tile = grid.cells[r][c];
        const rotatable = isRotatable(tile.type) && !tile.locked;
        const el = document.createElement(rotatable ? "button" : "div");
        el.className = `flow-tile flow-tile--${tile.type}`;
        if (isRotatable(tile.type)) el.classList.add("flow-tile--pipe");
        if (tile.locked) el.classList.add("flow-tile--locked");
        el.dataset.color = String(
          tile.type === "source" || tile.type === "target"
            ? tile.colorId
            : tile.flowColorId >= 0
              ? tile.flowColorId
              : tile.colorId
        );
        el.setAttribute("role", "gridcell");
        el.dataset.row = String(r);
        el.dataset.col = String(c);

        if (rotatable) {
          el.type = "button";
          el.addEventListener("click", () => onTileClick(r, c));
        } else if (tile.type === "empty") {
          el.setAttribute("aria-hidden", "true");
        }

        const rotator = document.createElement("div");
        rotator.className = "flow-tile__rotator";
        // Oneway geometry is drawn in absolute NESW; skip CSS spin.
        // Source/target/pipes: visual at base 0, spun to match rotation.
        if (tile.type === "oneway") {
          rotator.style.transform = "rotate(0deg)";
        } else {
          rotator.style.transform = `rotate(${tile.visualRotation}deg)`;
        }
        rotator.innerHTML = tileSvg(tile);
        el.appendChild(rotator);

        flowGridEl.appendChild(el);
        tileEls.set(`${r},${c}`, el);
        syncTileChrome(tile);
      }
    }

    applyFlowClasses();
  }

  function applyFlowClasses() {
    if (!grid) return;
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const tile = grid.cells[r][c];
        const el = tileEls.get(`${r},${c}`);
        if (!el) continue;
        el.classList.toggle("is-flowing", !!tile.flowing && tile.type !== "empty");
        el.classList.toggle(
          "is-solved-target",
          tile.type === "target" && solved && tile.flowing
        );
        const color =
          tile.flowColorId >= 0
            ? tile.flowColorId
            : tile.type === "source" || tile.type === "target"
              ? tile.colorId
              : 0;
        el.dataset.color = String(color);
      }
    }
  }

  function syncRotator(tile) {
    const el = tileEls.get(`${tile.row},${tile.col}`);
    if (!el) return;
    const rotator = el.querySelector(".flow-tile__rotator");
    if (rotator) {
      if (tile.type === "oneway") {
        rotator.style.transform = "rotate(0deg)";
        rotator.innerHTML = tileSvg(tile);
      } else {
        rotator.style.transform = `rotate(${tile.visualRotation}deg)`;
      }
    }
    syncTileChrome(tile);
  }

  /* -------------------------------------------------------------------- */
  /* Interaction                                                          */
  /* -------------------------------------------------------------------- */

  function onTileClick(row, col) {
    if (!grid || solved) return;
    const tile = grid.cells[row][col];
    if (!isRotatable(tile.type) || tile.locked) return;

    tile.visualRotation = (tile.visualRotation || tile.rotation) + 90;
    tile.rotation = ((tile.visualRotation % 360) + 360) % 360;

    if (tile.type === "oneway") {
      tile.flowDirection = rotateFlowDirection(tile.flowDirection, 1);
    }

    if (tile.maxRotations != null) {
      tile.rotationsUsed += 1;
      if (tile.rotationsUsed >= tile.maxRotations) {
        tile.locked = true;
      }
    }

    tile.connections = computeConnections(
      tile.type,
      tile.rotation,
      tile.flowDirection
    );
    moveCount += 1;
    hudMoves.textContent = String(moveCount);
    syncRotator(tile);

    afterRotation();
  }

  function afterRotation() {
    if (!grid) return;
    const ok = checkSolved(grid);
    applyFlowClasses();

    if (ok) {
      solved = true;
      stopTimer();
      // Freeze elapsed at solve moment
      if (levelStartMs) {
        elapsedSec = Math.floor((Date.now() - levelStartMs) / 1000);
        updateTimerDisplay();
      }
      const stars = starsForMoves(moveCount, grid.par);
      saveBestStars(grid.id, stars);
      const perfect =
        stars >= 3 &&
        grid.perfectTime != null &&
        elapsedSec <= grid.perfectTime;
      window.setTimeout(() => openCompleteModal(stars, perfect), 420);
    }
  }

  function openCompleteModal(stars, perfect) {
    completeStars.querySelectorAll(".star").forEach((el) => {
      const i = Number(el.getAttribute("data-i"));
      el.classList.toggle("is-lit", i <= stars);
    });

    let msg = `Finished in ${moveCount} move${
      moveCount === 1 ? "" : "s"
    } (par ${grid.par}). ${stars} star${stars === 1 ? "" : "s"}!`;
    if (grid.perfectTime != null) {
      msg += ` Time ${formatTime(elapsedSec)}.`;
    }
    completeMsg.textContent = msg;

    if (perfectBadge) {
      perfectBadge.classList.toggle("is-visible", !!perfect);
      perfectBadge.setAttribute("aria-hidden", perfect ? "false" : "true");
    }
    if (completeCard) {
      completeCard.classList.toggle("modal-card--perfect", !!perfect);
    }

    const hasNext =
      currentLevelId < UNLOCKED_THROUGH && getLevelDef(currentLevelId + 1);
    btnNext.style.display = "";
    btnNext.textContent = hasNext ? "Next Level" : "Levels";

    completeModal.classList.add("is-open");
    completeModal.setAttribute("aria-hidden", "false");
  }

  function closeCompleteModal() {
    completeModal.classList.remove("is-open");
    completeModal.setAttribute("aria-hidden", "true");
    if (perfectBadge) {
      perfectBadge.classList.remove("is-visible");
      perfectBadge.setAttribute("aria-hidden", "true");
    }
    if (completeCard) {
      completeCard.classList.remove("modal-card--perfect");
    }
  }

  /* -------------------------------------------------------------------- */
  /* Level load                                                           */
  /* -------------------------------------------------------------------- */

  function loadLevel(id) {
    const def = getLevelDef(id);
    if (!def) return;

    currentLevelId = id;
    moveCount = 0;
    solved = false;
    closeCompleteModal();

    grid = buildGrid(def);
    hudLevel.textContent = String(def.id);
    hudMoves.textContent = "0";
    hudPar.textContent = String(def.par);
    levelNameEl.textContent = def.name;

    syncTimerHud(def);
    showPlay();
    renderBoard();
    checkSolved(grid);
    applyFlowClasses();
  }

  function replayLevel() {
    loadLevel(currentLevelId);
  }

  /* -------------------------------------------------------------------- */
  /* Wire UI                                                              */
  /* -------------------------------------------------------------------- */

  btnLevels.addEventListener("click", showSelect);
  btnReplay.addEventListener("click", replayLevel);
  btnReplayModal.addEventListener("click", replayLevel);
  btnNext.addEventListener("click", () => {
    if (currentLevelId < UNLOCKED_THROUGH && getLevelDef(currentLevelId + 1)) {
      loadLevel(currentLevelId + 1);
    } else {
      showSelect();
    }
  });

  if (btnResetProgress) {
    btnResetProgress.addEventListener("click", () => {
      const ok = window.confirm(
        "Reset all Flow progress? Star ratings for every level will be cleared."
      );
      if (!ok) return;
      clearAllFlowProgress();
      renderLevelSelect();
    });
  }

  window.FlowGame = {
    computeConnections,
    checkSolved,
    rotateMask,
    rotateFlowDirection,
    parseFlowDirection,
    starsForMoves,
    buildGrid,
  };

  renderLevelSelect();
})();
