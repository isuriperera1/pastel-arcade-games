/**
 * Tic-Tac-Toe — 2-player local or vs simple AI.
 * Round scores (X / O / draws) persist in localStorage.
 */
(function () {
  const SCORE_KEY = "arcade-games-ttt-scores";
  const WINS = [
    [0, 1, 2],
    [3, 4, 5],
    [6, 7, 8],
    [0, 3, 6],
    [1, 4, 7],
    [2, 5, 8],
    [0, 4, 8],
    [2, 4, 6],
  ];

  /* Line endpoints in 0–100 viewBox (cell centers) */
  const LINE_COORDS = {
    "0,1,2": [8, 16.6, 92, 16.6],
    "3,4,5": [8, 50, 92, 50],
    "6,7,8": [8, 83.4, 92, 83.4],
    "0,3,6": [16.6, 8, 16.6, 92],
    "1,4,7": [50, 8, 50, 92],
    "2,5,8": [83.4, 8, 83.4, 92],
    "0,4,8": [12, 12, 88, 88],
    "2,4,6": [88, 12, 12, 88],
  };

  const cells = [...document.querySelectorAll(".ttt-cell")];
  const statusEl = document.getElementById("status");
  const winLine = document.getElementById("win-line");
  const winLineSeg = winLine.querySelector("line");
  const scoreEls = {
    X: document.getElementById("score-x"),
    O: document.getElementById("score-o"),
    draw: document.getElementById("score-draw"),
  };
  const modeButtons = document.querySelectorAll(".seg__btn");

  let board = Array(9).fill(null);
  let turn = "X";
  let locked = false;
  let mode = "pvp"; // pvp | ai
  let scores = loadScores();

  renderScores();

  function loadScores() {
    try {
      const raw = JSON.parse(localStorage.getItem(SCORE_KEY) || "{}");
      return {
        X: Number(raw.X) || 0,
        O: Number(raw.O) || 0,
        draw: Number(raw.draw) || 0,
      };
    } catch {
      return { X: 0, O: 0, draw: 0 };
    }
  }

  function saveScores() {
    localStorage.setItem(SCORE_KEY, JSON.stringify(scores));
  }

  function renderScores() {
    scoreEls.X.textContent = String(scores.X);
    scoreEls.O.textContent = String(scores.O);
    scoreEls.draw.textContent = String(scores.draw);
  }

  function checkWin(b = board) {
    for (const line of WINS) {
      const [a, b1, c] = line;
      if (b[a] && b[a] === b[b1] && b[a] === b[c]) {
        return { winner: b[a], line };
      }
    }
    if (b.every(Boolean)) return { winner: "draw", line: null };
    return null;
  }

  function drawWinLine(line) {
    const key = line.join(",");
    const coords = LINE_COORDS[key];
    if (!coords) return;
    const [x1, y1, x2, y2] = coords;
    winLineSeg.setAttribute("x1", x1);
    winLineSeg.setAttribute("y1", y1);
    winLineSeg.setAttribute("x2", x2);
    winLineSeg.setAttribute("y2", y2);
    winLine.classList.remove("is-visible");
    // restart animation
    void winLine.offsetWidth;
    winLine.classList.add("is-visible");
    line.forEach((i) => cells[i].classList.add("is-win"));
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function endRound(result) {
    locked = true;
    if (result.winner === "draw") {
      scores.draw += 1;
      setStatus("It’s a draw");
    } else {
      scores[result.winner] += 1;
      setStatus(`${result.winner} wins!`);
      drawWinLine(result.line);
    }
    saveScores();
    renderScores();
  }

  function place(i, mark) {
    if (board[i] || locked) return false;
    board[i] = mark;
    cells[i].dataset.mark = mark;
    cells[i].textContent = mark;
    cells[i].disabled = true;
    cells[i].setAttribute("aria-label", `Cell ${i + 1}, ${mark}`);

    const result = checkWin();
    if (result) {
      endRound(result);
      return true;
    }
    turn = mark === "X" ? "O" : "X";
    setStatus(mode === "ai" && turn === "O" ? "AI is thinking…" : `${turn}’s turn`);
    return true;
  }

  /** Simple AI: win > block > center > corner > side */
  function aiMove() {
    if (locked || turn !== "O") return;

    const tryWinningOrBlock = (mark) => {
      for (let i = 0; i < 9; i++) {
        if (board[i]) continue;
        const trial = board.slice();
        trial[i] = mark;
        const r = checkWin(trial);
        if (r && r.winner === mark) return i;
      }
      return null;
    };

    let idx = tryWinningOrBlock("O");
    if (idx === null) idx = tryWinningOrBlock("X");
    if (idx === null && !board[4]) idx = 4;
    if (idx === null) {
      const corners = [0, 2, 6, 8].filter((i) => !board[i]);
      if (corners.length) idx = corners[Math.floor(Math.random() * corners.length)];
    }
    if (idx === null) {
      const sides = [1, 3, 5, 7].filter((i) => !board[i]);
      if (sides.length) idx = sides[Math.floor(Math.random() * sides.length)];
    }
    if (idx === null) return;

    setTimeout(() => {
      place(idx, "O");
    }, 380);
  }

  function onCellClick(i) {
    if (locked || board[i]) return;
    if (mode === "ai" && turn !== "X") return;
    if (!place(i, turn)) return;
    if (mode === "ai" && !locked && turn === "O") aiMove();
  }

  function resetBoard(keepScores = true) {
    board = Array(9).fill(null);
    turn = "X";
    locked = false;
    winLine.classList.remove("is-visible");
    cells.forEach((cell, i) => {
      cell.textContent = "";
      cell.disabled = false;
      delete cell.dataset.mark;
      cell.classList.remove("is-win");
      cell.setAttribute("aria-label", `Cell ${i + 1}`);
    });
    setStatus("X’s turn");
    if (!keepScores) {
      scores = { X: 0, O: 0, draw: 0 };
      saveScores();
      renderScores();
    }
  }

  cells.forEach((cell) => {
    cell.addEventListener("click", () => onCellClick(Number(cell.dataset.i)));
  });

  document.getElementById("play-again").addEventListener("click", () => resetBoard(true));

  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      mode = btn.dataset.mode;
      modeButtons.forEach((b) => {
        const active = b === btn;
        b.classList.toggle("is-active", active);
        b.setAttribute("aria-pressed", String(active));
      });
      resetBoard(true);
    });
  });
})();
