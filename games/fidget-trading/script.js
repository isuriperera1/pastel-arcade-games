/**
 * Fidget Trading — Part 1
 * Board, inventories, timer UI, click-to-offer. No AI / trade actions yet.
 */

(function () {
  "use strict";

  const TIMER_START_SEC = 10 * 60;

  const els = {
    timer: document.getElementById("hud-timer"),
    value: document.getElementById("hud-value"),
    theirOffer: document.getElementById("their-offer"),
    theirEmpty: document.getElementById("their-offer-empty"),
    yourOffer: document.getElementById("your-offer"),
    yourEmpty: document.getElementById("your-offer-empty"),
    inventory: document.getElementById("player-inventory"),
  };

  /** @type {{ inventory: object[], offer: object[], aiInventory: object[], aiOffer: object[] }} */
  const state = {
    inventory: [],
    offer: [],
    aiInventory: [],
    aiOffer: [],
    secondsLeft: TIMER_START_SEC,
    timerId: null,
  };

  function formatTime(totalSec) {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function inventoryValue(items) {
    return items.reduce((sum, item) => sum + (item.cost || 0), 0);
  }

  function updateHud() {
    const owned = state.inventory.concat(state.offer);
    const value = inventoryValue(owned);
    els.value.textContent = `${value} diamonds`;
    els.timer.textContent = formatTime(state.secondsLeft);
  }

  function updateEmptyHints() {
    els.yourEmpty.classList.toggle("is-hidden", state.offer.length > 0);
    els.theirEmpty.classList.toggle("is-hidden", state.aiOffer.length > 0);
  }

  function shapeMarkup(shapeKey, fill) {
    const raw = (window.FIDGET_SHAPES && window.FIDGET_SHAPES[shapeKey]) || window.FIDGET_SHAPES.round;
    return raw.replace(/<(\w+)/g, `<$1 fill="${fill}"`);
  }

  function renderBlobArt(item) {
    const fill = item.colorway.fill;
    const accent = item.colorway.accent || fill;
    const shapes = shapeMarkup(item.svgShape, fill);
    const faceBits =
      item.svgShape === "ears"
        ? `<circle cx="24" cy="34" r="2.2" fill="${accent}" opacity="0.55"/>
           <circle cx="40" cy="34" r="2.2" fill="${accent}" opacity="0.55"/>
           <path d="M28 42 Q32 45 36 42" fill="none" stroke="${accent}" stroke-width="1.6" stroke-linecap="round" opacity="0.5"/>`
        : `<circle cx="24" cy="32" r="2.2" fill="${accent}" opacity="0.5"/>
           <circle cx="40" cy="32" r="2.2" fill="${accent}" opacity="0.5"/>
           <path d="M28 40 Q32 43 36 40" fill="none" stroke="${accent}" stroke-width="1.6" stroke-linecap="round" opacity="0.45"/>`;

    let extras = "";
    if (item.tier === "glitter") {
      extras = `<span class="fidget-blob__sparkle" aria-hidden="true"></span>
                <span class="fidget-blob__shimmer" aria-hidden="true"></span>`;
    } else if (item.tier === "butter") {
      extras = `<span class="fidget-blob__gloss" aria-hidden="true"></span>`;
    }

    return `
      <div class="fidget-blob fidget-blob--${item.tier}">
        <div class="fidget-blob__face">
          <svg class="fidget-card__svg" viewBox="0 0 64 64" aria-hidden="true">
            ${shapes}
            ${faceBits}
          </svg>
        </div>
        ${extras}
      </div>
    `;
  }

  function createCard(item, location) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `fidget-card fidget-card--${item.tier}`;
    btn.dataset.instanceId = item.instanceId;
    btn.dataset.location = location;
    btn.setAttribute(
      "aria-label",
      `${item.name}, ${item.tier} tier, ${item.cost} diamonds. ${
        location === "inventory" ? "Add to your offer" : "Return to inventory"
      }`
    );
    btn.innerHTML = `
      <div class="fidget-card__art">${renderBlobArt(item)}</div>
      <span class="fidget-card__name">${item.name}</span>
      <span class="fidget-card__tier">${item.tier}</span>
    `;
    btn.addEventListener("click", () => onCardClick(item.instanceId, location));
    return btn;
  }

  function renderList(container, items, location) {
    container.replaceChildren();
    for (const item of items) {
      container.appendChild(createCard(item, location));
    }
  }

  function renderAll() {
    renderList(els.inventory, state.inventory, "inventory");
    renderList(els.yourOffer, state.offer, "offer");
    renderList(els.theirOffer, state.aiOffer, "ai-offer");
    updateEmptyHints();
    updateHud();
  }

  function findOwned(instanceId) {
    const invIdx = state.inventory.findIndex((i) => i.instanceId === instanceId);
    if (invIdx >= 0) return { list: "inventory", index: invIdx };
    const offerIdx = state.offer.findIndex((i) => i.instanceId === instanceId);
    if (offerIdx >= 0) return { list: "offer", index: offerIdx };
    return null;
  }

  function onCardClick(instanceId, location) {
    if (location === "ai-offer") return;

    const found = findOwned(instanceId);
    if (!found) return;

    if (found.list === "inventory") {
      const [item] = state.inventory.splice(found.index, 1);
      state.offer.push(item);
    } else if (found.list === "offer") {
      const [item] = state.offer.splice(found.index, 1);
      state.inventory.push(item);
    }

    renderAll();
  }

  function tickTimer() {
    if (state.secondsLeft <= 0) {
      state.secondsLeft = 0;
      updateHud();
      if (state.timerId) {
        clearInterval(state.timerId);
        state.timerId = null;
      }
      return;
    }
    state.secondsLeft -= 1;
    updateHud();
  }

  function startTimer() {
    if (state.timerId) clearInterval(state.timerId);
    state.secondsLeft = TIMER_START_SEC;
    updateHud();
    state.timerId = setInterval(tickTimer, 1000);
  }

  function newGame() {
    state.inventory = window.generateStartingInventory();
    state.offer = [];
    state.aiInventory = window.generateAIInventory();
    state.aiOffer = [];
    renderAll();
    startTimer();
  }

  newGame();
})();
