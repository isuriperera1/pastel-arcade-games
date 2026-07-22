/**
 * Shared page shell — injects the top navigation bar.
 *
 * Usage on any page:
 *   <div id="site-nav" data-base="."></div>
 *   <script src="js/shell.js"></script>
 *
 * data-base is the relative path from the current HTML file to the repo root.
 *   Hub (index.html):            data-base="."
 *   Game pages (games/.../):      data-base="../.."
 */
(function () {
  const mount = document.getElementById("site-nav");
  if (!mount) return;

  const base = (mount.dataset.base || ".").replace(/\/$/, "");
  const isHub = mount.dataset.hub === "true";
  const homeHref = `${base}/index.html`;

  const markSvg = `
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none">
      <rect x="3" y="10" width="7" height="11" rx="2" fill="#3A3159" opacity="0.85"/>
      <rect x="9" y="4" width="7" height="10" rx="2" fill="#F5EFE3"/>
      <rect x="14" y="8" width="7" height="13" rx="2" fill="#B9A9D6"/>
    </svg>
  `;

  const backLink = isHub
    ? ""
    : `<a class="btn btn--ghost btn--sm" href="${homeHref}">Back to Arcade</a>`;

  mount.innerHTML = `
    <header class="topbar" role="banner">
      <div class="topbar__inner">
        <a class="brand" href="${homeHref}" aria-label="Aracage Games home">
          <span class="brand__mark">${markSvg}</span>
          <span>Aracage Games</span>
        </a>
        <div class="topbar__actions">
          ${backLink}
          <div
            class="topbar__profile-slot"
            title="Score / profile — coming soon"
            aria-hidden="true"
          >···</div>
        </div>
      </div>
    </header>
  `;
})();
