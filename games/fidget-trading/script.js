/**
 * Fidget Trading — Parts 1–4
 * Board, inventories, click-to-offer, fairness meter, AI reactions,
 * Accept / Decline / Counter, timer enforcement & end-of-session.
 */

(function () {
  "use strict";

  const TIMER_START_SEC = 10 * 60;
  const TIMER_URGENT_SEC = 60;
  const STARTING_BUDGET = 20;

  /** Typical opening ask (diamonds) — AI opening offer aims for 70–100% of this. */
  const TYPICAL_OPENING_ASK = 8;

  /**
   * Personality / difficulty: shifts accept & decline thresholds by this fraction.
   * Positive = pickier AI (harder); negative = more generous (easier).
   * Keep in roughly ±0.05–0.10.
   */
  const AI_PERSONALITY = 0.05;

  const AI_OPENING_DELAY_MS = 1000;
  const AI_EVAL_DEBOUNCE_MS = 800;
  const AI_THINK_PAUSE_MS = 1500;
  const AI_SPEECH_MS = 3200;
  const SWAP_ANIM_MS = 560;
  const RETURN_ANIM_MS = 420;
  const RECEIVED_GLOW_MS = 1000;
  const VALUE_FLASH_MS = 1100;
  const POST_TRADE_OPENING_DELAY_MS = 900;
  const HINT_MS = 2200;
  const CONFETTI_MIN = 40;
  const CONFETTI_MAX = 60;
  const CONFETTI_DURATION_MS = 2600;
  const TIER_ORDER = { normal: 0, glitter: 1, butter: 2 };
  const CONFETTI_COLORS = [
    "var(--teal)",
    "var(--lavender)",
    "var(--pink)",
    "var(--cream)",
  ];
  const prefersReducedMotion = () =>
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /**
   * Fairness ratio = playerOfferValue / aiOfferValue
   * Higher ratio → better for the AI (player giving more relative to what they get).
   * - ratio >= acceptThreshold (~0.95 ± personality): fair-to-AI-favorable
   * - counter band: [declineThreshold, acceptThreshold)
   * - ratio < declineThreshold (~0.75 ± personality): heavily favors player
   */
  const RATIO_ACCEPT_BASE = 0.95;
  const RATIO_DECLINE_BASE = 0.75;

  const els = {
    timer: document.getElementById("hud-timer"),
    value: document.getElementById("hud-value"),
    trades: document.getElementById("hud-trades"),
    valueFlash: document.getElementById("value-flash"),
    table: document.querySelector(".fidget-table"),
    theirOffer: document.getElementById("their-offer"),
    theirEmpty: document.getElementById("their-offer-empty"),
    yourOffer: document.getElementById("your-offer"),
    yourEmpty: document.getElementById("your-offer-empty"),
    inventory: document.getElementById("player-inventory"),
    fairnessFill: document.getElementById("fairness-fill"),
    fairnessMarker: document.getElementById("fairness-marker"),
    fairnessReadout: document.getElementById("fairness-readout"),
    aiStatus: document.getElementById("ai-status"),
    aiSpeech: document.getElementById("ai-speech"),
    aiSpeechText: document.getElementById("ai-speech-text"),
    btnAccept: document.getElementById("btn-accept"),
    btnDecline: document.getElementById("btn-decline"),
    btnCounter: document.getElementById("btn-counter"),
    btnEndTrading: document.getElementById("btn-end-trading"),
    btnTradeAgain: document.getElementById("btn-trade-again"),
    actionHint: document.getElementById("trade-action-hint"),
    endOverlay: document.getElementById("end-overlay"),
    endConfetti: document.getElementById("end-confetti"),
    endItemCount: document.getElementById("end-item-count"),
    endValue: document.getElementById("end-value"),
    endTrades: document.getElementById("end-trades"),
    endCompare: document.getElementById("end-compare"),
    endInventory: document.getElementById("end-inventory"),
  };

  /** @type {{ inventory: object[], offer: object[], aiInventory: object[], aiOffer: object[], secondsLeft: number, timerId: number|null, lastDecision: string|null, openingDone: boolean, tradesCompleted: number, locked: boolean, sessionEnded: boolean, startingValue: number, justReceivedIds: Set<string> }} */
  const state = {
    inventory: [],
    offer: [],
    aiInventory: [],
    aiOffer: [],
    secondsLeft: TIMER_START_SEC,
    timerId: null,
    lastDecision: null,
    openingDone: false,
    tradesCompleted: 0,
    locked: false,
    sessionEnded: false,
    startingValue: STARTING_BUDGET,
    justReceivedIds: new Set(),
  };

  let evalDebounceId = null;
  let thinkTimeoutId = null;
  let openingTimeoutId = null;
  let speechTimeoutId = null;
  let hintTimeoutId = null;
  let flashTimeoutId = null;
  let glowTimeoutId = null;
  let swapTimeoutId = null;
  let returnTimeoutId = null;
  let evalGeneration = 0;
  let audioCtx = null;

  function formatTime(totalSec) {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function inventoryValue(items) {
    return items.reduce((sum, item) => sum + (item.cost || 0), 0);
  }

  function playerOwnedValue() {
    return inventoryValue(state.inventory.concat(state.offer));
  }

  /**
   * Sum diamond costs on each side of the trade.
   *
   * ratio = playerOfferValue / aiOfferValue (AI-centric: higher = better for AI).
   * delta = aiOfferValue - playerOfferValue (player gain in diamonds; positive = player favored).
   *
   * Empty-offer safety:
   * - both empty → ratio 1, delta 0
   * - only AI empty → ratio Infinity (player giving something for nothing — great for AI)
   * - only player empty → ratio 0 (player getting free stuff — bad for AI)
   *
   * @returns {{ playerOfferValue: number, aiOfferValue: number, ratio: number, delta: number }}
   */
  function calculateFairness(playerOfferItems, aiOfferItems) {
    const playerOfferValue = inventoryValue(playerOfferItems || []);
    const aiOfferValue = inventoryValue(aiOfferItems || []);
    const delta = aiOfferValue - playerOfferValue;

    let ratio;
    if (playerOfferValue === 0 && aiOfferValue === 0) {
      ratio = 1;
    } else if (aiOfferValue === 0) {
      ratio = Infinity;
    } else {
      ratio = playerOfferValue / aiOfferValue;
    }

    return { playerOfferValue, aiOfferValue, ratio, delta };
  }

  function acceptThreshold() {
    return RATIO_ACCEPT_BASE + AI_PERSONALITY;
  }

  function declineThreshold() {
    return Math.max(0.5, RATIO_DECLINE_BASE - AI_PERSONALITY);
  }

  /**
   * Decide how the AI feels about the current trade.
   * @returns {"accept"|"counter"|"decline"}
   */
  function aiEvaluateTrade(playerOfferItems, aiOfferItems) {
    const { ratio, playerOfferValue, aiOfferValue } = calculateFairness(
      playerOfferItems,
      aiOfferItems
    );

    if (playerOfferValue === 0 && aiOfferValue === 0) {
      return "counter";
    }

    // Player offering nothing while AI has items on the table → decline
    if (playerOfferValue === 0) {
      return "decline";
    }

    // AI offering nothing while player put items up → accept lean (free gift) or counter
    if (aiOfferValue === 0) {
      return Math.random() < 0.85 ? "accept" : "counter";
    }

    const acceptAt = acceptThreshold();
    const declineAt = declineThreshold();

    // Fair-to-AI-favorable: ~80% accept, ~20% still counter for a bit more
    if (ratio >= acceptAt) {
      return Math.random() < 0.8 ? "accept" : "counter";
    }

    // Heavily favors player
    if (ratio < declineAt) {
      return "decline";
    }

    // Close band — lean counter
    return "counter";
  }

  function updateHud() {
    const value = playerOwnedValue();
    els.value.textContent = `${value} diamonds`;
    els.timer.textContent = formatTime(state.secondsLeft);
    els.timer.classList.toggle(
      "is-urgent",
      state.secondsLeft > 0 && state.secondsLeft <= TIMER_URGENT_SEC && !state.sessionEnded
    );
    const n = state.tradesCompleted;
    els.trades.textContent = n === 1 ? "1 trade made" : `${n} trades made`;
    if (els.btnEndTrading) {
      els.btnEndTrading.disabled = state.sessionEnded;
    }
  }

  function updateEmptyHints() {
    els.yourEmpty.classList.toggle("is-hidden", state.offer.length > 0);
    els.theirEmpty.classList.toggle("is-hidden", state.aiOffer.length > 0);
  }

  function canAcceptTrade() {
    return state.offer.length > 0 && state.aiOffer.length > 0;
  }

  function updateActionButtons() {
    const busy = state.locked || !state.openingDone || state.sessionEnded;
    const hasAnyOffer = state.offer.length > 0 || state.aiOffer.length > 0;

    els.btnAccept.disabled = busy || !canAcceptTrade();
    els.btnDecline.disabled = busy || !hasAnyOffer;
    els.btnCounter.disabled = busy || state.aiInventory.length === 0;
    if (els.btnEndTrading) {
      els.btnEndTrading.disabled = state.sessionEnded;
    }
  }

  function setAiStatus(text, tone) {
    els.aiStatus.textContent = text || "";
    if (tone) {
      els.aiStatus.dataset.tone = tone;
    } else {
      delete els.aiStatus.dataset.tone;
    }
  }

  function hideAiSpeech() {
    if (speechTimeoutId) {
      clearTimeout(speechTimeoutId);
      speechTimeoutId = null;
    }
    els.aiSpeech.hidden = true;
    els.aiSpeechText.textContent = "";
  }

  function showAiSpeech(message) {
    hideAiSpeech();
    els.aiSpeechText.textContent = message;
    els.aiSpeech.hidden = false;
    // Retrigger CSS animation
    els.aiSpeech.style.animation = "none";
    void els.aiSpeech.offsetWidth;
    els.aiSpeech.style.animation = "";
    speechTimeoutId = setTimeout(() => {
      els.aiSpeech.hidden = true;
      speechTimeoutId = null;
    }, AI_SPEECH_MS);
  }

  function showActionHint(message) {
    if (hintTimeoutId) {
      clearTimeout(hintTimeoutId);
      hintTimeoutId = null;
    }
    els.actionHint.textContent = message;
    els.actionHint.hidden = false;
    hintTimeoutId = setTimeout(() => {
      els.actionHint.hidden = true;
      els.actionHint.textContent = "";
      hintTimeoutId = null;
    }, HINT_MS);
  }

  function flashInventoryValue(newValue, delta) {
    if (flashTimeoutId) {
      clearTimeout(flashTimeoutId);
      flashTimeoutId = null;
    }
    const tone = delta > 0 ? "up" : delta < 0 ? "down" : "same";
    els.valueFlash.textContent = `Your inventory value: ${newValue} diamonds`;
    els.valueFlash.dataset.tone = tone;
    els.valueFlash.hidden = false;
    els.valueFlash.style.animation = "none";
    void els.valueFlash.offsetWidth;
    els.valueFlash.style.animation = "";
    flashTimeoutId = setTimeout(() => {
      els.valueFlash.hidden = true;
      flashTimeoutId = null;
    }, VALUE_FLASH_MS);
  }

  function playTradeDing() {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      if (!audioCtx) audioCtx = new Ctx();
      if (audioCtx.state === "suspended") audioCtx.resume();

      const t0 = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(740, t0);
      osc.frequency.exponentialRampToValueAtTime(1180, t0 + 0.09);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.11, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.3);
    } catch (_) {
      /* silent if audio blocked */
    }
  }

  /**
   * Map player delta (aiValue - playerValue) to marker position.
   * Center = equal; left = player favored (green); right = AI favored (pink).
   */
  function updateFairnessMeter() {
    const { playerOfferValue, aiOfferValue, delta } = calculateFairness(
      state.offer,
      state.aiOffer
    );

    if (playerOfferValue === 0 && aiOfferValue === 0) {
      els.fairnessMarker.style.left = "50%";
      els.fairnessMarker.style.borderColor = "var(--lavender)";
      els.fairnessMarker.style.background = "var(--surface)";
      els.fairnessFill.style.opacity = "0.12";
      els.fairnessReadout.textContent = "Add items to see fairness";
      els.fairnessReadout.dataset.lean = "";
      return;
    }

    // Soft-clamp visual span: ±12 diamonds → full track width
    const span = 12;
    const t = Math.max(-1, Math.min(1, delta / span));
    const leftPct = 50 - t * 48;
    els.fairnessMarker.style.left = `${leftPct}%`;

    if (delta > 0) {
      els.fairnessMarker.style.borderColor = "var(--teal)";
      els.fairnessFill.style.background =
        "color-mix(in srgb, var(--teal) 55%, transparent)";
      els.fairnessFill.style.opacity = "0.28";
      els.fairnessReadout.dataset.lean = "player";
      els.fairnessReadout.textContent =
        delta === 1 ? "Your gain: +1 diamond" : `Your gain: +${delta} diamonds`;
    } else if (delta < 0) {
      const down = Math.abs(delta);
      els.fairnessMarker.style.borderColor = "var(--pink)";
      els.fairnessFill.style.background =
        "color-mix(in srgb, var(--pink) 55%, transparent)";
      els.fairnessFill.style.opacity = "0.28";
      els.fairnessReadout.dataset.lean = "ai";
      els.fairnessReadout.textContent =
        down === 1 ? "You're down 1 diamond" : `You're down ${down} diamonds`;
    } else {
      els.fairnessMarker.style.borderColor = "var(--lavender)";
      els.fairnessFill.style.background =
        "color-mix(in srgb, var(--lavender) 45%, transparent)";
      els.fairnessFill.style.opacity = "0.22";
      els.fairnessReadout.dataset.lean = "equal";
      els.fairnessReadout.textContent = "Even trade — equal diamond value";
    }
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

  function createCard(item, location, options) {
    const opts = options || {};
    const staticCard = !!opts.static;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `fidget-card fidget-card--${item.tier}`;
    if (state.justReceivedIds.has(item.instanceId) && !staticCard) {
      btn.classList.add("is-just-received");
    }
    btn.dataset.instanceId = item.instanceId;
    btn.dataset.location = location;
    btn.disabled = staticCard || state.locked || state.sessionEnded;
    btn.setAttribute(
      "aria-label",
      staticCard
        ? `${item.name}, ${item.tier} tier, ${item.cost} diamonds`
        : `${item.name}, ${item.tier} tier, ${item.cost} diamonds. ${
            location === "inventory" ? "Add to your offer" : "Return to inventory"
          }`
    );
    btn.innerHTML = `
      <div class="fidget-card__art">${renderBlobArt(item)}</div>
      <span class="fidget-card__name">${item.name}</span>
      <span class="fidget-card__tier">${item.tier}</span>
    `;
    if (!staticCard) {
      btn.addEventListener("click", () => onCardClick(item.instanceId, location));
    }
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
    updateFairnessMeter();
    updateActionButtons();
  }

  function findOwned(instanceId) {
    const invIdx = state.inventory.findIndex((i) => i.instanceId === instanceId);
    if (invIdx >= 0) return { list: "inventory", index: invIdx };
    const offerIdx = state.offer.findIndex((i) => i.instanceId === instanceId);
    if (offerIdx >= 0) return { list: "offer", index: offerIdx };
    return null;
  }

  function clearPendingAiTimers() {
    if (evalDebounceId) {
      clearTimeout(evalDebounceId);
      evalDebounceId = null;
    }
    if (thinkTimeoutId) {
      clearTimeout(thinkTimeoutId);
      thinkTimeoutId = null;
    }
    evalGeneration += 1;
  }

  function clearOpeningTimer() {
    if (openingTimeoutId) {
      clearTimeout(openingTimeoutId);
      openingTimeoutId = null;
    }
  }

  function scheduleAiEvaluation() {
    if (!state.openingDone || state.locked || state.sessionEnded) return;

    if (evalDebounceId) clearTimeout(evalDebounceId);
    if (thinkTimeoutId) {
      clearTimeout(thinkTimeoutId);
      thinkTimeoutId = null;
    }

    const gen = ++evalGeneration;

    if (state.offer.length === 0) {
      setAiStatus("", null);
      hideAiSpeech();
      state.lastDecision = null;
      return;
    }

    setAiStatus("AI is considering...", "thinking");

    evalDebounceId = setTimeout(() => {
      evalDebounceId = null;
      if (gen !== evalGeneration || state.locked) return;
      runAiEvaluation(gen);
    }, AI_EVAL_DEBOUNCE_MS);
  }

  /**
   * Pick a small counter adjustment: add the cheapest useful inventory item,
   * or remove the cheapest offer item — whichever closes fairness better with
   * the smaller absolute diamond change.
   */
  function applyAiCounter() {
    const before = calculateFairness(state.offer, state.aiOffer);
    const candidates = [];

    for (let i = 0; i < state.aiInventory.length; i++) {
      const item = state.aiInventory[i];
      const trialOffer = state.aiOffer.concat([item]);
      const after = calculateFairness(state.offer, trialOffer);
      candidates.push({
        kind: "add",
        index: i,
        item,
        cost: item.cost,
        afterRatio: after.ratio,
        score: scoreCounterMove(before.ratio, after.ratio, item.cost),
      });
    }

    for (let i = 0; i < state.aiOffer.length; i++) {
      const item = state.aiOffer[i];
      const trialOffer = state.aiOffer.slice(0, i).concat(state.aiOffer.slice(i + 1));
      const after = calculateFairness(state.offer, trialOffer);
      candidates.push({
        kind: "remove",
        index: i,
        item,
        cost: item.cost,
        afterRatio: after.ratio,
        score: scoreCounterMove(before.ratio, after.ratio, item.cost),
      });
    }

    if (!candidates.length) return false;

    candidates.sort((a, b) => a.score - b.score || a.cost - b.cost);
    const best = candidates[0];

    if (best.kind === "add") {
      const [item] = state.aiInventory.splice(best.index, 1);
      state.aiOffer.push(item);
    } else {
      const [item] = state.aiOffer.splice(best.index, 1);
      state.aiInventory.push(item);
    }

    return true;
  }

  /**
   * Lower score = better. Prefer moves that increase ratio toward/above accept,
   * with smaller diamond adjustments.
   */
  function scoreCounterMove(beforeRatio, afterRatio, cost) {
    const target = acceptThreshold();
    const finiteBefore = Number.isFinite(beforeRatio) ? beforeRatio : 10;
    const finiteAfter = Number.isFinite(afterRatio) ? afterRatio : 10;
    const improved = finiteAfter - finiteBefore;
    const dist = Math.abs(finiteAfter - target);
    return dist * 10 - improved * 8 + cost * 0.35;
  }

  /**
   * Player "Add more" nudge: AI may add one inventory item to Their Offer
   * if the resulting deal is still reasonable for the AI.
   * @returns {boolean} whether an item was added
   */
  function tryAiAddMore() {
    if (!state.aiInventory.length) return false;

    const declineAt = declineThreshold();
    // Soft floor: stay above ~decline band; slightly stricter so AI doesn't gift freely
    const minRatio = Math.max(declineAt, declineThreshold() + 0.05);

    const candidates = [];
    for (let i = 0; i < state.aiInventory.length; i++) {
      const item = state.aiInventory[i];
      const trialOffer = state.aiOffer.concat([item]);
      const after = calculateFairness(state.offer, trialOffer);
      const finiteRatio = Number.isFinite(after.ratio) ? after.ratio : 0;

      // Adding always lowers ratio (AI gives more). Allow only if still not too unfair.
      if (finiteRatio < minRatio && state.offer.length > 0) continue;
      // If player hasn't offered anything, AI only adds a cheap token if inventory has normals
      if (state.offer.length === 0 && item.cost > 2) continue;

      candidates.push({
        index: i,
        item,
        cost: item.cost,
        ratio: finiteRatio,
      });
    }

    if (!candidates.length) return false;

    // Prefer cheapest add that still keeps ratio reasonable
    candidates.sort((a, b) => a.cost - b.cost || b.ratio - a.ratio);
    const best = candidates[0];
    const [item] = state.aiInventory.splice(best.index, 1);
    state.aiOffer.push(item);
    return true;
  }

  function runAiEvaluation(gen) {
    if (gen !== evalGeneration || state.locked) return;
    if (state.offer.length === 0) {
      setAiStatus("", null);
      return;
    }

    const decision = aiEvaluateTrade(state.offer, state.aiOffer);
    state.lastDecision = decision;

    if (decision === "accept") {
      setAiStatus("AI is happy with this", "happy");
      hideAiSpeech();
      return;
    }

    if (decision === "decline") {
      setAiStatus("AI wants more!", "decline");
      showAiSpeech("That's not a fair trade for me!");
      return;
    }

    // counter
    setAiStatus("AI is thinking...", "thinking");
    thinkTimeoutId = setTimeout(() => {
      thinkTimeoutId = null;
      if (gen !== evalGeneration || state.locked) return;

      const changed = applyAiCounter();
      renderAll();

      if (changed) {
        setAiStatus("AI wants more!", "counter");
      } else {
        setAiStatus("AI wants more!", "decline");
        showAiSpeech("That's not a fair trade for me!");
      }
    }, AI_THINK_PAUSE_MS);
  }

  /**
   * Place 1–3 AI inventory items as an opening offer.
   * Target combined value ≈ 70–100% of TYPICAL_OPENING_ASK (slightly AI-favorable).
   */
  function placeAiOpeningOffer() {
    if (state.sessionEnded) return;

    if (!state.aiInventory.length) {
      state.openingDone = true;
      state.locked = false;
      setAiStatus("AI has nothing left to offer", "decline");
      renderAll();
      return;
    }

    const low = Math.round(TYPICAL_OPENING_ASK * 0.7);
    const high = Math.round(TYPICAL_OPENING_ASK * 1.0);
    const target = low + Math.floor(Math.random() * (high - low + 1));

    const pool = state.aiInventory.slice().sort((a, b) => a.cost - b.cost);
    const picked = [];
    let total = 0;
    const maxItems = 1 + Math.floor(Math.random() * 3); // 1–3

    while (picked.length < maxItems && pool.length) {
      const need = target - total;
      if (need <= 0 && picked.length >= 1) break;

      let bestIdx = 0;
      let bestScore = Infinity;
      for (let i = 0; i < pool.length; i++) {
        const next = total + pool[i].cost;
        const overshoot = Math.max(0, next - high);
        const score = Math.abs(next - target) + overshoot * 3;
        if (score < bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }

      const [item] = pool.splice(bestIdx, 1);
      picked.push(item);
      total += item.cost;

      if (picked.length >= 1 && total >= low) {
        if (total >= target || (picked.length >= 2 && Math.random() < 0.45)) break;
      }
    }

    if (!picked.length && state.aiInventory.length) {
      picked.push(state.aiInventory[0]);
    }

    const ids = new Set(picked.map((i) => i.instanceId));
    state.aiInventory = state.aiInventory.filter((i) => !ids.has(i.instanceId));
    state.aiOffer = state.aiOffer.concat(picked);
    state.openingDone = true;
    state.locked = false;

    setAiStatus("AI is waiting for your offer", "thinking");
    renderAll();
  }

  function scheduleOpeningOffer(delayMs) {
    if (state.sessionEnded) return;
    clearOpeningTimer();
    clearPendingAiTimers();
    state.openingDone = false;
    state.lastDecision = null;
    state.locked = true;
    hideAiSpeech();
    setAiStatus("AI is preparing an offer…", "thinking");
    updateActionButtons();

    openingTimeoutId = setTimeout(() => {
      openingTimeoutId = null;
      if (state.sessionEnded) return;
      placeAiOpeningOffer();
    }, delayMs);
  }

  function clearJustReceivedSoon() {
    if (glowTimeoutId) {
      clearTimeout(glowTimeoutId);
      glowTimeoutId = null;
    }
    glowTimeoutId = setTimeout(() => {
      state.justReceivedIds.clear();
      glowTimeoutId = null;
      // Soft refresh without wiping other UI state
      const cards = els.inventory.querySelectorAll(".is-just-received");
      cards.forEach((el) => el.classList.remove("is-just-received"));
    }, RECEIVED_GLOW_MS);
  }

  function executeTradeSwap() {
    const giving = state.offer.slice();
    const receiving = state.aiOffer.slice();
    const receivedIds = receiving.map((i) => i.instanceId);

    // Player offer → AI inventory; AI offer → player inventory
    state.aiInventory = state.aiInventory.concat(giving);
    state.inventory = state.inventory.concat(receiving);
    state.offer = [];
    state.aiOffer = [];
    state.justReceivedIds = new Set(receivedIds);
    state.tradesCompleted += 1;
  }

  function onAccept() {
    if (state.locked || !state.openingDone || state.sessionEnded) return;

    if (!canAcceptTrade()) {
      showActionHint("Add at least one item to trade");
      return;
    }

    clearPendingAiTimers();
    clearOpeningTimer();
    hideAiSpeech();
    state.locked = true;
    updateActionButtons();

    const valueBefore = playerOwnedValue();
    const { delta } = calculateFairness(state.offer, state.aiOffer);

    setAiStatus("Deal!", "happy");
    playTradeDing();
    els.table.classList.add("is-swapping");

    if (swapTimeoutId) clearTimeout(swapTimeoutId);
    swapTimeoutId = setTimeout(() => {
      swapTimeoutId = null;
      els.table.classList.remove("is-swapping");
      if (state.sessionEnded) return;

      executeTradeSwap();

      const valueAfter = playerOwnedValue();
      // delta from fairness: positive = player gained diamonds from the swap
      flashInventoryValue(valueAfter, delta || valueAfter - valueBefore);

      renderAll();
      clearJustReceivedSoon();
      scheduleOpeningOffer(POST_TRADE_OPENING_DELAY_MS);
    }, SWAP_ANIM_MS);
  }

  function returnOffersToInventories() {
    state.inventory = state.inventory.concat(state.offer);
    state.aiInventory = state.aiInventory.concat(state.aiOffer);
    state.offer = [];
    state.aiOffer = [];
  }

  function onDecline() {
    if (state.locked || !state.openingDone || state.sessionEnded) return;
    if (state.offer.length === 0 && state.aiOffer.length === 0) return;

    clearPendingAiTimers();
    clearOpeningTimer();
    hideAiSpeech();
    state.locked = true;
    updateActionButtons();

    els.table.classList.add("is-returning");
    setAiStatus("Trade declined", "decline");
    showActionHint("Trade declined");

    if (returnTimeoutId) clearTimeout(returnTimeoutId);
    returnTimeoutId = setTimeout(() => {
      returnTimeoutId = null;
      els.table.classList.remove("is-returning");
      if (state.sessionEnded) return;

      returnOffersToInventories();
      renderAll();
      scheduleOpeningOffer(POST_TRADE_OPENING_DELAY_MS);
    }, RETURN_ANIM_MS);
  }

  function onCounter() {
    if (state.locked || !state.openingDone || state.sessionEnded) return;

    clearPendingAiTimers();
    hideAiSpeech();

    const added = tryAiAddMore();
    if (added) {
      setAiStatus("AI sweetened the offer", "counter");
      showAiSpeech("Fine — I'll add a little more.");
      renderAll();
      // Re-evaluate if player already has items on the table
      if (state.offer.length > 0) {
        scheduleAiEvaluation();
      }
    } else {
      setAiStatus("AI won't budge", "decline");
      showAiSpeech("I won't add anything else!");
      updateActionButtons();
    }
  }

  function onCardClick(instanceId, location) {
    if (state.locked || state.sessionEnded) return;
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

    hideAiSpeech();
    renderAll();
    scheduleAiEvaluation();
  }

  function stopTimer() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function tickTimer() {
    if (state.sessionEnded) {
      stopTimer();
      return;
    }

    if (state.secondsLeft <= 1) {
      state.secondsLeft = 0;
      updateHud();
      stopTimer();
      endSession();
      return;
    }

    state.secondsLeft -= 1;
    updateHud();
  }

  function startTimer() {
    stopTimer();
    state.secondsLeft = TIMER_START_SEC;
    updateHud();
    state.timerId = setInterval(tickTimer, 1000);
  }

  function clearAnimTimers() {
    if (swapTimeoutId) {
      clearTimeout(swapTimeoutId);
      swapTimeoutId = null;
    }
    if (returnTimeoutId) {
      clearTimeout(returnTimeoutId);
      returnTimeoutId = null;
    }
  }

  function sortByTier(items) {
    return items.slice().sort((a, b) => {
      const ta = TIER_ORDER[a.tier] ?? 99;
      const tb = TIER_ORDER[b.tier] ?? 99;
      if (ta !== tb) return ta - tb;
      return (a.name || "").localeCompare(b.name || "");
    });
  }

  function spawnConfetti() {
    if (!els.endConfetti) return;
    els.endConfetti.replaceChildren();

    if (prefersReducedMotion()) {
      // Static sparkles / soft color flash — no burst animation
      const sparkleCount = 12;
      for (let i = 0; i < sparkleCount; i++) {
        const spark = document.createElement("span");
        spark.className = "fidget-confetti__sparkle";
        spark.style.left = `${8 + Math.random() * 84}%`;
        spark.style.top = `${12 + Math.random() * 70}%`;
        spark.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
        spark.style.animationDelay = `${Math.random() * 0.35}s`;
        els.endConfetti.appendChild(spark);
      }
      return;
    }

    const count =
      CONFETTI_MIN + Math.floor(Math.random() * (CONFETTI_MAX - CONFETTI_MIN + 1));

    for (let i = 0; i < count; i++) {
      const p = document.createElement("span");
      p.className = "fidget-confetti__particle";
      const fromLeft = i % 2 === 0;
      const startX = fromLeft
        ? 4 + Math.random() * 18
        : 78 + Math.random() * 18;
      const dx = (fromLeft ? 1 : -1) * (40 + Math.random() * 120);
      const peak = -(180 + Math.random() * 220);
      const fall = 40 + Math.random() * 120;
      const spin = `${(fromLeft ? 1 : -1) * (120 + Math.random() * 280)}deg`;
      const duration = 2 + Math.random() * 1; // ~2–3s

      p.style.left = `${startX}%`;
      p.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
      p.style.setProperty("--ft-dx", `${dx}px`);
      p.style.setProperty("--ft-peak", `${peak}px`);
      p.style.setProperty("--ft-fall", `${fall}px`);
      p.style.setProperty("--ft-spin", spin);
      p.style.animationDuration = `${duration}s`;
      p.style.animationDelay = `${Math.random() * 0.28}s`;
      p.style.width = `${0.4 + Math.random() * 0.35}rem`;
      p.style.height = `${0.55 + Math.random() * 0.45}rem`;
      els.endConfetti.appendChild(p);
    }

    setTimeout(() => {
      if (els.endConfetti) els.endConfetti.replaceChildren();
    }, CONFETTI_DURATION_MS + 400);
  }

  function renderEndInventory(items) {
    const sorted = sortByTier(items);
    els.endInventory.replaceChildren();
    for (const item of sorted) {
      els.endInventory.appendChild(createCard(item, "end", { static: true }));
    }
  }

  function populateEndModal() {
    const items = state.inventory.slice();
    const endValue = inventoryValue(items);
    const startValue = state.startingValue;
    const delta = endValue - startValue;
    const trades = state.tradesCompleted;

    els.endItemCount.textContent = String(items.length);
    els.endValue.textContent = `${endValue} diamonds`;
    els.endTrades.textContent = String(trades);

    const tone = delta > 0 ? "up" : delta < 0 ? "down" : "same";
    els.endCompare.dataset.tone = tone;
    if (delta > 0) {
      els.endCompare.textContent = `You started with ${startValue} diamonds worth of squishies and ended with ${endValue} — nice gain!`;
    } else if (delta < 0) {
      els.endCompare.textContent = `You started with ${startValue} diamonds worth of squishies and ended with ${endValue}`;
    } else {
      els.endCompare.textContent = `You started with ${startValue} diamonds worth of squishies and ended with ${endValue} — even steven.`;
    }

    renderEndInventory(items);
  }

  function showEndOverlay() {
    populateEndModal();
    els.endOverlay.hidden = false;
    spawnConfetti();
    if (els.btnTradeAgain) {
      els.btnTradeAgain.focus();
    }
  }

  function hideEndOverlay() {
    els.endOverlay.hidden = true;
    if (els.endConfetti) els.endConfetti.replaceChildren();
  }

  /**
   * End trading session (manual button or timer zero).
   * Mid-negotiation offers snap back to rightful owners before final tally.
   */
  function endSession() {
    if (state.sessionEnded) return;
    state.sessionEnded = true;
    state.locked = true;

    stopTimer();
    clearPendingAiTimers();
    clearOpeningTimer();
    clearAnimTimers();
    hideAiSpeech();

    if (hintTimeoutId) {
      clearTimeout(hintTimeoutId);
      hintTimeoutId = null;
    }
    if (flashTimeoutId) {
      clearTimeout(flashTimeoutId);
      flashTimeoutId = null;
    }
    if (glowTimeoutId) {
      clearTimeout(glowTimeoutId);
      glowTimeoutId = null;
    }

    els.table.classList.remove("is-swapping", "is-returning");
    els.valueFlash.hidden = true;
    els.actionHint.hidden = true;

    // Incomplete trade never happened — return offer items to owners
    returnOffersToInventories();
    state.justReceivedIds = new Set();

    setAiStatus("Session complete", "happy");
    renderAll();
    updateActionButtons();
    showEndOverlay();
  }

  function onEndTrading() {
    if (state.sessionEnded) return;
    endSession();
  }

  function newGame() {
    clearPendingAiTimers();
    clearOpeningTimer();
    clearAnimTimers();
    hideAiSpeech();
    hideEndOverlay();
    if (hintTimeoutId) {
      clearTimeout(hintTimeoutId);
      hintTimeoutId = null;
    }
    if (flashTimeoutId) {
      clearTimeout(flashTimeoutId);
      flashTimeoutId = null;
    }
    if (glowTimeoutId) {
      clearTimeout(glowTimeoutId);
      glowTimeoutId = null;
    }

    els.table.classList.remove("is-swapping", "is-returning");
    els.valueFlash.hidden = true;
    els.actionHint.hidden = true;

    state.inventory = window.generateStartingInventory();
    state.offer = [];
    state.aiInventory = window.generateAIInventory();
    state.aiOffer = [];
    state.lastDecision = null;
    state.openingDone = false;
    state.tradesCompleted = 0;
    state.locked = false;
    state.sessionEnded = false;
    state.startingValue = inventoryValue(state.inventory);
    state.justReceivedIds = new Set();

    setAiStatus("AI is preparing an offer…", "thinking");
    renderAll();
    startTimer();

    openingTimeoutId = setTimeout(() => {
      openingTimeoutId = null;
      if (state.sessionEnded) return;
      placeAiOpeningOffer();
    }, AI_OPENING_DELAY_MS);
  }

  els.btnAccept.addEventListener("click", onAccept);
  els.btnDecline.addEventListener("click", onDecline);
  els.btnCounter.addEventListener("click", onCounter);
  if (els.btnEndTrading) {
    els.btnEndTrading.addEventListener("click", onEndTrading);
  }
  if (els.btnTradeAgain) {
    els.btnTradeAgain.addEventListener("click", () => newGame());
  }

  // Expose for debugging / verification
  window.calculateFairness = calculateFairness;
  window.aiEvaluateTrade = aiEvaluateTrade;
  window.endSession = endSession;
  window.returnOffersToInventories = returnOffersToInventories;
  window.__fidgetState = state;

  newGame();
})();
