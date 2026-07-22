/**
 * Peek-a-Boo — whack-a-mole with flat geometric critters.
 * High score in localStorage; spawn rate speeds up as time runs out.
 */
(function () {
  const BEST_KEY = "arcade-games-peek-best";
  const DURATION = 30;
  const HOLES = 9;

  const grid = document.getElementById("grid");
  const scoreEl = document.getElementById("score");
  const timeEl = document.getElementById("time");
  const bestEl = document.getElementById("best");
  const startBtn = document.getElementById("start-btn");
  const againBtn = document.getElementById("again-btn");
  const overlay = document.getElementById("overlay");
  const endMsg = document.getElementById("end-msg");

  let score = 0;
  let best = Number(localStorage.getItem(BEST_KEY) || 0);
  let timeLeft = DURATION;
  let playing = false;
  let countdownId = null;
  let spawnId = null;
  let active = new Set();
  let holeEls = [];

  bestEl.textContent = String(best);

  function buildGrid() {
    grid.innerHTML = "";
    holeEls = [];
    for (let i = 0; i < HOLES; i++) {
      const hole = document.createElement("button");
      hole.type = "button";
      hole.className = "hole";
      hole.dataset.index = String(i);
      hole.dataset.hue = String(i % 4);
      hole.setAttribute("aria-label", `Hole ${i + 1}`);
      hole.innerHTML = `
        <span class="critter" aria-hidden="true"><span class="critter__mouth"></span></span>
        <span class="hole__well" aria-hidden="true"></span>
      `;
      hole.addEventListener("click", () => onHit(i));
      grid.appendChild(hole);
      holeEls.push(hole);
    }
  }

  function spawnIntervalMs() {
    // Speeds up from ~1100ms → ~420ms over the round
    const progress = 1 - timeLeft / DURATION;
    return Math.max(420, 1100 - progress * 680);
  }

  function upDurationMs() {
    const progress = 1 - timeLeft / DURATION;
    return Math.max(480, 900 - progress * 350);
  }

  function clearActive() {
    active.forEach((i) => {
      holeEls[i].classList.remove("is-up", "is-hit");
    });
    active.clear();
  }

  function popOne() {
    if (!playing) return;
    const available = holeEls
      .map((_, i) => i)
      .filter((i) => !active.has(i));
    if (!available.length) return;

    const idx = available[Math.floor(Math.random() * available.length)];
    const hole = holeEls[idx];
    hole.classList.remove("is-hit");
    hole.classList.add("is-up");
    active.add(idx);

    const stay = upDurationMs();
    setTimeout(() => {
      if (!hole.classList.contains("is-hit")) {
        hole.classList.remove("is-up");
      }
      active.delete(idx);
    }, stay);
  }

  function scheduleSpawn() {
    if (!playing) return;
    popOne();
    // Occasionally pop a second critter mid/late game
    if (timeLeft < 18 && Math.random() < 0.35) {
      setTimeout(popOne, 120);
    }
    spawnId = setTimeout(scheduleSpawn, spawnIntervalMs());
  }

  function onHit(i) {
    if (!playing) return;
    const hole = holeEls[i];
    if (!hole.classList.contains("is-up") || hole.classList.contains("is-hit")) {
      return;
    }
    hole.classList.add("is-hit");
    hole.classList.remove("is-up");
    active.delete(i);
    score += 1;
    scoreEl.textContent = String(score);
    setTimeout(() => hole.classList.remove("is-hit"), 180);
  }

  function endGame() {
    playing = false;
    clearTimeout(spawnId);
    clearInterval(countdownId);
    clearActive();
    startBtn.disabled = false;
    startBtn.textContent = "Start";

    if (score > best) {
      best = score;
      localStorage.setItem(BEST_KEY, String(best));
      bestEl.textContent = String(best);
      endMsg.textContent = `New high score: ${score}!`;
    } else {
      endMsg.textContent = `You scored ${score}. Best: ${best}.`;
    }

    overlay.classList.add("is-open");
    overlay.setAttribute("aria-hidden", "false");
  }

  function startGame() {
    overlay.classList.remove("is-open");
    overlay.setAttribute("aria-hidden", "true");
    clearTimeout(spawnId);
    clearInterval(countdownId);
    clearActive();

    score = 0;
    timeLeft = DURATION;
    scoreEl.textContent = "0";
    timeEl.textContent = String(DURATION);
    playing = true;
    startBtn.disabled = true;
    startBtn.textContent = "Playing…";

    countdownId = setInterval(() => {
      timeLeft -= 1;
      timeEl.textContent = String(timeLeft);
      if (timeLeft <= 0) endGame();
    }, 1000);

    scheduleSpawn();
  }

  startBtn.addEventListener("click", startGame);
  againBtn.addEventListener("click", startGame);

  buildGrid();
})();
