/**
 * Headless sim: naive vs attentive trading against rotating desire-aware AI.
 * Models preference rotation, red-herring dialogue noise, variable magnitudes,
 * and anti-farm neutralization — attentive play must still beat naive.
 *
 * Run: node games/fidget-trading/simulate-ai-skill.js
 */
"use strict";

const path = require("path");
const fs = require("fs");
const vm = require("vm");

const itemsPath = path.join(__dirname, "items.js");
const sandbox = { window: {}, Math, console };
vm.runInNewContext(fs.readFileSync(itemsPath, "utf8"), sandbox);
const {
  generateStartingInventory,
  generateAIInventory,
} = sandbox.window;

const RATIO_ACCEPT_BASE = 0.9;
const RATIO_DECLINE_BASE = 0.7;
const AI_PERSONALITY_MIN = -0.08;
const AI_PERSONALITY_MAX = 0.08;
const DESIRE_BOOST_MIN = 0.15;
const DESIRE_BOOST_MAX = 0.4;
const DESIRE_PICK_MIN = 2;
const DESIRE_PICK_MAX = 3;
const DESIRE_ROTATE_TRADES_MIN = 3;
const DESIRE_ROTATE_TRADES_MAX = 4;
const DESIRE_ROTATE_SEC_MIN = 140;
const DESIRE_ROTATE_SEC_MAX = 160;
const DESIRE_HERRING_CHANCE = 0.175;
const DESIRE_FARM_STREAK_LIMIT = 2;
const DESIRE_CAUGHT_ROUNDS_MIN = 1;
const DESIRE_CAUGHT_ROUNDS_MAX = 2;
const AI_COUNTER_CAP = 3;
const SESSIONS = 40;
/** ~10-min session; each attempted trade costs ~45s of "session time". */
const SESSION_SEC = 600;
const SEC_PER_TRADE_ATTEMPT = 45;
const MAX_TRADE_ATTEMPTS = Math.ceil(SESSION_SEC / SEC_PER_TRADE_ATTEMPT) + 2;

function inventoryValue(items) {
  return items.reduce((sum, item) => sum + (item.cost || 0), 0);
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

function rollPersonality() {
  return AI_PERSONALITY_MIN + Math.random() * (AI_PERSONALITY_MAX - AI_PERSONALITY_MIN);
}

function desireBand() {
  return DESIRE_BOOST_MIN + Math.random() * (DESIRE_BOOST_MAX - DESIRE_BOOST_MIN);
}

function rollRotateAfterTrades() {
  return (
    DESIRE_ROTATE_TRADES_MIN +
    Math.floor(Math.random() * (DESIRE_ROTATE_TRADES_MAX - DESIRE_ROTATE_TRADES_MIN + 1))
  );
}

function rollRotateAfterSec() {
  return (
    DESIRE_ROTATE_SEC_MIN +
    Math.floor(Math.random() * (DESIRE_ROTATE_SEC_MAX - DESIRE_ROTATE_SEC_MIN + 1))
  );
}

function rollAiDesires(aiItems) {
  const map = new Map();
  const uniqueIds = [];
  const seen = new Set();
  for (const item of aiItems || []) {
    if (!item || !item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    uniqueIds.push(item.id);
  }
  const ids = shuffle(uniqueIds);
  const overCount = Math.min(
    ids.length,
    DESIRE_PICK_MIN + Math.floor(Math.random() * (DESIRE_PICK_MAX - DESIRE_PICK_MIN + 1))
  );
  const underCount = Math.min(
    Math.max(0, ids.length - overCount),
    DESIRE_PICK_MIN + Math.floor(Math.random() * (DESIRE_PICK_MAX - DESIRE_PICK_MIN + 1))
  );
  for (let i = 0; i < overCount; i++) map.set(ids[i], 1 + desireBand());
  for (let i = 0; i < underCount; i++) map.set(ids[overCount + i], 1 - desireBand());
  return map;
}

/**
 * Attentive belief of desires: learns from accepted trade outcomes (not dialogue).
 * Starts empty; after each accept, updates beliefs from what AI accepted.
 * Also "reads" opening cues with herring noise — attentive corroborates via outcomes.
 */
function createBeliefTracker() {
  /** @type {Map<string, number>} catalog id → believed multiplier */
  const belief = new Map();
  return {
    get(item) {
      if (!item || !item.id) return 1;
      const m = belief.get(item.id);
      return m == null ? 1 : m;
    },
    /** Noisy dialogue cue: may plant a red herring in belief until outcomes correct it. */
    hearCue(item, trueDesire) {
      if (!item || !item.id) return;
      const trueM = trueDesire.get(item.id);
      const actual = trueM == null ? 1 : trueM;
      let heard;
      if (Math.random() < DESIRE_HERRING_CHANCE) {
        if (actual <= 1.05) heard = 1.25;
        else heard = 0.75;
      } else if (actual > 1.05) {
        heard = actual;
      } else if (actual < 0.95) {
        heard = actual;
      } else {
        return;
      }
      // Soft update — outcomes weigh more later
      const prev = belief.get(item.id);
      belief.set(item.id, prev == null ? heard : prev * 0.4 + heard * 0.6);
    },
    /** After accept: player gave X / got Y — infer AI overvalues what it took, undervalues what it gave. */
    learnFromAccept(playerOffer, aiOffer) {
      for (const it of playerOffer || []) {
        if (!it || !it.id) continue;
        const prev = belief.get(it.id) || 1;
        belief.set(it.id, Math.min(1.4, prev * 0.5 + 1.25 * 0.5));
      }
      for (const it of aiOffer || []) {
        if (!it || !it.id) continue;
        const prev = belief.get(it.id) || 1;
        belief.set(it.id, Math.max(0.6, prev * 0.5 + 0.75 * 0.5));
      }
    },
    /** Soft decay when prefs may have rotated — attentive re-evaluates. */
    decayOnRotation() {
      for (const [id, m] of belief) {
        belief.set(id, 1 + (m - 1) * 0.35);
      }
    },
  };
}

function getTrueMult(desire, item) {
  if (!item || !item.id) return 1;
  const m = desire.get(item.id);
  return m == null ? 1 : m;
}

function getEffectiveMult(desire, caughtOnIds, caughtOnRoundsLeft, item) {
  if (!item || !item.id) return 1;
  if (caughtOnRoundsLeft > 0 && caughtOnIds.has(item.id)) return 1;
  return getTrueMult(desire, item);
}

function perceivedValue(desire, caughtOnIds, caughtRounds, items) {
  return (items || []).reduce(
    (s, it) => s + (it.cost || 0) * getEffectiveMult(desire, caughtOnIds, caughtRounds, it),
    0
  );
}

function calculatePerceivedFairness(desire, caughtOnIds, caughtRounds, playerOffer, aiOffer) {
  const playerOfferValue = perceivedValue(desire, caughtOnIds, caughtRounds, playerOffer);
  const aiOfferValue = perceivedValue(desire, caughtOnIds, caughtRounds, aiOffer);
  let ratio;
  if (playerOfferValue === 0 && aiOfferValue === 0) ratio = 1;
  else if (aiOfferValue === 0) ratio = Infinity;
  else ratio = playerOfferValue / aiOfferValue;
  return { playerOfferValue, aiOfferValue, ratio };
}

function acceptThreshold(personality) {
  return RATIO_ACCEPT_BASE + personality;
}

function declineThreshold(personality) {
  return Math.max(0.5, RATIO_DECLINE_BASE - personality);
}

function aiEvaluateTrade(desire, caughtOnIds, caughtRounds, personality, playerOffer, aiOffer, forceResolve) {
  const { ratio, playerOfferValue, aiOfferValue } = calculatePerceivedFairness(
    desire,
    caughtOnIds,
    caughtRounds,
    playerOffer,
    aiOffer
  );
  if (playerOfferValue === 0 && aiOfferValue === 0) {
    return forceResolve ? "decline" : "counter";
  }
  if (playerOfferValue === 0) return "decline";
  if (aiOfferValue === 0) {
    if (forceResolve) return "accept";
    return Math.random() < 0.85 ? "accept" : "counter";
  }
  const acceptAt = acceptThreshold(personality);
  const declineAt = declineThreshold(personality);
  const mid = (acceptAt + declineAt) / 2;
  let decision;
  if (ratio >= acceptAt) {
    decision = Math.random() < 0.8 ? "accept" : "counter";
  } else if (ratio < declineAt) {
    decision = "decline";
  } else {
    decision = "counter";
  }
  if (forceResolve && decision === "counter") {
    decision = ratio >= mid ? "accept" : "decline";
  }
  return decision;
}

function pickRandomSubset(list, maxN) {
  if (!list.length) return [];
  const n = 1 + Math.floor(Math.random() * Math.min(maxN, list.length));
  return shuffle(list).slice(0, n);
}

/** Naive: random 1–2 items each side, value-blind (ignores dialogue + outcomes). */
function proposeNaive(playerInv, aiInv) {
  const playerOffer = pickRandomSubset(playerInv, 2);
  const aiOffer = pickRandomSubset(aiInv, 2);
  return { playerOffer, aiOffer };
}

/**
 * Belief-weighted perceived ratio for the attentive proposer.
 */
function beliefRatio(belief, playerOffer, aiOffer) {
  const p = (playerOffer || []).reduce((s, it) => s + (it.cost || 0) * belief.get(it), 0);
  const a = (aiOffer || []).reduce((s, it) => s + (it.cost || 0) * belief.get(it), 0);
  if (p === 0 && a === 0) return 1;
  if (a === 0) return Infinity;
  return p / a;
}

/**
 * Attentive: maximize raw diamond gain while keeping believed perceived ratio
 * high enough to clear accept. Re-targets after each rotation (belief decay).
 */
function proposeAttentive(playerInv, aiInv, belief, personality) {
  const acceptAt = acceptThreshold(personality);
  const targetRatio = Math.max(0.75, acceptAt - 0.08);
  let best = null;

  const pCands = shuffle(playerInv).slice(0, Math.min(6, playerInv.length));
  const aCands = shuffle(aiInv).slice(0, Math.min(6, aiInv.length));

  function consider(playerOffer, aiOffer) {
    if (!playerOffer.length || !aiOffer.length) return;
    const rawP = inventoryValue(playerOffer);
    const rawA = inventoryValue(aiOffer);
    const rawDelta = rawA - rawP;
    const ratio = beliefRatio(belief, playerOffer, aiOffer);
    if (!Number.isFinite(ratio) || ratio < targetRatio) return;
    if (
      !best ||
      rawDelta > best.rawDelta ||
      (rawDelta === best.rawDelta && ratio > best.ratio)
    ) {
      best = { playerOffer, aiOffer, rawDelta, ratio };
    }
  }

  for (const p of pCands) {
    for (const a of aCands) {
      consider([p], [a]);
    }
  }
  for (let i = 0; i < pCands.length; i++) {
    for (let j = i + 1; j < pCands.length; j++) {
      for (const a of aCands) {
        consider([pCands[i], pCands[j]], [a]);
      }
    }
  }
  for (const p of pCands) {
    for (let i = 0; i < aCands.length; i++) {
      for (let j = i + 1; j < aCands.length; j++) {
        consider([p], [aCands[i], aCands[j]]);
      }
    }
  }

  if (best) return { playerOffer: best.playerOffer, aiOffer: best.aiOffer };

  // Fallback: give most-loved (by belief), take most-undervalued
  const playerSorted = playerInv
    .slice()
    .sort((a, b) => belief.get(b) - belief.get(a));
  const aiSorted = aiInv.slice().sort((a, b) => belief.get(a) - belief.get(b));
  if (!playerSorted.length || !aiSorted.length) {
    return proposeNaive(playerInv, aiInv);
  }
  return {
    playerOffer: playerSorted.slice(0, 1),
    aiOffer: aiSorted.slice(0, 1),
  };
}

/**
 * Oracle attentive (upper bound): knows true current desire map (after corroborating).
 * Used as secondary check that skill ceiling still exists under rotation/anti-farm.
 */
function proposeOracle(playerInv, aiInv, desire, caughtOnIds, caughtRounds, personality) {
  const acceptAt = acceptThreshold(personality);
  const targetRatio = Math.max(0.75, acceptAt - 0.08);
  let best = null;
  const pCands = shuffle(playerInv).slice(0, Math.min(6, playerInv.length));
  const aCands = shuffle(aiInv).slice(0, Math.min(6, aiInv.length));

  function consider(playerOffer, aiOffer) {
    if (!playerOffer.length || !aiOffer.length) return;
    const rawDelta = inventoryValue(aiOffer) - inventoryValue(playerOffer);
    const { ratio } = calculatePerceivedFairness(
      desire,
      caughtOnIds,
      caughtRounds,
      playerOffer,
      aiOffer
    );
    if (!Number.isFinite(ratio) || ratio < targetRatio) return;
    if (!best || rawDelta > best.rawDelta || (rawDelta === best.rawDelta && ratio > best.ratio)) {
      best = { playerOffer, aiOffer, rawDelta, ratio };
    }
  }

  for (const p of pCands) {
    for (const a of aCands) consider([p], [a]);
  }
  for (let i = 0; i < pCands.length; i++) {
    for (let j = i + 1; j < pCands.length; j++) {
      for (const a of aCands) consider([pCands[i], pCands[j]], [a]);
    }
  }
  for (const p of pCands) {
    for (let i = 0; i < aCands.length; i++) {
      for (let j = i + 1; j < aCands.length; j++) {
        consider([p], [aCands[i], aCands[j]]);
      }
    }
  }

  if (best) return { playerOffer: best.playerOffer, aiOffer: best.aiOffer };
  const playerSorted = playerInv
    .slice()
    .sort(
      (a, b) =>
        getEffectiveMult(desire, caughtOnIds, caughtRounds, b) -
        getEffectiveMult(desire, caughtOnIds, caughtRounds, a)
    );
  const aiSorted = aiInv
    .slice()
    .sort(
      (a, b) =>
        getEffectiveMult(desire, caughtOnIds, caughtRounds, a) -
        getEffectiveMult(desire, caughtOnIds, caughtRounds, b)
    );
  if (!playerSorted.length || !aiSorted.length) return proposeNaive(playerInv, aiInv);
  return { playerOffer: playerSorted.slice(0, 1), aiOffer: aiSorted.slice(0, 1) };
}

function removeByInstance(list, offered) {
  const ids = new Set(offered.map((i) => i.instanceId));
  return list.filter((i) => !ids.has(i.instanceId));
}

function farmPairingKey(playerOffer, aiOffer) {
  const give = [...new Set((playerOffer || []).map((i) => i.id).filter(Boolean))].sort().join(",");
  const take = [...new Set((aiOffer || []).map((i) => i.id).filter(Boolean))].sort().join(",");
  return `${give}>${take}`;
}

function pairingIds(playerOffer, aiOffer) {
  const ids = new Set();
  for (const it of playerOffer || []) if (it && it.id) ids.add(it.id);
  for (const it of aiOffer || []) if (it && it.id) ids.add(it.id);
  return ids;
}

function negotiateUntilResolve(desire, caughtOnIds, caughtRounds, personality, playerOffer, aiOffer) {
  let counters = 0;
  let pOffer = playerOffer.slice();
  let aOffer = aiOffer.slice();

  for (let step = 0; step < 8; step++) {
    const forceResolve = counters >= AI_COUNTER_CAP;
    const decision = aiEvaluateTrade(
      desire,
      caughtOnIds,
      caughtRounds,
      personality,
      pOffer,
      aOffer,
      forceResolve
    );
    if (decision === "accept") return { ok: true, playerOffer: pOffer, aiOffer: aOffer };
    if (decision === "decline") return { ok: false, playerOffer: pOffer, aiOffer: aOffer };

    counters += 1;
    if (aOffer.length > 1) {
      aOffer = aOffer
        .slice()
        .sort(
          (a, b) =>
            getEffectiveMult(desire, caughtOnIds, caughtRounds, b) * b.cost -
            getEffectiveMult(desire, caughtOnIds, caughtRounds, a) * a.cost
        );
      aOffer.pop();
    } else {
      return { ok: false, playerOffer: pOffer, aiOffer: aOffer };
    }
  }
  return { ok: false, playerOffer: pOffer, aiOffer: aOffer };
}

function runSession(mode) {
  let playerInv = generateStartingInventory();
  let aiInv = generateAIInventory();
  let desire = rollAiDesires(aiInv);
  const personality = rollPersonality();
  const startValue = inventoryValue(playerInv);
  const belief = createBeliefTracker();

  let tradesSinceRotation = 0;
  let secSinceRotation = 0;
  let rotateAfterTrades = rollRotateAfterTrades();
  let rotateAfterSec = rollRotateAfterSec();
  let sessionSec = 0;
  let farmStreak = 0;
  let lastFarmPairing = null;
  let caughtOnIds = new Set();
  let caughtOnRoundsLeft = 0;

  let accepted = 0;
  let rotations = 0;
  let farmTriggers = 0;

  function rotate() {
    desire = rollAiDesires(aiInv);
    tradesSinceRotation = 0;
    secSinceRotation = 0;
    rotateAfterTrades = rollRotateAfterTrades();
    rotateAfterSec = rollRotateAfterSec();
    farmStreak = 0;
    lastFarmPairing = null;
    caughtOnIds = new Set();
    caughtOnRoundsLeft = 0;
    rotations += 1;
    if (mode === "attentive") belief.decayOnRotation();
  }

  function maybeRotate() {
    if (tradesSinceRotation >= rotateAfterTrades || secSinceRotation >= rotateAfterSec) {
      rotate();
    }
  }

  for (let t = 0; t < MAX_TRADE_ATTEMPTS; t++) {
    if (sessionSec >= SESSION_SEC) break;
    if (playerInv.length < 1 || aiInv.length < 1) break;

    sessionSec += SEC_PER_TRADE_ATTEMPT;
    secSinceRotation += SEC_PER_TRADE_ATTEMPT;
    maybeRotate();

    // Opening cue noise (attentive hears; naive ignores)
    if (mode === "attentive" && aiInv.length) {
      const sample = shuffle(aiInv).slice(0, Math.min(2, aiInv.length));
      for (const it of sample) belief.hearCue(it, desire);
    }

    let proposal;
    if (mode === "naive") {
      proposal = proposeNaive(playerInv, aiInv);
    } else if (mode === "oracle") {
      proposal = proposeOracle(
        playerInv,
        aiInv,
        desire,
        caughtOnIds,
        caughtOnRoundsLeft,
        personality
      );
    } else {
      proposal = proposeAttentive(playerInv, aiInv, belief, personality);
    }
    if (!proposal.playerOffer.length || !proposal.aiOffer.length) break;

    const result = negotiateUntilResolve(
      desire,
      caughtOnIds,
      caughtOnRoundsLeft,
      personality,
      proposal.playerOffer,
      proposal.aiOffer
    );

    // One negotiation round for caught-on decay
    if (caughtOnRoundsLeft > 0) {
      caughtOnRoundsLeft -= 1;
      if (caughtOnRoundsLeft <= 0) caughtOnIds = new Set();
    }

    if (!result.ok) continue;

    const rawDelta = inventoryValue(result.aiOffer) - inventoryValue(result.playerOffer);
    playerInv = removeByInstance(playerInv, result.playerOffer).concat(result.aiOffer);
    aiInv = removeByInstance(aiInv, result.aiOffer).concat(result.playerOffer);
    accepted += 1;
    tradesSinceRotation += 1;

    if (mode === "attentive") {
      belief.learnFromAccept(result.playerOffer, result.aiOffer);
    }

    // Anti-farm on profitable same pairing
    if (rawDelta > 0) {
      const key = farmPairingKey(result.playerOffer, result.aiOffer);
      if (key && key === lastFarmPairing) farmStreak += 1;
      else {
        lastFarmPairing = key;
        farmStreak = 1;
      }
      if (farmStreak > DESIRE_FARM_STREAK_LIMIT) {
        caughtOnIds = pairingIds(result.playerOffer, result.aiOffer);
        caughtOnRoundsLeft =
          DESIRE_CAUGHT_ROUNDS_MIN +
          Math.floor(
            Math.random() * (DESIRE_CAUGHT_ROUNDS_MAX - DESIRE_CAUGHT_ROUNDS_MIN + 1)
          );
        farmStreak = 0;
        lastFarmPairing = null;
        farmTriggers += 1;
      }
    } else {
      farmStreak = 0;
      lastFarmPairing = null;
    }

    maybeRotate();
  }

  const endValue = inventoryValue(playerInv);
  return {
    startValue,
    endValue,
    delta: endValue - startValue,
    accepted,
    rotations,
    farmTriggers,
  };
}

function avg(nums) {
  return nums.reduce((a, b) => a + b, 0) / (nums.length || 1);
}

function runBatch(mode) {
  const results = [];
  for (let i = 0; i < SESSIONS; i++) results.push(runSession(mode));
  return {
    mode,
    sessions: SESSIONS,
    avgStart: avg(results.map((r) => r.startValue)),
    avgEnd: avg(results.map((r) => r.endValue)),
    avgDelta: avg(results.map((r) => r.delta)),
    avgAccepted: avg(results.map((r) => r.accepted)),
    avgRotations: avg(results.map((r) => r.rotations)),
    avgFarmTriggers: avg(results.map((r) => r.farmTriggers)),
    results,
  };
}

const naive = runBatch("naive");
const attentive = runBatch("attentive");
const oracle = runBatch("oracle");

console.log("--- Fidget Trading AI skill simulation (rotating prefs + noise + anti-farm) ---");
console.log(
  `Naive     (${naive.sessions} sessions): avg Δ=${naive.avgDelta.toFixed(2)}  avg accepts=${naive.avgAccepted.toFixed(2)}  rotations=${naive.avgRotations.toFixed(2)}  farmTriggers=${naive.avgFarmTriggers.toFixed(2)}`
);
console.log(
  `Attentive (${attentive.sessions} sessions): avg Δ=${attentive.avgDelta.toFixed(2)}  avg accepts=${attentive.avgAccepted.toFixed(2)}  rotations=${attentive.avgRotations.toFixed(2)}  farmTriggers=${attentive.avgFarmTriggers.toFixed(2)}`
);
console.log(
  `Oracle    (${oracle.sessions} sessions): avg Δ=${oracle.avgDelta.toFixed(2)}  avg accepts=${oracle.avgAccepted.toFixed(2)}  rotations=${oracle.avgRotations.toFixed(2)}  farmTriggers=${oracle.avgFarmTriggers.toFixed(2)}`
);
console.log(
  `Advantage (attentive − naive avg Δ): ${(attentive.avgDelta - naive.avgDelta).toFixed(2)} diamonds`
);
console.log(
  `Ceiling   (oracle − naive avg Δ): ${(oracle.avgDelta - naive.avgDelta).toFixed(2)} diamonds`
);

const attentiveBeats = attentive.avgDelta > naive.avgDelta;
const oracleBeats = oracle.avgDelta > naive.avgDelta;
if (!attentiveBeats || !oracleBeats) {
  console.error("FAIL: attentive/oracle did not beat naive on average delta.");
  process.exitCode = 1;
} else {
  console.log("PASS: attentive strategy yields higher average diamond gain than naive.");
}
