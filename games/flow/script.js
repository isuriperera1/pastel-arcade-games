/**
 * Flow — rotate pipes to connect source light to target.
 * Levels 1–3 playable; 4–10 locked (Part 2).
 */
(function () {
  const TOTAL_LEVELS = 10;
  const UNLOCKED_THROUGH = 3;
  const STARS_KEY = (n) => `arcade-games-flow-level-${n}-stars`;

  const DIR = {
    N: 0,
    E: 1,
    S: 2,
    W: 3,
  };

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
   */
  const BASE = {
    empty: [false, false, false, false],
    straight: [true, false, true, false], // N–S
    curve: [true, true, false, false], // N–E
    tjunction: [true, true, false, true], // N, E, W
  };

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
   * @returns {[boolean,boolean,boolean,boolean]} [N,E,S,W]
   */
  function computeConnections(type, rotation) {
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

    const base = BASE[type];
    if (!base) return [false, false, false, false];
    return rotateMask(base, steps);
  }

  /* -------------------------------------------------------------------- */
  /* Path validation                                                      */
  /* -------------------------------------------------------------------- */

  /**
   * BFS from source. Mutual connections required. Sets flowing on path tiles.
   * @param {ReturnType<typeof buildGrid>} grid
   * @returns {boolean} true if target reached
   */
  function checkSolved(grid) {
    const { rows, cols, cells } = grid;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells[r][c].flowing = false;
      }
    }

    let start = null;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if (cells[r][c].type === "source") {
          start = cells[r][c];
          break;
        }
      }
      if (start) break;
    }
    if (!start) return false;

    const visited = new Set();
    const queue = [start];
    visited.add(`${start.row},${start.col}`);
    start.flowing = true;

    let reachedTarget = false;

    while (queue.length) {
      const tile = queue.shift();
      if (tile.type === "target") {
        reachedTarget = true;
      }

      const conn = tile.connections;
      for (let d = 0; d < 4; d++) {
        if (!conn[d]) continue;
        const [dr, dc] = DELTA[d];
        const nr = tile.row + dr;
        const nc = tile.col + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;

        const neighbor = cells[nr][nc];
        const key = `${nr},${nc}`;
        if (visited.has(key)) continue;
        if (neighbor.type === "empty") continue;

        // Mutual: A opens toward B AND B opens back toward A
        if (!neighbor.connections[OPPOSITE[d]]) continue;

        visited.add(key);
        neighbor.flowing = true;
        queue.push(neighbor);
      }
    }

    return reachedTarget;
  }

  /* -------------------------------------------------------------------- */
  /* DOM refs                                                             */
  /* -------------------------------------------------------------------- */

  const selectScreen = document.getElementById("select-screen");
  const playScreen = document.getElementById("play-screen");
  const levelGridEl = document.getElementById("level-grid");
  const flowGridEl = document.getElementById("flow-grid");
  const hudLevel = document.getElementById("hud-level");
  const hudMoves = document.getElementById("hud-moves");
  const hudPar = document.getElementById("hud-par");
  const levelNameEl = document.getElementById("level-name");
  const completeModal = document.getElementById("complete-modal");
  const completeMsg = document.getElementById("complete-msg");
  const completeStars = document.getElementById("complete-stars");
  const btnNext = document.getElementById("btn-next");
  const btnReplay = document.getElementById("btn-replay");
  const btnReplayModal = document.getElementById("btn-replay-modal");
  const btnLevels = document.getElementById("btn-levels");

  /** @type {ReturnType<typeof buildGrid>|null} */
  let grid = null;
  let currentLevelId = 1;
  let moveCount = 0;
  let solved = false;
  /** @type {Map<string, HTMLElement>} */
  const tileEls = new Map();

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
  /* Level select                                                         */
  /* -------------------------------------------------------------------- */

  function renderLevelSelect() {
    levelGridEl.innerHTML = "";
    for (let n = 1; n <= TOTAL_LEVELS; n++) {
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
    }
  }

  function showSelect() {
    solved = false;
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
    /** @type {Array<Array<{type:string,rotation:number,connections:boolean[],locked:boolean,colorId:number,flowing:boolean,row:number,col:number}>>} */
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
          colorId: 0,
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
      cell.connections = computeConnections(t.type, t.rotation);
      cell.locked = false;
      cell.colorId = 0;
      cell.flowing = false;
    });

    return { rows, cols, cells, par: levelDef.par, name: levelDef.name, id: levelDef.id };
  }

  function pipePathForBase(type) {
    // Drawn at rotation 0; CSS transform rotates the whole SVG group.
    // viewBox 0 0 100 100, center 50,50. Stubs go to open edges.
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

  function tileSvg(tile) {
    const type = tile.type;

    if (type === "empty") {
      return "";
    }

    if (type === "source") {
      // Single stub at base north; rotator handles direction
      return `
        <svg class="flow-tile__svg" viewBox="0 0 100 100" aria-hidden="true">
          <defs>
            <radialGradient id="source-orb-grad-${tile.row}-${tile.col}" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stop-color="var(--pink)"/>
              <stop offset="55%" stop-color="var(--lavender)"/>
              <stop offset="100%" stop-color="var(--lavender)" stop-opacity="0.35"/>
            </radialGradient>
          </defs>
          <path class="flow-pipe" d="${stubToward(DIR.N)}"/>
          <circle class="flow-source-orb" cx="50" cy="50" r="16"
            fill="url(#source-orb-grad-${tile.row}-${tile.col})"/>
        </svg>`;
    }

    if (type === "target") {
      return `
        <svg class="flow-tile__svg" viewBox="0 0 100 100" aria-hidden="true">
          <path class="flow-pipe" d="${stubToward(DIR.N)}"/>
          <circle class="flow-target-ring flow-target-core" cx="50" cy="50" r="18"/>
        </svg>`;
    }

    // straight / curve / tjunction — drawn at rot 0, spun via CSS
    return `
      <svg class="flow-tile__svg" viewBox="0 0 100 100" aria-hidden="true">
        <path class="flow-pipe" d="${pipePathForBase(type)}"/>
      </svg>`;
  }

  function isRotatable(type) {
    return type === "straight" || type === "curve" || type === "tjunction";
  }

  function renderBoard() {
    if (!grid) return;
    flowGridEl.innerHTML = "";
    tileEls.clear();

    flowGridEl.style.gridTemplateColumns = `repeat(${grid.cols}, minmax(0, 1fr))`;

    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.cols; c++) {
        const tile = grid.cells[r][c];
        const el = document.createElement(
          isRotatable(tile.type) ? "button" : "div"
        );
        el.className = `flow-tile flow-tile--${tile.type}`;
        if (isRotatable(tile.type)) el.classList.add("flow-tile--pipe");
        el.setAttribute("role", "gridcell");
        el.dataset.row = String(r);
        el.dataset.col = String(c);

        if (isRotatable(tile.type)) {
          el.type = "button";
          el.setAttribute(
            "aria-label",
            `${tile.type} pipe, rotation ${tile.rotation} degrees. Activate to rotate.`
          );
          el.addEventListener("click", () => onTileClick(r, c));
        } else if (tile.type === "source") {
          el.setAttribute("aria-label", "Source light");
        } else if (tile.type === "target") {
          el.setAttribute("aria-label", "Target socket");
        } else {
          el.setAttribute("aria-hidden", "true");
        }

        const rotator = document.createElement("div");
        rotator.className = "flow-tile__rotator";
        // Source/target: visual drawn at N; rotate to match opening side
        // Pipes: visual at base 0; rotate to match tile.rotation
        rotator.style.transform = `rotate(${tile.visualRotation}deg)`;
        rotator.innerHTML = tileSvg(tile);
        el.appendChild(rotator);

        flowGridEl.appendChild(el);
        tileEls.set(`${r},${c}`, el);
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
      }
    }
  }

  function syncRotator(tile) {
    const el = tileEls.get(`${tile.row},${tile.col}`);
    if (!el) return;
    const rotator = el.querySelector(".flow-tile__rotator");
    if (rotator) {
      rotator.style.transform = `rotate(${tile.visualRotation}deg)`;
    }
    if (isRotatable(tile.type)) {
      el.setAttribute(
        "aria-label",
        `${tile.type} pipe, rotation ${tile.rotation} degrees. Activate to rotate.`
      );
    }
  }

  /* -------------------------------------------------------------------- */
  /* Interaction                                                          */
  /* -------------------------------------------------------------------- */

  function onTileClick(row, col) {
    if (!grid || solved) return;
    const tile = grid.cells[row][col];
    if (!isRotatable(tile.type) || tile.locked) return;

    tile.visualRotation = (tile.visualRotation || tile.rotation) + 90;
    tile.rotation = tile.visualRotation % 360;
    tile.connections = computeConnections(tile.type, tile.rotation);
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
      const stars = starsForMoves(moveCount, grid.par);
      saveBestStars(grid.id, stars);
      // Brief beat so flow/target glow reads before modal
      window.setTimeout(() => openCompleteModal(stars), 420);
    }
  }

  function openCompleteModal(stars) {
    completeStars.querySelectorAll(".star").forEach((el) => {
      const i = Number(el.getAttribute("data-i"));
      el.classList.toggle("is-lit", i <= stars);
    });
    completeMsg.textContent = `Finished in ${moveCount} move${
      moveCount === 1 ? "" : "s"
    } (par ${grid.par}). ${stars} star${stars === 1 ? "" : "s"}!`;

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

  // Expose helpers for debugging / tests
  window.FlowGame = {
    computeConnections,
    checkSolved,
    rotateMask,
    starsForMoves,
  };

  renderLevelSelect();
})();
