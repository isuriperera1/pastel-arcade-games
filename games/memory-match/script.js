/**
 * Memory Match — flip-card pairs with 4×4 / 6×6 difficulty.
 */
(function () {
  const ICONS = [
    // Flat geometric pair faces (pastel)
    `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="14" fill="#7FC7C4"/></svg>`,
    `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="10" y="10" width="28" height="28" rx="6" fill="#B9A9D6"/></svg>`,
    `<svg viewBox="0 0 48 48" aria-hidden="true"><polygon points="24,8 40,38 8,38" fill="#E8B4B8"/></svg>`,
    `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="8" y="18" width="32" height="12" rx="6" fill="#3A3159"/></svg>`,
    `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="14" fill="none" stroke="#7FC7C4" stroke-width="6"/></svg>`,
    `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 8 L28 20 L40 20 L30 28 L34 40 L24 32 L14 40 L18 28 L8 20 L20 20 Z" fill="#B9A9D6"/></svg>`,
    `<svg viewBox="0 0 48 48" aria-hidden="true"><ellipse cx="24" cy="24" rx="16" ry="10" fill="#E8B4B8"/></svg>`,
    `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="14" y="8" width="20" height="32" rx="10" fill="#7FC7C4"/></svg>`,
    `<svg viewBox="0 0 48 48" aria-hidden="true"><polygon points="24,6 30,18 44,18 33,27 37,40 24,32 11,40 15,27 4,18 18,18" fill="#3A3159"/></svg>`,
    `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 30 Q24 8 40 30 Q24 42 8 30 Z" fill="#B9A9D6"/></svg>`,
    `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="8" y="8" width="14" height="14" rx="3" fill="#E8B4B8"/><rect x="26" y="26" width="14" height="14" rx="3" fill="#7FC7C4"/></svg>`,
    `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="16" cy="24" r="8" fill="#B9A9D6"/><circle cx="32" cy="24" r="8" fill="#7FC7C4"/></svg>`,
    `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 10 L38 38 H10 Z" fill="none" stroke="#3A3159" stroke-width="5" stroke-linejoin="round"/></svg>`,
    `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="10" y="10" width="28" height="28" rx="14" fill="#E8B4B8"/><circle cx="24" cy="24" r="6" fill="#F5EFE3"/></svg>`,
    `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M12 12 H36 V36 H12 Z" fill="#7FC7C4" transform="rotate(45 24 24)"/></svg>`,
    `<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 8 C32 8 38 16 38 24 C38 36 24 40 24 40 C24 40 10 36 10 24 C10 16 16 8 24 8 Z" fill="#B9A9D6"/></svg>`,
    `<svg viewBox="0 0 48 48" aria-hidden="true"><rect x="6" y="20" width="36" height="10" rx="5" fill="#3A3159"/><rect x="19" y="6" width="10" height="36" rx="5" fill="#E8B4B8"/></svg>`,
    `<svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="16" r="7" fill="#7FC7C4"/><rect x="14" y="24" width="20" height="16" rx="8" fill="#B9A9D6"/></svg>`,
  ];

  const board = document.getElementById("board");
  const movesEl = document.getElementById("moves");
  const timerEl = document.getElementById("timer");
  const overlay = document.getElementById("overlay");
  const winMsg = document.getElementById("win-msg");
  const sizeButtons = document.querySelectorAll(".seg__btn");

  let size = 4;
  let deck = [];
  let flipped = [];
  let lock = false;
  let moves = 0;
  let matched = 0;
  let pairs = 0;
  let startedAt = null;
  let timerId = null;

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function formatTime(ms) {
    const s = Math.floor(ms / 1000);
    const m = Math.floor(s / 60);
    const rem = s % 60;
    return `${m}:${String(rem).padStart(2, "0")}`;
  }

  function startTimer() {
    if (timerId) return;
    startedAt = Date.now();
    timerId = setInterval(() => {
      timerEl.textContent = formatTime(Date.now() - startedAt);
    }, 250);
  }

  function stopTimer() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function buildDeck() {
    pairs = (size * size) / 2;
    const chosen = shuffle(ICONS).slice(0, pairs);
    const doubled = chosen.flatMap((svg) => [
      { pairKey: svg, svg },
      { pairKey: svg, svg },
    ]);
    return shuffle(doubled).map((card, id) => ({ ...card, id }));
  }

  function newGame() {
    stopTimer();
    startedAt = null;
    timerEl.textContent = "0:00";
    moves = 0;
    matched = 0;
    flipped = [];
    lock = false;
    movesEl.textContent = "0";
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");

    deck = buildDeck();
    board.dataset.cols = String(size);
    board.innerHTML = "";

    deck.forEach((card, index) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "mem-card";
      btn.dataset.index = String(index);
      btn.setAttribute("aria-label", "Hidden card");
      btn.innerHTML = `
        <span class="mem-card__inner">
          <span class="mem-card__face mem-card__back"></span>
          <span class="mem-card__face mem-card__front">${card.svg}</span>
        </span>
      `;
      btn.addEventListener("click", () => onFlip(index, btn));
      board.appendChild(btn);
    });
  }

  function onFlip(index, btn) {
    if (lock || btn.classList.contains("is-flipped") || btn.classList.contains("is-matched")) {
      return;
    }
    startTimer();
    btn.classList.add("is-flipped");
    btn.setAttribute("aria-label", "Revealed card");
    flipped.push({ index, btn, key: deck[index].pairKey });

    if (flipped.length < 2) return;

    moves += 1;
    movesEl.textContent = String(moves);
    lock = true;

    const [a, b] = flipped;
    if (a.key === b.key) {
      a.btn.classList.add("is-matched");
      b.btn.classList.add("is-matched");
      a.btn.disabled = true;
      b.btn.disabled = true;
      matched += 1;
      flipped = [];
      lock = false;
      if (matched === pairs) {
        stopTimer();
        const elapsed = formatTime(Date.now() - startedAt);
        winMsg.textContent = `Matched in ${moves} moves · ${elapsed}`;
        overlay.classList.add("is-open");
        overlay.setAttribute("aria-hidden", "false");
      }
    } else {
      setTimeout(() => {
        a.btn.classList.remove("is-flipped");
        b.btn.classList.remove("is-flipped");
        a.btn.setAttribute("aria-label", "Hidden card");
        b.btn.setAttribute("aria-label", "Hidden card");
        flipped = [];
        lock = false;
      }, 650);
    }
  }

  sizeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      size = Number(btn.dataset.size);
      sizeButtons.forEach((b) => {
        const active = b === btn;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-pressed", String(active));
      });
      newGame();
    });
  });

  document.getElementById("restart").addEventListener("click", newGame);
  document.getElementById("play-again").addEventListener("click", newGame);

  newGame();
})();
