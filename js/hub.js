/**
 * Hub page — renders the game card grid from GAMES_REGISTRY.
 * Depends on games/games-registry.js being loaded first.
 */
(function () {
  const grid = document.getElementById("game-grid");
  if (!grid || !window.GAMES_REGISTRY) return;

  const fragment = document.createDocumentFragment();

  window.GAMES_REGISTRY.forEach((game) => {
    const li = document.createElement("li");

    const link = document.createElement("a");
    link.href = game.path;
    link.className = "card card--interactive";
    link.setAttribute("aria-label", `Play ${game.name}`);

    link.innerHTML = `
      <div class="card__icon">${game.iconSvg}</div>
      <h2 class="card__title">${escapeHtml(game.name)}</h2>
      <p class="card__desc">${escapeHtml(game.description)}</p>
      <span class="card__cta">Play →</span>
    `;

    li.appendChild(link);
    fragment.appendChild(li);
  });

  grid.appendChild(fragment);

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
})();
