/**
 * 2048 — sliding tile merge game
 * Keyboard arrows + swipe. Best score in localStorage.
 *
 * Rendering model:
 *   Each tile is a persistent object { id, row, col, value } with its own
 *   DOM element. Moving updates row/col on the SAME element, so the browser
 *   animates the transform change (a visible slide) instead of the whole
 *   board being redrawn in place. Merges briefly overlap two tiles at the
 *   destination cell, then remove the "losing" one and pop the survivor.
 */
(function () {
  const SIZE = 4;
  const BEST_KEY = "aracage-games-2048-best";
  const SLIDE_MS = 130; // must stay in sync with the .tile transition duration in style.css

  const boardEl = document.getElementById("board");
  const bgEl = document.getElementById("board-bg");
  const tilesLayer = document.getElementById("board-tiles");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayMsg = document.getElementById("overlay-msg");
  const overlayContinue = document.getElementById("overlay-continue");

  /** @type {{id:number,row:number,col:number,value:number,pendingValue?:number}[]} */
  let tiles = [];
  let nextId = 1;
  let score = 0;
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  let won = false;
  let keepGoing = false;
  let over = false;
  let busy = false; // true while a slide animation is in flight

  const tileEls = new Map(); // tile id -> DOM element
  let cellRects = []; // index r*SIZE+c -> {x, y, w, h} relative to tilesLayer

  bestEl.textContent = String(best);

  /* -------------------------------------------------------------------- */
  /* Board background + metrics                                          */
  /* -------------------------------------------------------------------- */

  function buildBackground() {
    bgEl.innerHTML = "";
    for (let i = 0; i < SIZE * SIZE; i++) {
      const slot = document.createElement("div");
      slot.className = "cell-bg";
      bgEl.appendChild(slot);
    }
  }

  function measureCellRects() {
    const layerRect = tilesLayer.getBoundingClientRect();
    cellRects = Array.from(bgEl.children).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        x: r.left - layerRect.left,
        y: r.top - layerRect.top,
        w: r.width,
        h: r.height,
      };
    });
  }

  function debounce(fn, wait) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  window.addEventListener(
    "resize",
    debounce(() => {
      measureCellRects();
      tiles.forEach((tile) => {
        const el = tileEls.get(tile.id);
        if (el) positionTile(el, tile, { skipTransition: true });
      });
    }, 120)
  );

  /* -------------------------------------------------------------------- */
  /* Tile helpers                                                         */
  /* -------------------------------------------------------------------- */

  function occupiedSet() {
    const set = new Set();
    tiles.forEach((t) => set.add(t.row * SIZE + t.col));
    return set;
  }

  function freeCells() {
    const occ = occupiedSet();
    const list = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        if (!occ.has(r * SIZE + c)) list.push({ r, c });
      }
    }
    return list;
  }

  function valueAt(r, c) {
    const t = tiles.find((t) => t.row === r && t.col === c);
    return t ? t.value : 0;
  }

  function spawn() {
    const free = freeCells();
    if (!free.length) return null;
    const pick = free[Math.floor(Math.random() * free.length)];
    const tile = {
      id: nextId++,
      row: pick.r,
      col: pick.c,
      value: Math.random() < 0.9 ? 2 : 4,
    };
    tiles.push(tile);
    return tile;
  }

  function canMove() {
    if (freeCells().length) return true;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = valueAt(r, c);
        if (!v) continue;
        if (c + 1 < SIZE && valueAt(r, c + 1) === v) return true;
        if (r + 1 < SIZE && valueAt(r + 1, c) === v) return true;
      }
    }
    return false;
  }

  /* -------------------------------------------------------------------- */
  /* Move logic — mutates tile row/col in place, tracks merges            */
  /* -------------------------------------------------------------------- */

  /**
   * dir: 0 = left, 1 = up, 2 = right, 3 = down
   * Returns { moved, gained, mergedIds, removedIds }.
   */
  function computeMove(dir) {
    const vertical = dir === 1 || dir === 3;
    const reverse = dir === 2 || dir === 3;

    let moved = false;
    let gained = 0;
    const mergedIds = new Set();
    const removedIds = [];

    for (let line = 0; line < SIZE; line++) {
      let lineTiles = tiles.filter((t) => (vertical ? t.col === line : t.row === line));

      // Order tiles starting from the edge they are sliding toward.
      lineTiles.sort((a, b) => {
        const posA = vertical ? a.row : a.col;
        const posB = vertical ? b.row : b.col;
        return reverse ? posB - posA : posA - posB;
      });

      const merges = [];
      let i = 0;
      while (i < lineTiles.length) {
        const cur = lineTiles[i];
        const next = lineTiles[i + 1];
        if (next && next.value === cur.value && !cur._consumed) {
          merges.push({ survivor: cur, absorbed: next, value: cur.value * 2 });
          i += 2;
        } else {
          merges.push({ survivor: cur, absorbed: null, value: cur.value });
          i += 1;
        }
      }

      merges.forEach((entry, i) => {
        const newPos = reverse ? SIZE - 1 - i : i;
        const survivor = entry.survivor;

        if (vertical) {
          if (survivor.row !== newPos) moved = true;
          survivor.row = newPos;
        } else {
          if (survivor.col !== newPos) moved = true;
          survivor.col = newPos;
        }

        if (entry.absorbed) {
          if (vertical) entry.absorbed.row = newPos;
          else entry.absorbed.col = newPos;
          survivor.pendingValue = entry.value;
          gained += entry.value;
          mergedIds.add(survivor.id);
          removedIds.push(entry.absorbed.id);
          moved = true;
        }
      });
    }

    return { moved, gained, mergedIds, removedIds };
  }

  /* -------------------------------------------------------------------- */
  /* Rendering                                                            */
  /* -------------------------------------------------------------------- */

  function positionTile(el, tile, { skipTransition = false } = {}) {
    const rect = cellRects[tile.row * SIZE + tile.col];
    if (!rect) return;
    if (skipTransition) el.style.transition = "none";
    el.style.width = `${rect.w}px`;
    el.style.height = `${rect.h}px`;
    el.style.transform = `translate(${rect.x}px, ${rect.y}px)`;
    if (skipTransition) {
      // Force layout then restore the transition so future updates animate again.
      void el.offsetWidth;
      el.style.transition = "";
    }
  }

  function ensureTileEl(tile) {
    let el = tileEls.get(tile.id);
    let isFresh = false;
    if (!el) {
      el = document.createElement("div");
      el.className = "tile";
      el.setAttribute("role", "gridcell");
      el.innerHTML = '<span class="tile__face"></span>';
      tilesLayer.appendChild(el);
      tileEls.set(tile.id, el);
      isFresh = true;
    }
    return { el, isFresh };
  }

  function removeStaleEls() {
    tileEls.forEach((el, id) => {
      if (!tiles.some((t) => t.id === id)) {
        el.remove();
        tileEls.delete(id);
      }
    });
  }

  function renderTiles({ mergedIds = new Set(), spawnedIds = new Set() } = {}) {
    removeStaleEls();

    tiles.forEach((tile) => {
      const { el, isFresh } = ensureTileEl(tile);
      el.dataset.v = String(tile.value);
      el.querySelector(".tile__face").textContent = String(tile.value);

      positionTile(el, tile, { skipTransition: isFresh });

      if (spawnedIds.has(tile.id)) {
        el.classList.remove("tile--new");
        void el.offsetWidth;
        el.classList.add("tile--new");
      }

      if (mergedIds.has(tile.id)) {
        el.classList.remove("tile--pop");
        void el.offsetWidth;
        el.classList.add("tile--pop");
      }
    });
  }

  /* -------------------------------------------------------------------- */
  /* Game flow                                                            */
  /* -------------------------------------------------------------------- */

  function move(dir) {
    if (over || busy) return false;

    const { moved, gained, mergedIds, removedIds } = computeMove(dir);
    if (!moved) return false;

    busy = true;

    // Phase 1: slide — survivors and merged-away tiles animate to their
    // new cell. Values shown here are still the pre-merge values, so both
    // tiles visibly travel before one disappears.
    renderTiles();

    window.setTimeout(() => {
      // Phase 2: land — apply merges, remove absorbed tiles, spawn, score.
      tiles.forEach((t) => {
        if (t.pendingValue) {
          t.value = t.pendingValue;
          delete t.pendingValue;
        }
      });
      tiles = tiles.filter((t) => !removedIds.includes(t.id));

      score += gained;
      scoreEl.textContent = String(score);
      if (score > best) {
        best = score;
        bestEl.textContent = String(best);
        localStorage.setItem(BEST_KEY, String(best));
      }

      const spawned = spawn();
      renderTiles({
        mergedIds,
        spawnedIds: spawned ? new Set([spawned.id]) : new Set(),
      });

      busy = false;

      if (!won && !keepGoing && tiles.some((t) => t.value === 2048)) {
        won = true;
        showOverlay("You win!", "You reached 2048. Keep going or start fresh.", true);
      } else if (!canMove()) {
        over = true;
        showOverlay("Game over", "No more moves. Try again?", false);
      }
    }, SLIDE_MS);

    return true;
  }

  function showOverlay(title, msg, canContinue) {
    overlayTitle.textContent = title;
    overlayMsg.textContent = msg;
    overlayContinue.classList.toggle("hidden", !canContinue);
    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
  }

  function hideOverlay() {
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
  }

  function newGame() {
    tiles = [];
    tileEls.forEach((el) => el.remove());
    tileEls.clear();
    score = 0;
    won = false;
    keepGoing = false;
    over = false;
    busy = false;
    scoreEl.textContent = "0";
    hideOverlay();

    measureCellRects();
    const a = spawn();
    const b = spawn();
    renderTiles({ spawnedIds: new Set([a?.id, b?.id].filter(Boolean)) });
    boardEl.focus();
  }

  /* -------------------------------------------------------------------- */
  /* Input                                                                */
  /* -------------------------------------------------------------------- */

  const KEY_MAP = {
    ArrowLeft: 0,
    ArrowUp: 1,
    ArrowRight: 2,
    ArrowDown: 3,
    a: 0,
    w: 1,
    d: 2,
    s: 3,
  };

  document.addEventListener("keydown", (e) => {
    const dir = KEY_MAP[e.key] ?? KEY_MAP[e.key.toLowerCase()];
    if (dir === undefined) return;
    e.preventDefault();
    move(dir);
  });

  /* Swipe support */
  let touchStart = null;
  boardEl.addEventListener(
    "touchstart",
    (e) => {
      const t = e.changedTouches[0];
      touchStart = { x: t.clientX, y: t.clientY };
    },
    { passive: true }
  );

  boardEl.addEventListener(
    "touchend",
    (e) => {
      if (!touchStart) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - touchStart.x;
      const dy = t.clientY - touchStart.y;
      touchStart = null;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);
      if (Math.max(absX, absY) < 24) return;
      if (absX > absY) move(dx > 0 ? 2 : 0);
      else move(dy > 0 ? 3 : 1);
    },
    { passive: true }
  );

  document.getElementById("new-game").addEventListener("click", newGame);
  document.getElementById("overlay-restart").addEventListener("click", newGame);
  overlayContinue.addEventListener("click", () => {
    keepGoing = true;
    hideOverlay();
    boardEl.focus();
  });

  buildBackground();
  newGame();
})();
