/**
 * Crownward — side-scrolling walk/climb/jump path to the Grand Castle.
 * State machine: MENU → CHARACTER_SELECT → PLAYING → (PAUSED | FAILED) → WIN | TIMEOUT
 *
 * Analytics buffer: localStorage key arcade-games-crownward-analytics
 * Unlock (golden trim): arcade-games-crownward-unlock
 *
 * Visual system notes:
 *  - Backgrounds are drawn procedurally in 3+ parallax layers (far/mid/decor/near)
 *    per zone, using tiled sine/hash-based shapes rather than baked images —
 *    keeps the world scrollable to infinity with no seams and stays cheap.
 *  - Zones: Enchanted Forest → Village → Castle → Grand Castle, each with its
 *    own cool/warm palette but sharing one recurring "warm glow" accent
 *    (mushroom glow → lantern glow → torch glow → sunset glow).
 *  - Morning / Night theme swaps zone palettes + sky creatures (birds vs bats/
 *    fireflies) without changing gameplay difficulty.
 *  - Obstacles are styled by *material* (fence/hedge/rock/crate/stone/vine/
 *    wood/ladder) so jump-over vs climbable reads at a glance, with a dark
 *    rim outline + light-side highlight to separate them from the backdrop.
 *  - Jump feel: inset hitbox, coyote time, and jump buffer (Chrome Dino–inspired).
 */
(function () {
  "use strict";

  /* ======================================================================== */
  /* Constants                                                                */
  /* ======================================================================== */

  const RUN_SECONDS = 30 * 60; // 30:00 countdown
  const WORLD_LENGTH = 52000;
  const GROUND_Y = 400;
  const GRAVITY = 1800;
  const BASE_WALK = 165;
  const SPRINT_BONUS = 1.35;
  // Apex ≈ JUMP_V² / (2·GRAVITY) ≈ 75px (wanderer ≈ 64px). Forest blocks stay
  // well under that so early jumps clear with margin; later zones climb taller.
  const JUMP_V = -520;
  const CLIMB_SPEED = 140;
  const COYOTE_TIME = 0.09; // grace after leaving ground (Chrome Dino–style)
  const JUMP_BUFFER = 0.12; // accept jump pressed slightly before landing
  const DEATH_PENALTY = 10; // seconds removed from remaining time, applied on respawn
  const ANALYTICS_KEY = "arcade-games-crownward-analytics";
  const UNLOCK_KEY = "arcade-games-crownward-unlock";
  const ATTEMPT_KEY = "arcade-games-crownward-attempt";

  const CHARACTERS = {
    knight: {
      id: "knight",
      name: "Knight",
      walkMul: 1.0,
      jumpMul: 1.0,
      // Slightly desaturated storybook palette so the sprite reads clearly
      // against the busier, more saturated parallax world behind it.
      colors: { body: "#8E7FAE", cloak: "#5C5079", accent: "#2E2748", trim: "#E9E2D3", skin: "#E3B790" },
    },
    wanderer: {
      id: "wanderer",
      name: "Wanderer",
      walkMul: 1.08,
      jumpMul: 0.92,
      colors: { body: "#5FA6A3", cloak: "#3E7674", accent: "#2E2748", trim: "#D99B9E", skin: "#DDAE87" },
    },
    fox: {
      id: "fox",
      name: "Fox Cub",
      walkMul: 1.1,
      jumpMul: 1.08,
      colors: { body: "#D99A9E", cloak: "#B96F76", accent: "#2E2748", trim: "#F1E4C6", skin: "#E3B790" },
    },
  };

  // 4 zones — Enchanted Forest is now the starting zone; Outer + Mid Castle
  // are merged into one "Castle" visual identity (shared stone/torch/ivy look)
  // per the palette spec, while gameplay density still ramps within it.
  const ZONE_DEFS = [
    { id: "forest", name: "Enchanted Forest", start: 0, end: 0.25 },
    { id: "village", name: "Village", start: 0.25, end: 0.5 },
    { id: "castle", name: "Castle", start: 0.5, end: 0.8 },
    { id: "grand_castle", name: "Grand Castle", start: 0.8, end: 1 },
  ];

  // Exact zone palette colors from the visual brief. Derived sky/mid tones are
  // slight darkenings of the named swatches so layered silhouettes read clearly.
  // Warm-glow motif per zone: mushroom → lantern → torch → sunset.
  // Morning = warm daytime; Night = moonlit variants that keep each zone readable.
  const ZONE_PALETTES_MORNING = {
    forest: {
      // #1B3A24, #6B9E6F, #D9F2C4, #F4C95D, #D9A3E0
      skyTop: "#0f2117",
      skyBottom: "#1B3A24",
      far: "#1B3A24",
      mid: "#25502f",
      near: "#6B9E6F",
      glow: "#F4C95D",
      glow2: "#D9A3E0",
      fog: "#D9F2C4",
    },
    village: {
      // #4A2F3A, #8A4A3A, #F0C04D, #C98A5E, #F1E0C0
      skyTop: "#241820",
      skyBottom: "#4A2F3A",
      far: "#4A2F3A",
      mid: "#6b3f37",
      near: "#8A4A3A",
      glow: "#F0C04D",
      wood: "#C98A5E",
      wall: "#F1E0C0",
    },
    castle: {
      // #3C3C46, #8F8F99, #E8813D, #5C7A52, #C9C9D2
      skyTop: "#22222b",
      skyBottom: "#3C3C46",
      far: "#3C3C46",
      mid: "#55555f",
      near: "#8F8F99",
      glow: "#E8813D",
      ivy: "#5C7A52",
      banner: "#C9C9D2",
    },
    grand_castle: {
      // #2A1A3D, #F4A259, #C96A3E, #1A1430, #F9DFAE
      skyTop: "#1A1430",
      skyBottom: "#2A1A3D",
      far: "#2A1A3D",
      mid: "#3a2650",
      near: "#C96A3E",
      glow: "#F4A259",
      mid2: "#C96A3E",
      silhouette: "#1A1430",
      halo: "#F9DFAE",
    },
  };

  const ZONE_PALETTES_NIGHT = {
    forest: {
      skyTop: "#0a1220",
      skyBottom: "#122418",
      far: "#0e1c18",
      mid: "#1a3328",
      near: "#3d6a4a",
      glow: "#E8D48A",
      glow2: "#B88AD4",
      fog: "#8AAD9A",
    },
    village: {
      skyTop: "#0c1018",
      skyBottom: "#1e1828",
      far: "#2a1e2a",
      mid: "#3d2a32",
      near: "#5a3a38",
      glow: "#F5C45A",
      wood: "#8A6A4E",
      wall: "#C9B89A",
    },
    castle: {
      skyTop: "#0a0c14",
      skyBottom: "#1a1a28",
      far: "#222230",
      mid: "#383848",
      near: "#5a5a6e",
      glow: "#F0A050",
      ivy: "#3d5a42",
      banner: "#8A8A9A",
    },
    grand_castle: {
      skyTop: "#080610",
      skyBottom: "#160e24",
      far: "#1a1028",
      mid: "#2a1a40",
      near: "#8A4A32",
      glow: "#F4B86A",
      mid2: "#A85838",
      silhouette: "#0c0818",
      halo: "#E8D4A8",
    },
  };

  /** Active zone palette for the run theme (morning | night). */
  function zonePalette(zoneId) {
    const tables = selectedTheme === "night" ? ZONE_PALETTES_NIGHT : ZONE_PALETTES_MORNING;
    return tables[zoneId] || tables.forest;
  }

  // Scroll factors relative to cameraX (far slowest → near fastest).
  // decor sits between mid and near — non-colliding village props, etc.
  const PARALLAX = { far: 0.22, mid: 0.5, decor: 0.64, near: 0.78 };

  /* ======================================================================== */
  /* DOM                                                                      */
  /* ======================================================================== */

  const screens = {
    menu: document.getElementById("screen-menu"),
    select: document.getElementById("screen-select"),
    play: document.getElementById("screen-play"),
  };
  const canvas = document.getElementById("game-canvas");
  const ctx = canvas.getContext("2d");
  const tooltipEl = document.getElementById("tooltip");
  const controlsHint = document.getElementById("controls-hint");
  const minimapDot = document.getElementById("minimap-dot");
  const zoneLabel = document.getElementById("zone-label");
  const hudTimer = document.getElementById("hud-timer");
  const hudRetries = document.getElementById("hud-retries");
  const failOverlay = document.getElementById("fail-overlay");
  const failMsg = document.getElementById("fail-msg");
  const pauseOverlay = document.getElementById("pause-overlay");
  const winOverlay = document.getElementById("win-overlay");
  const timeoutOverlay = document.getElementById("timeout-overlay");
  const winStats = document.getElementById("win-stats");
  const winMsg = document.getElementById("win-msg");
  const confettiEl = document.getElementById("confetti");
  const btnPlay = document.getElementById("btn-play");

  /* ======================================================================== */
  /* State                                                                    */
  /* ======================================================================== */

  /** @type {'MENU'|'CHARACTER_SELECT'|'PLAYING'|'PAUSED'|'FAILED'|'WIN'|'TIMEOUT'} */
  let state = "MENU";
  let selectedChar = null;
  /** @type {'morning'|'night'} */
  let selectedTheme = "morning";
  let hasGoldenTrim = localStorage.getItem(UNLOCK_KEY) === "1";
  let attemptNumber = Number(localStorage.getItem(ATTEMPT_KEY) || 0);

  const keys = { left: false, right: false, up: false, down: false, space: false };

  let world = null;
  let player = null;
  let cameraX = 0;
  let timeLeft = RUN_SECONDS;
  let elapsedRun = 0;
  let retries = 0;
  let lastTs = 0;
  let rafId = 0;
  let speedMultiplier = 1;
  let pendingCause = null; // cause of most recent death, used by fail modal copy

  let hints = {
    controlsFaded: false,
    jumpShown: false,
    climbShown: false,
    firstJumpSuccess: false,
  };
  let tooltipTimer = 0;

  let winPhase = 0; // 0 play, 1 walk-in, 2 royalty, 3 stats
  let winTimer = 0;
  let confettiSpawned = false;

  /* ======================================================================== */
  /* Analytics                                                                */
  /* ======================================================================== */

  function zoneAt(x) {
    const p = Math.max(0, Math.min(1, x / WORLD_LENGTH));
    for (let i = ZONE_DEFS.length - 1; i >= 0; i--) {
      if (p >= ZONE_DEFS[i].start) return { ...ZONE_DEFS[i], index: i };
    }
    return { ...ZONE_DEFS[0], index: 0 };
  }

  function logEvent(event, extra = {}) {
    const payload = {
      event,
      timestamp: Math.floor(elapsedRun),
      zone: zoneAt(player ? player.x : 0).id,
      positionX: player ? Math.round(player.x) : 0,
      causeOfDeath: null,
      character: selectedChar || null,
      theme: selectedTheme,
      attemptNumber,
      ...extra,
    };
    try {
      const buf = JSON.parse(localStorage.getItem(ANALYTICS_KEY) || "[]");
      buf.push(payload);
      localStorage.setItem(ANALYTICS_KEY, JSON.stringify(buf.slice(-200)));
    } catch (_) {
      /* ignore quota errors */
    }
    // Hook for a future backend:
    // if (window.CROWNWARD_ANALYTICS_ENDPOINT) fetch(...)
  }

  /* ======================================================================== */
  /* Deterministic pseudo-random helpers (world gen + tiled parallax/particles) */
  /* ======================================================================== */

  function seededRand(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function hash01(i) {
    let s = (i * 2654435761) >>> 0;
    s = (s ^ (s >>> 13)) >>> 0;
    s = (s * 2246822519) >>> 0;
    return (s >>> 0) / 4294967296;
  }

  /* ======================================================================== */
  /* World generation                                                         */
  /* ======================================================================== */

  // Materials by zone index — jump-overs stay bright/low; climbables stay
  // rung/line textured. Forest→Village→Castle→Grand.
  const BLOCK_MATERIAL = ["rock", "fence", "crate", "stone"];
  const LOW_MATERIAL = ["hedge", "fence", "crate", "stone"];
  const CLIMB_MATERIAL = ["vine", "wood", "stone", "stone"]; // wood = ladder

  function buildWorld() {
    const rand = seededRand(20260422);
    const platforms = [];
    const climbables = [];
    const hazards = [];
    const pits = [];
    const scenery = [];
    const checkpoints = [];
    const collectibles = [];
    const moving = [];

    let x = 0;
    platforms.push({ x: -200, y: GROUND_Y, w: 900, h: 80, type: "ground" });

    function addGround(from, to) {
      platforms.push({ x: from, y: GROUND_Y, w: to - from, h: 80, type: "ground" });
    }

    ZONE_DEFS.forEach((zone, zi) => {
      const z0 = zone.start * WORLD_LENGTH;
      const z1 = zone.end * WORLD_LENGTH;
      const mid = (z0 + z1) / 2;

      checkpoints.push({ x: z0 + 80, y: GROUND_Y, zone: zone.id, id: `${zone.id}-start` });
      checkpoints.push({ x: mid, y: GROUND_Y, zone: zone.id, id: `${zone.id}-mid` });

      // Zone-flavored scenery: trees (forest) → town buildings (village) → castle walls
      // Village mixes cottages with market stalls, forges, and two-story townhouses.
      let sceneryTypes;
      if (zi === 0) sceneryTypes = ["tree"];
      else if (zi === 1) sceneryTypes = ["cottage", "market_stall", "forge", "townhouse", "cottage"];
      else sceneryTypes = ["castle"];
      const sceneryCount = zi === 0 ? 16 : zi === 1 ? 12 : zi === 2 ? 5 : 3;
      for (let i = 0; i < sceneryCount; i++) {
        const sx = z0 + 200 + rand() * (z1 - z0 - 400);
        const scale =
          zi === 0
            ? 0.8 + rand() * 0.6
            : zi === 1
            ? 0.85 + rand() * 0.35
            : zi === 3
            ? 1.7 + rand() * 0.5
            : 1 + rand() * 0.3;
        const sceneryType = sceneryTypes[Math.floor(rand() * sceneryTypes.length)];
        scenery.push({ type: sceneryType, x: sx, scale, tier: zi, seed: Math.floor(rand() * 1e6) });
      }

      // Warm-glow accent posts (mushrooms / lanterns / torches / sunset motes)
      const glowCount = zi === 3 ? 2 : 5;
      for (let i = 0; i < glowCount; i++) {
        scenery.push({
          type: "glow",
          x: z0 + 150 + rand() * (z1 - z0 - 300),
          scale: 0.7 + rand() * 0.6,
          tier: zi,
          seed: Math.floor(rand() * 1e6),
        });
      }

      let cursor = z0 + 500;
      while (cursor < z1 - 600) {
        const roll = rand();
        // Soft Enchanted Forest: sparse + small obstacles; density ramps from Village
        const density = zi === 0 ? 0.38 : 0.55 + (zi - 1) * 0.14;
        const gapMul = zi === 0 ? 0.55 : 1;
        const spaceMul = zi === 0 ? 1.45 : 1;

        if (roll < 0.18 * density) {
          // Pit — forest gaps stay easily jumpable; later zones widen
          const gap = (zi === 0 ? 48 : 70) + zi * 22 * gapMul + rand() * ((zi === 0 ? 22 : 40) + zi * 18);
          const run = (180 + rand() * 220) * spaceMul;
          const landW = 160 + rand() * 100;
          addGround(x, cursor);
          pits.push({ x: cursor, w: gap });
          const landY = GROUND_Y - (zi >= 2 && rand() < 0.35 ? 36 : 0);
          platforms.push({ x: cursor + gap, y: landY, w: landW, h: 22, type: "platform" });
          x = cursor + gap + landW;
          cursor = x + run;
        } else if (roll < 0.38 * density) {
          // Low obstacle (duck) — forest: short + narrow, nearly unmissable
          const lowH = zi === 0 ? 28 + rand() * 6 : 38;
          const lowW = zi === 0 ? 48 + rand() * 20 : 70 + rand() * 40;
          hazards.push({
            x: cursor,
            y: GROUND_Y - lowH,
            w: lowW,
            h: lowH,
            type: "low",
            material: LOW_MATERIAL[zi],
            zi,
          });
          cursor += (220 + rand() * 180) * spaceMul;
        } else if (roll < 0.58 * density) {
          // Jump block — forest tallest ≈ 40px (clearance margin under ~64–75px jump)
          const blockH = zi === 0 ? 34 + rand() * 6 : 48 + zi * 8;
          hazards.push({
            x: cursor,
            y: GROUND_Y - blockH,
            w: zi === 0 ? 28 + rand() * 12 : 36 + rand() * 20,
            h: blockH,
            type: "block",
            material: BLOCK_MATERIAL[zi],
            zi,
          });
          cursor += (200 + rand() * 160) * spaceMul;
        } else if (roll < 0.78 * density) {
          // Climbable — vine / wood / stone, always rung/line-textured
          const h = (zi === 0 ? 70 : 90) + zi * 40 + rand() * 50;
          climbables.push({
            x: cursor,
            y: GROUND_Y - h,
            w: 28,
            h,
            type: "ladder",
            material: CLIMB_MATERIAL[zi],
            zi,
          });
          platforms.push({ x: cursor - 20, y: GROUND_Y - h, w: 100 + rand() * 60, h: 18, type: "platform" });
          cursor += (280 + rand() * 200) * spaceMul;
        } else if (zi >= 2 && roll < 0.9) {
          // Moving platform (castle / grand)
          const mx = cursor;
          const my = GROUND_Y - 80 - rand() * 60;
          moving.push({
            x: mx,
            y: my,
            w: 90,
            h: 16,
            ox: mx,
            range: 80 + rand() * 60,
            speed: 40 + rand() * 30,
            phase: rand() * Math.PI * 2,
            type: "moving",
          });
          cursor += 300 + rand() * 150;
        } else {
          cursor += (160 + rand() * 120) * spaceMul;
        }

        if (rand() < 0.12) {
          collectibles.push({
            x: cursor - 80,
            y: GROUND_Y - 90 - rand() * 50,
            r: 10,
            taken: false,
            id: `coin-${Math.floor(cursor)}`,
          });
        }
      }
    });

    addGround(x, WORLD_LENGTH + 400);

    const gateX = WORLD_LENGTH - 180;
    scenery.push({ type: "grand_gate", x: gateX, scale: 1 });
    platforms.push({ x: WORLD_LENGTH - 400, y: GROUND_Y, w: 800, h: 80, type: "ground" });

    const firstBlock = hazards.find((h) => h.type === "block");
    if (firstBlock) firstBlock.tutorialJump = true;
    const firstClimb = climbables[0];
    if (firstClimb) firstClimb.tutorialClimb = true;

    return {
      platforms,
      climbables,
      hazards,
      pits,
      scenery,
      checkpoints,
      collectibles,
      moving,
      gateX,
      lastCheckpoint: { x: 80, y: GROUND_Y - 40 },
    };
  }

  /* ======================================================================== */
  /* Player                                                                   */
  /* ======================================================================== */

  function makePlayer(charId) {
    const c = CHARACTERS[charId];
    return {
      charId,
      x: 120,
      y: GROUND_Y - 48,
      w: 28,
      h: 48,
      vx: 0,
      vy: 0,
      onGround: false,
      climbing: false,
      crouching: false,
      facing: 1,
      hasCrown: false,
      walkMul: c.walkMul,
      jumpMul: c.jumpMul,
      colors: { ...c.colors },
      invuln: 0,
      animPhase: 0, // drives walk-cycle limb swing
      stumble: 0, // >0 while playing the fail/stumble pose
      coyote: 0, // remaining grace time after leaving ground
      jumpBuffer: 0, // remaining time to honor a pre-land jump press
      jumpHeld: false,
      wasOnGround: true,
    };
  }

  function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  /** Effective collider — inset vs drawn sprite (Chrome Dino–style forgiveness). */
  function playerBox(p) {
    const insetX = 5;
    const insetTop = 8;
    const hFull = p.crouching ? p.h * 0.55 : p.h;
    const yBase = p.crouching ? p.y + p.h - hFull : p.y;
    return {
      x: p.x + insetX,
      y: yBase + insetTop,
      w: Math.max(10, p.w - insetX * 2),
      h: Math.max(12, hFull - insetTop),
    };
  }

  /* ======================================================================== */
  /* Physics update                                                           */
  /* ======================================================================== */

  function speedMulFromTime() {
    return Math.min(2.0, 1.0 + Math.floor(elapsedRun / 120) * 0.05);
  }

  function updatePlayer(dt) {
    const p = player;
    speedMultiplier = speedMulFromTime();
    p.invuln = Math.max(0, p.invuln - dt);

    world.moving.forEach((m) => {
      m._prevX = m.x;
      m.x = m.ox + Math.sin(elapsedRun * (m.speed / 40) + m.phase) * m.range;
    });

    const wantJump = keys.up || keys.space;
    p.crouching = keys.down && p.onGround && !p.climbing;
    const boxH = p.crouching ? p.h * 0.55 : p.h;

    // Jump buffer: remember a fresh press briefly (edge-triggered, not hold)
    if (wantJump && !p.jumpHeld) p.jumpBuffer = JUMP_BUFFER;
    p.jumpHeld = wantJump;
    p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);

    const nearClimb = world.climbables.find((c) => {
      const expanded = { x: c.x - 8, y: c.y, w: c.w + 16, h: c.h };
      return aabb(playerBox(p), expanded);
    });

    if (nearClimb && wantJump && !keys.down) {
      p.climbing = true;
      p.vy = 0;
      p.vx = 0;
      p.coyote = 0;
      p.jumpBuffer = 0;
      p.x = nearClimb.x + nearClimb.w / 2 - p.w / 2;
      if (keys.up || keys.space) {
        p.y -= CLIMB_SPEED * dt;
        p.animPhase += dt * 6;
      }
      if (keys.down) p.y += CLIMB_SPEED * dt;
      p.y = Math.max(nearClimb.y - 10, Math.min(nearClimb.y + nearClimb.h - boxH, p.y));
      if (p.y <= nearClimb.y - 8) {
        p.climbing = false;
        p.onGround = true;
        p.y = nearClimb.y - p.h;
      }
    } else {
      p.climbing = false;
    }

    if (!p.climbing) {
      let move = 0;
      if (keys.right) move += 1;
      if (keys.left) move -= 1;
      const sprint = keys.right && !keys.left ? SPRINT_BONUS : 1;
      const auto = keys.left ? 0 : 0.35;
      const dir = move !== 0 ? move : auto;
      if (move !== 0) p.facing = move > 0 ? 1 : -1;

      const speed =
        BASE_WALK * p.walkMul * speedMultiplier * (move !== 0 ? sprint : 1) * (p.crouching ? 0.55 : 1);
      p.vx = dir * speed;
      p.animPhase += dt * (2 + Math.abs(p.vx) / 60);

      const canJump = (p.onGround || p.coyote > 0) && !p.crouching;
      if (canJump && p.jumpBuffer > 0) {
        p.vy = JUMP_V * p.jumpMul;
        p.onGround = false;
        p.coyote = 0;
        p.jumpBuffer = 0;
        if (!hints.firstJumpSuccess) {
          hints.firstJumpSuccess = true;
          hideTooltip();
          fadeControlsHint();
        }
      }

      p.vy += GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    if (p.x < 40) p.x = 40;

    p.wasOnGround = p.onGround;
    p.onGround = false;
    const solids = world.platforms.concat(
      world.moving.map((m) => ({
        x: m.x,
        y: m.y,
        w: m.w,
        h: m.h,
        type: "moving",
        ref: m,
        prevX: m._prevX ?? m.x,
      }))
    );

    const pb = playerBox(p);
    solids.forEach((plat) => {
      if (!aabb(pb, plat)) return;
      const prevBottom = p.y + p.h - p.vy * dt;
      if (p.vy >= 0 && prevBottom <= plat.y + 8) {
        p.y = plat.y - p.h;
        p.vy = 0;
        p.onGround = true;
        if (plat.type === "moving" && plat.ref) {
          p.x += plat.x - plat.prevX;
        }
      } else if (p.vy < 0 && p.y < plat.y + plat.h && p.y + p.h > plat.y + plat.h) {
        p.y = plat.y + plat.h;
        p.vy = 0;
      }
    });

    // Coyote time: brief grace after walking off a ledge
    if (p.onGround) {
      p.coyote = COYOTE_TIME;
    } else if (p.wasOnGround && !p.climbing) {
      p.coyote = COYOTE_TIME;
    } else {
      p.coyote = Math.max(0, p.coyote - dt);
    }

    if (p.invuln <= 0) {
      for (const h of world.hazards) {
        const hitBox = playerBox(p);
        if (h.type === "low" && p.crouching) continue;
        if (aabb(hitBox, h)) {
          die("obstacle_collision");
          return;
        }
      }
    }

    for (const pit of world.pits) {
      const hit = playerBox(p);
      if (hit.x + hit.w > pit.x + 8 && hit.x < pit.x + pit.w - 8 && p.y + p.h > GROUND_Y + 10) {
        die("pit");
        return;
      }
    }
    if (p.y > GROUND_Y + 120) {
      die("pit");
      return;
    }

    world.checkpoints.forEach((cp) => {
      if (!cp.reached && Math.abs(p.x - cp.x) < 40 && Math.abs(p.y - (GROUND_Y - 40)) < 80) {
        cp.reached = true;
        world.lastCheckpoint = { x: cp.x, y: GROUND_Y - p.h };
        logEvent("checkpoint_reached", { checkpointId: cp.id });
      }
    });

    world.collectibles.forEach((c) => {
      if (c.taken) return;
      const dx = p.x + p.w / 2 - c.x;
      const dy = p.y + p.h / 2 - c.y;
      if (dx * dx + dy * dy < (c.r + 16) * (c.r + 16)) {
        c.taken = true;
        logEvent("collectible_interacted", { collectibleId: c.id });
      }
    });

    if (!hints.jumpShown) {
      const jb = world.hazards.find((h) => h.tutorialJump);
      if (jb && Math.abs(p.x - jb.x) < 160) {
        showTooltip("Press ↑ to jump!", 3);
        hints.jumpShown = true;
      }
    }
    if (!hints.climbShown) {
      const cl = world.climbables.find((c) => c.tutorialClimb);
      if (cl && Math.abs(p.x - cl.x) < 160) {
        showTooltip("Hold ↑ near the wall to climb!", 3);
        hints.climbShown = true;
      }
    }

    if (!hints.controlsFaded && (elapsedRun >= 60 || hints.firstJumpSuccess)) {
      fadeControlsHint();
    }

    if (p.x >= world.gateX - 20 && state === "PLAYING") {
      beginWin();
    }
  }

  /* ======================================================================== */
  /* Fail state — pauses the loop/timer and shows a modal instead of an       */
  /* instant silent respawn.                                                  */
  /* ======================================================================== */

  const FAIL_MESSAGES = {
    pit: "You tumbled into the gap! The path is unforgiving… try again.",
    obstacle_collision: "You stumbled! The path is unforgiving… try again.",
  };

  function die(cause) {
    if (state !== "PLAYING") return;
    pendingCause = cause;
    player.vx = 0;
    player.vy = 0;
    player.climbing = false;
    player.stumble = 1;
    logEvent("death", { causeOfDeath: cause });
    state = "FAILED";
    failMsg.textContent = FAIL_MESSAGES[cause] || FAIL_MESSAGES.obstacle_collision;
    openOverlay(failOverlay);
  }

  function respawnAtCheckpoint() {
    retries += 1;
    hudRetries.textContent = String(retries);
    timeLeft = Math.max(0, timeLeft - DEATH_PENALTY);
    const cp = world.lastCheckpoint;
    player.x = cp.x;
    player.y = cp.y;
    player.vx = 0;
    player.vy = 0;
    player.climbing = false;
    player.invuln = 1.2;
    player.stumble = 0;
    pendingCause = null;
    closeOverlays();
    state = "PLAYING";
    lastTs = 0;
  }

  /* ======================================================================== */
  /* Tooltips / hints                                                         */
  /* ======================================================================== */

  function showTooltip(text, seconds) {
    tooltipEl.textContent = text;
    tooltipEl.classList.remove("hidden");
    tooltipTimer = seconds;
  }

  function hideTooltip() {
    tooltipEl.classList.add("hidden");
    tooltipTimer = 0;
  }

  function fadeControlsHint() {
    hints.controlsFaded = true;
    controlsHint.classList.add("is-faded");
    controlsHint.setAttribute("aria-hidden", "true");
  }

  /* ======================================================================== */
  /* Low-level draw helpers                                                   */
  /* ======================================================================== */

  function roundRectPath(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawRoundedRect(x, y, w, h, r, fill) {
    roundRectPath(x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  /** Fill + dark rim outline + light-side highlight, used for every obstacle
   *  so it visually separates from the parallax layers behind it. */
  function drawObstacleShape(x, y, w, h, r, fill, hiColor) {
    const rr = Math.min(r, w / 2, h / 2);
    roundRectPath(x, y, w, h, rr);
    ctx.fillStyle = fill;
    ctx.fill();
    // Dark rim outline
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(20, 14, 30, 0.45)";
    ctx.stroke();
    // Light-side highlight (top + left)
    const hi = hiColor || "rgba(255,255,255,0.4)";
    ctx.strokeStyle = hi;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(x + rr, y + 1.2);
    ctx.lineTo(x + w - rr, y + 1.2);
    ctx.moveTo(x + 1.2, y + rr);
    ctx.lineTo(x + 1.2, y + h - rr);
    ctx.stroke();
  }

  /** Dark rim on the current filled path (freeform silhouettes). */
  function rimCurrentPath() {
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(20, 14, 30, 0.45)";
    ctx.stroke();
  }

  /* ======================================================================== */
  /* Character rendering — detailed, animated, desaturated silhouette        */
  /* ======================================================================== */

  /** Rounded rect path on an arbitrary 2D context (shared by gameplay + previews). */
  function fillRoundRectOn(c, x, y, w, h, r, fill) {
    const rr = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
    c.fillStyle = fill;
    c.fill();
  }

  /**
   * Shared character drawer for gameplay canvas and select-screen previews.
   * pose: 'idle' | 'walk' | 'jump' | 'climb' | 'fail'
   * Layered cloak/body blocks, torso highlight, phase-driven limb swing,
   * and per-character silhouette accents (fox ears / knight helm / wanderer hood).
   */
  function drawCharacterOn(c, px, py, charId, opts = {}) {
    const { facing = 1, crouch = false, crown = false, trim = false, pose = "idle", phase = 0 } = opts;
    const ch = CHARACTERS[charId];
    if (!ch) return;
    const colors = ch.colors;

    c.save();
    c.translate(px + 14, py);
    if (facing < 0) c.scale(-1, 1);
    if (pose === "fail") c.rotate(facing >= 0 ? -0.35 : 0.35);

    const bodyH = crouch ? 28 : 40;
    const bodyY = crouch ? 20 : 8;

    // Pose-driven motion offsets
    let bob = 0;
    let legLX = -5;
    let legRX = 5;
    let legLY = 12;
    let legRY = 12;
    let armLX = -11;
    let armRX = 11;
    let armLY = bodyH - 6;
    let armRY = bodyH - 6;
    const walkSwing = pose === "walk" ? Math.sin(phase) : 0;

    if (pose === "idle") {
      bob = Math.sin(phase * 0.6) * 1.4;
    } else if (pose === "walk") {
      const swing = walkSwing * 7;
      legLX = -5 + swing;
      legRX = 5 - swing;
      armLX = -11 - swing * 0.75;
      armRX = 11 + swing * 0.75;
    } else if (pose === "jump") {
      legLX = -2;
      legRX = 2;
      legLY = 3;
      legRY = 3;
      armLX = -15;
      armRX = 15;
      armLY = bodyH * 0.35;
      armRY = bodyH * 0.35;
    } else if (pose === "climb") {
      const reach = Math.sin(phase) * 4;
      armLX = -5;
      armRX = 5;
      armLY = -10 + reach;
      armRY = -12 - reach;
      legLX = -4 + Math.sin(phase) * 3;
      legRX = 4 - Math.sin(phase) * 3;
      legLY = 10;
      legRY = 10;
    } else if (pose === "fail") {
      legLX = -14;
      legRX = 16;
      legLY = 7;
      legRY = 5;
      armLX = -18;
      armRX = 17;
      armLY = 0;
      armRY = 12;
    }

    const by = bodyY + bob;
    const hipY = by + bodyH - 2;
    const shoulderY = by + 7;
    const hemSway = walkSwing * 3.5;
    const capeFlutter = Math.sin(phase * 1.15 + 0.4) * (pose === "walk" ? 5 : pose === "jump" ? 3 : 2);

    // --- Legs (behind torso) ---
    c.strokeStyle = colors.accent;
    c.lineWidth = 5.5;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(-5, hipY);
    c.lineTo(legLX, hipY + legLY);
    c.moveTo(5, hipY);
    c.lineTo(legRX, hipY + legRY);
    c.stroke();

    // --- Back layers: knight cape / wanderer gown train / fox collar ---
    if (charId === "knight") {
      // Fluttering cape (distinct from cloak panels) — sine offset from walk phase
      c.fillStyle = colors.cloak;
      c.beginPath();
      c.moveTo(-6, by + 4);
      c.quadraticCurveTo(-22 - capeFlutter, by + bodyH * 0.45, -18 - capeFlutter * 0.6, by + bodyH + 10);
      c.lineTo(-4, by + bodyH - 2);
      c.quadraticCurveTo(-8, by + 14, -4, by + 6);
      c.closePath();
      c.fill();
      c.fillStyle = "rgba(20,14,30,0.2)";
      c.beginPath();
      c.moveTo(-8, by + 10);
      c.quadraticCurveTo(-16 - capeFlutter * 0.5, by + bodyH * 0.55, -12, by + bodyH + 4);
      c.lineTo(-6, by + bodyH - 4);
      c.closePath();
      c.fill();
    } else if (charId === "wanderer") {
      // Flowing gown skirt (drawn behind torso for depth)
      c.fillStyle = colors.body;
      c.beginPath();
      c.moveTo(-10, by + bodyH * 0.35);
      c.quadraticCurveTo(-18 + hemSway, by + bodyH + 6, -14 + hemSway, hipY + 14);
      c.lineTo(14 - hemSway * 0.5, hipY + 14);
      c.quadraticCurveTo(18 - hemSway, by + bodyH + 6, 10, by + bodyH * 0.35);
      c.closePath();
      c.fill();
      // Hem highlight / sway fold
      c.strokeStyle = colors.trim;
      c.globalAlpha = 0.55;
      c.lineWidth = 1.5;
      c.beginPath();
      c.moveTo(-12 + hemSway, hipY + 12);
      c.quadraticCurveTo(0, hipY + 15 + Math.abs(hemSway) * 0.3, 12 - hemSway * 0.5, hipY + 12);
      c.stroke();
      c.globalAlpha = 1;
    } else {
      // Fox / default: cloak panels
      fillRoundRectOn(c, -16, by - 4, 14, bodyH + 8, 6, colors.cloak);
      fillRoundRectOn(c, 4, by + 2, 12, bodyH - 2, 5, colors.cloak);
      fillRoundRectOn(c, -14, by + 6, 5, bodyH - 10, 3, "rgba(20,14,30,0.18)");
      fillRoundRectOn(c, -14, by - 2, 28, 10, 5, colors.cloak);
      c.fillStyle = colors.trim;
      c.beginPath();
      c.moveTo(-10, by + 6);
      c.quadraticCurveTo(0, by + 12, 10, by + 6);
      c.lineTo(8, by + 2);
      c.quadraticCurveTo(0, by + 6, -8, by + 2);
      c.closePath();
      c.fill();
    }

    // --- Torso ---
    if (charId === "wanderer") {
      // Fitted bodice above the wider skirt
      fillRoundRectOn(c, -11, by, 22, bodyH * 0.55, 7, colors.body);
      fillRoundRectOn(c, -10, by + 3, 7, bodyH * 0.4, 3, "rgba(255,255,255,0.18)");
      // Hip satchel
      c.fillStyle = colors.cloak;
      c.beginPath();
      c.ellipse(12, by + bodyH * 0.52, 6.5, 5, 0.2, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = colors.accent;
      c.fillRect(10, by + bodyH * 0.42, 5, 2);
      c.strokeStyle = colors.trim;
      c.lineWidth = 1.2;
      c.beginPath();
      c.moveTo(6, by + bodyH * 0.38);
      c.lineTo(12, by + bodyH * 0.48);
      c.stroke();
    } else if (charId === "knight") {
      fillRoundRectOn(c, -12, by, 24, bodyH, 7, colors.body);
      // Pauldrons
      fillRoundRectOn(c, -16, by + 1, 10, 12, 4, colors.accent);
      fillRoundRectOn(c, 6, by + 1, 10, 12, 4, colors.accent);
      c.fillStyle = "rgba(255,255,255,0.28)";
      c.fillRect(-14, by + 3, 6, 1.5);
      c.fillRect(8, by + 3, 6, 1.5);
      // Chest emblem
      c.fillStyle = colors.trim;
      c.beginPath();
      c.moveTo(0, by + 10);
      c.lineTo(5, by + 16);
      c.lineTo(0, by + 22);
      c.lineTo(-5, by + 16);
      c.closePath();
      c.fill();
      c.fillStyle = colors.accent;
      c.globalAlpha = 0.45;
      c.beginPath();
      c.moveTo(0, by + 12);
      c.lineTo(3, by + 16);
      c.lineTo(0, by + 19);
      c.lineTo(-3, by + 16);
      c.closePath();
      c.fill();
      c.globalAlpha = 1;
      // Belt + buckle
      fillRoundRectOn(c, -11, by + bodyH * 0.58, 22, 5, 1.5, colors.accent);
      fillRoundRectOn(c, -3, by + bodyH * 0.56, 6, 7, 1.5, colors.trim);
      c.fillStyle = colors.accent;
      c.fillRect(-1.5, by + bodyH * 0.58, 3, 3);
    } else {
      fillRoundRectOn(c, -12, by, 24, bodyH, 8, colors.body);
      fillRoundRectOn(c, -11, by + bodyH * 0.55, 22, 6, 2, colors.cloak);
      c.fillStyle = colors.accent;
      c.globalAlpha = 0.55;
      c.fillRect(-10, by + bodyH * 0.55 + 2, 20, 2);
      c.globalAlpha = 1;
      fillRoundRectOn(c, -9, by + 3, 8, bodyH - 10, 4, "rgba(255,255,255,0.2)");
    }

    // --- Arms ---
    c.strokeStyle = charId === "knight" ? colors.accent : colors.cloak;
    c.lineWidth = charId === "knight" ? 5.2 : 4.8;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(-10, shoulderY);
    c.lineTo(armLX, shoulderY + armLY);
    c.moveTo(10, shoulderY);
    c.lineTo(armRX, shoulderY + armRY);
    c.stroke();
    c.fillStyle = colors.skin;
    c.beginPath();
    c.arc(armLX, shoulderY + armLY, 2.4, 0, Math.PI * 2);
    c.arc(armRX, shoulderY + armRY, 2.4, 0, Math.PI * 2);
    c.fill();

    // --- Head ---
    const headY = by - 2;
    c.beginPath();
    c.fillStyle = colors.skin;
    c.arc(0, headY, 10.5, 0, Math.PI * 2);
    c.fill();

    if (charId === "wanderer") {
      // Refined hair + circlet (not a plain hood)
      c.fillStyle = colors.cloak;
      c.beginPath();
      c.arc(0, headY - 2, 11.5, Math.PI * 1.05, Math.PI * 1.95);
      c.quadraticCurveTo(12, headY + 6, 8, headY + 12);
      c.lineTo(5, headY + 4);
      c.quadraticCurveTo(0, headY + 8, -5, headY + 4);
      c.lineTo(-8, headY + 12);
      c.quadraticCurveTo(-12, headY + 6, -11, headY - 2);
      c.closePath();
      c.fill();
      // Soft side locks
      c.beginPath();
      c.moveTo(-10, headY + 2);
      c.quadraticCurveTo(-14, headY + 10, -9, headY + 16);
      c.lineTo(-6, headY + 10);
      c.closePath();
      c.fill();
      // Circlet
      c.strokeStyle = colors.trim;
      c.lineWidth = 2;
      c.beginPath();
      c.arc(0, headY - 4, 10, Math.PI * 1.1, Math.PI * 1.9);
      c.stroke();
      c.fillStyle = colors.trim;
      c.beginPath();
      c.arc(0, headY - 13, 2.2, 0, Math.PI * 2);
      c.fill();
    } else {
      c.fillStyle = colors.trim;
      c.beginPath();
      c.arc(0, headY - 2, 11, Math.PI, 0);
      c.fill();
    }

    // Eyes
    c.fillStyle = colors.accent;
    c.beginPath();
    c.arc(3, headY - 1, 1.7, 0, Math.PI * 2);
    c.arc(7.5, headY - 1, 1.7, 0, Math.PI * 2);
    c.fill();

    // --- Character-specific head accents ---
    if (charId === "fox") {
      c.fillStyle = colors.body;
      c.beginPath();
      c.moveTo(-9, headY - 8);
      c.lineTo(-3, headY - 22);
      c.lineTo(1, headY - 8);
      c.closePath();
      c.fill();
      c.beginPath();
      c.moveTo(3, headY - 8);
      c.lineTo(9, headY - 22);
      c.lineTo(12, headY - 7);
      c.closePath();
      c.fill();
      c.fillStyle = colors.trim;
      c.beginPath();
      c.moveTo(-7, headY - 10);
      c.lineTo(-3, headY - 18);
      c.lineTo(0, headY - 10);
      c.closePath();
      c.fill();
      c.beginPath();
      c.moveTo(5, headY - 10);
      c.lineTo(9, headY - 18);
      c.lineTo(10, headY - 10);
      c.closePath();
      c.fill();
      c.fillStyle = colors.skin;
      c.beginPath();
      c.ellipse(6, headY + 5, 4.5, 3, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = colors.accent;
      c.beginPath();
      c.arc(8.5, headY + 5, 1.2, 0, Math.PI * 2);
      c.fill();
    } else if (charId === "knight") {
      // Full helm with visor slit
      fillRoundRectOn(c, -12, headY - 12, 24, 18, 5, colors.accent);
      c.fillStyle = "rgba(255,255,255,0.28)";
      c.fillRect(-10, headY - 10, 20, 2);
      // Visor slit
      c.fillStyle = "rgba(12,10,20,0.72)";
      fillRoundRectOn(c, -8, headY - 3, 16, 3.5, 1, "rgba(12,10,20,0.72)");
      // Cheek / neck guards
      fillRoundRectOn(c, -13, headY - 2, 4, 12, 1.5, colors.accent);
      fillRoundRectOn(c, 9, headY - 2, 4, 12, 1.5, colors.accent);
      // Helm crest
      c.fillStyle = colors.trim;
      c.beginPath();
      c.moveTo(-2, headY - 12);
      c.lineTo(0, headY - 18);
      c.lineTo(2, headY - 12);
      c.closePath();
      c.fill();
    } else if (charId === "wanderer") {
      // Soft scarf at the neckline
      fillRoundRectOn(c, -5, by + 1, 12, 4, 2, colors.trim);
    }

    if (trim || hasGoldenTrim) {
      c.strokeStyle = "#D4AF37";
      c.lineWidth = 2;
      c.strokeRect(-12, by, 24, bodyH * (charId === "wanderer" ? 0.55 : 1));
    }
    if (crown) {
      c.fillStyle = "#D4AF37";
      c.beginPath();
      c.moveTo(-8, headY - 14);
      c.lineTo(-4, headY - 22);
      c.lineTo(0, headY - 14);
      c.lineTo(4, headY - 22);
      c.lineTo(8, headY - 14);
      c.closePath();
      c.fill();
    }
    c.restore();
  }

  function drawCharacter(px, py, charId, opts = {}) {
    drawCharacterOn(ctx, px, py, charId, opts);
  }

  function currentPose(p) {
    if (state === "FAILED" || p.stumble > 0) return "fail";
    if (p.climbing) return "climb";
    if (!p.onGround) return "jump";
    if (Math.abs(p.vx) > 8) return "walk";
    return "idle";
  }

  /* ======================================================================== */
  /* Parallax background — 3 procedural layers per zone + ambient particles  */
  /* ======================================================================== */

  function currentZonePalette() {
    return zonePalette(zoneAt(player ? player.x : 0).id);
  }

  function hexToRgba(hex, a) {
    const h = hex.replace("#", "");
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  /** Soft ground wash so silhouettes meet the playable floor cleanly. */
  function drawGroundWash(pal) {
    const g = ctx.createLinearGradient(0, GROUND_Y - 8, 0, canvas.height);
    g.addColorStop(0, pal.skyBottom);
    g.addColorStop(0.35, pal.mid);
    g.addColorStop(1, pal.far);
    ctx.fillStyle = g;
    ctx.fillRect(0, GROUND_Y - 8, canvas.width, canvas.height - GROUND_Y + 8);
  }

  function drawSky(pal, zoneId) {
    const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    g.addColorStop(0, pal.skyTop);
    g.addColorStop(1, pal.skyBottom);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, canvas.width, GROUND_Y + 90);

    // Warm-glow sky accent: soft mushroom/lantern/torch wash, or sunset halo
    ctx.save();
    const isGrand = zoneId === "grand_castle";
    const isNight = selectedTheme === "night";
    const haloX = canvas.width * (isGrand ? 0.78 : isNight ? 0.72 : 0.62);
    const haloY = isGrand ? 95 : isNight ? 78 : 130;
    const haloR = isGrand ? 260 : isNight ? 140 : 180;
    const haloColor = isNight ? (pal.halo || "#E8E4F0") : pal.halo || pal.glow;
    const intensity = isGrand ? 0.62 : isNight ? 0.22 : 0.28;
    const rg = ctx.createRadialGradient(haloX, haloY, 8, haloX, haloY, haloR);
    rg.addColorStop(0, hexToRgba(haloColor, intensity));
    rg.addColorStop(1, hexToRgba(haloColor, 0));
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, canvas.width, GROUND_Y);

    if (isNight) {
      // Moon
      ctx.fillStyle = "rgba(235, 232, 245, 0.92)";
      ctx.beginPath();
      ctx.arc(haloX, haloY, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pal.skyTop;
      ctx.beginPath();
      ctx.arc(haloX + 8, haloY - 4, 18, 0, Math.PI * 2);
      ctx.fill();
      // Stars — hashed so they stay stable while scrolling
      for (let i = 0; i < 42; i++) {
        const sx = hash01(i * 17 + 3) * canvas.width;
        const sy = hash01(i * 29 + 5) * (GROUND_Y * 0.72);
        const twinkle = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(elapsedRun * 1.4 + i));
        ctx.fillStyle = `rgba(230, 235, 255, ${twinkle})`;
        ctx.fillRect(sx, sy, 1.6 + hash01(i) * 1.2, 1.6 + hash01(i + 1) * 1.2);
      }
    } else {
      // Soft sun disc + drifting cloud puffs
      ctx.fillStyle = hexToRgba(pal.glow || "#F4C95D", 0.55);
      ctx.beginPath();
      ctx.arc(haloX, haloY, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hexToRgba(pal.halo || "#F9DFAE", 0.85);
      ctx.beginPath();
      ctx.arc(haloX, haloY, 10, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 5; i++) {
        const cx = ((hash01(i * 11) * canvas.width * 1.4 + elapsedRun * (4 + i)) % (canvas.width + 120)) - 60;
        const cy = 40 + hash01(i * 7 + 2) * 70;
        const cw = 28 + hash01(i * 3) * 22;
        ctx.fillStyle = "rgba(255, 250, 240, 0.22)";
        ctx.beginPath();
        ctx.ellipse(cx, cy, cw, cw * 0.45, 0, 0, Math.PI * 2);
        ctx.ellipse(cx - cw * 0.45, cy + 4, cw * 0.55, cw * 0.35, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + cw * 0.4, cy + 2, cw * 0.5, cw * 0.32, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /** Far layer — zone skyline silhouettes tiled by hashed world positions. */
  function drawFarLayer(pal, zoneId, parX) {
    const TILE = 200;
    const startTile = Math.floor((parX - 120) / TILE) - 1;
    const endTile = Math.floor((parX + canvas.width + 120) / TILE) + 1;

    for (let i = startTile; i <= endTile; i++) {
      const jitter = hash01(i) * 48 - 8;
      const wx = i * TILE + jitter;
      const sx = wx - parX;
      const h = 85 + hash01(i * 7 + 1) * 85;
      const variety = hash01(i * 11 + 3);

      if (zoneId === "forest") {
        // Conifer tree silhouettes (layered triangles)
        ctx.fillStyle = pal.far;
        const half = 28 + variety * 14;
        ctx.beginPath();
        ctx.moveTo(sx - half, GROUND_Y - 6);
        ctx.lineTo(sx, GROUND_Y - 6 - h);
        ctx.lineTo(sx + half, GROUND_Y - 6);
        ctx.closePath();
        ctx.fill();
        if (variety > 0.45) {
          ctx.globalAlpha = 0.55;
          ctx.beginPath();
          ctx.moveTo(sx - half * 0.7, GROUND_Y - 6);
          ctx.lineTo(sx + 10, GROUND_Y - 6 - h * 0.72);
          ctx.lineTo(sx + half * 0.85, GROUND_Y - 6);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      } else if (zoneId === "village") {
        // Distant cottage rooftop skyline
        ctx.fillStyle = pal.far;
        const bw = 38 + variety * 18;
        const bh = h * 0.55;
        ctx.fillRect(sx - bw / 2, GROUND_Y - bh, bw, bh + 18);
        ctx.beginPath();
        ctx.moveTo(sx - bw / 2 - 4, GROUND_Y - bh);
        ctx.lineTo(sx, GROUND_Y - bh - 18 - variety * 10);
        ctx.lineTo(sx + bw / 2 + 4, GROUND_Y - bh);
        ctx.closePath();
        ctx.fill();
        // Chimney
        if (variety > 0.5) {
          ctx.fillRect(sx + bw * 0.15, GROUND_Y - bh - 28, 8, 22);
        }
      } else if (zoneId === "castle") {
        // Stone battlement / tower skyline
        ctx.fillStyle = pal.far;
        const tw = 46 + variety * 16;
        ctx.fillRect(sx - tw / 2, GROUND_Y - h, tw, h + 18);
        const merlons = 3 + (i % 2);
        const mw = tw / merlons;
        for (let b = 0; b < merlons; b++) {
          if (b % 2 === 0) {
            ctx.fillRect(sx - tw / 2 + b * mw, GROUND_Y - h - 12, mw * 0.7, 14);
          }
        }
      } else {
        // Grand castle: tall spire skyline in deep silhouette
        ctx.fillStyle = pal.silhouette || pal.far;
        const tw = 36 + variety * 22;
        ctx.fillRect(sx - tw / 2, GROUND_Y - h, tw, h + 18);
        // Spire tip
        ctx.beginPath();
        ctx.moveTo(sx - tw * 0.35, GROUND_Y - h);
        ctx.lineTo(sx, GROUND_Y - h - 28 - variety * 24);
        ctx.lineTo(sx + tw * 0.35, GROUND_Y - h);
        ctx.closePath();
        ctx.fill();
        // Lit window (sunset glow)
        if (variety > 0.4) {
          ctx.fillStyle = hexToRgba(pal.glow, 0.55);
          ctx.fillRect(sx - 5, GROUND_Y - h * 0.45, 10, 14);
        }
      }
    }
  }

  /** Mid layer — bushes / fences / ivy walls + warm-glow accents per zone. */
  function drawMidLayer(pal, zoneId, parX) {
    const TILE = 140;
    const startTile = Math.floor((parX - 100) / TILE) - 1;
    const endTile = Math.floor((parX + canvas.width + 100) / TILE) + 1;

    for (let i = startTile; i <= endTile; i++) {
      const wx = i * TILE + hash01(i * 3) * 36;
      const sx = wx - parX;
      const s = 0.7 + hash01(i * 5 + 2) * 0.55;
      const roll = hash01(i * 9);

      if (zoneId === "forest") {
        // Bushes
        ctx.fillStyle = pal.mid;
        ctx.beginPath();
        ctx.ellipse(sx, GROUND_Y - 8, 28 * s, 18 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(sx - 16 * s, GROUND_Y - 4, 16 * s, 12 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        // Glowing mushroom accent
        if (roll > 0.55) {
          const mx = sx + 10 * s;
          const my = GROUND_Y - 14 * s;
          ctx.fillStyle = hexToRgba(pal.glow, 0.35);
          ctx.beginPath();
          ctx.arc(mx, my, 10 * s, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = pal.glow;
          ctx.beginPath();
          ctx.ellipse(mx, my - 2 * s, 7 * s, 5 * s, 0, Math.PI, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = pal.fog;
          ctx.fillRect(mx - 2 * s, my - 2 * s, 4 * s, 10 * s);
        }
      } else if (zoneId === "village") {
        // Fence run
        ctx.fillStyle = pal.wood;
        ctx.fillRect(sx - 20 * s, GROUND_Y - 8, 40 * s, 3);
        ctx.fillRect(sx - 16 * s, GROUND_Y - 20 * s, 3, 20 * s);
        ctx.fillRect(sx + 12 * s, GROUND_Y - 20 * s, 3, 20 * s);
        // Lantern post + warm glow
        if (roll > 0.5) {
          ctx.fillStyle = pal.near;
          ctx.fillRect(sx - 2, GROUND_Y - 36 * s, 4, 36 * s);
          ctx.fillStyle = pal.wall;
          ctx.fillRect(sx - 7 * s, GROUND_Y - 44 * s, 14 * s, 10 * s);
          ctx.fillStyle = hexToRgba(pal.glow, 0.4);
          ctx.beginPath();
          ctx.arc(sx, GROUND_Y - 40 * s, 14 * s, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = pal.glow;
          ctx.beginPath();
          ctx.arc(sx, GROUND_Y - 39 * s, 4 * s, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (zoneId === "castle") {
        // Ivy-covered wall segments
        ctx.fillStyle = pal.mid;
        ctx.fillRect(sx - 22 * s, GROUND_Y - 44 * s, 44 * s, 44 * s);
        ctx.fillStyle = pal.banner;
        ctx.globalAlpha = 0.25;
        ctx.fillRect(sx - 18 * s, GROUND_Y - 40 * s, 36 * s, 8);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = pal.ivy;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(sx - 12 * s, GROUND_Y - 2);
        ctx.quadraticCurveTo(sx - 4 * s, GROUND_Y - 22 * s, sx - 10 * s, GROUND_Y - 42 * s);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sx + 8 * s, GROUND_Y - 2);
        ctx.quadraticCurveTo(sx + 14 * s, GROUND_Y - 18 * s, sx + 6 * s, GROUND_Y - 38 * s);
        ctx.stroke();
        // Torch bracket + flame glow
        if (roll > 0.48) {
          ctx.fillStyle = "#2a2a30";
          ctx.fillRect(sx + 14 * s, GROUND_Y - 34 * s, 3, 12 * s);
          ctx.fillStyle = hexToRgba(pal.glow, 0.45);
          ctx.beginPath();
          ctx.arc(sx + 15.5 * s, GROUND_Y - 36 * s, 11 * s, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = pal.glow;
          ctx.beginPath();
          ctx.moveTo(sx + 15.5 * s, GROUND_Y - 42 * s);
          ctx.lineTo(sx + 12 * s, GROUND_Y - 34 * s);
          ctx.lineTo(sx + 19 * s, GROUND_Y - 34 * s);
          ctx.closePath();
          ctx.fill();
        }
      } else {
        // Grand castle: buttress / low wall with sunset wash
        ctx.fillStyle = pal.mid;
        ctx.fillRect(sx - 24 * s, GROUND_Y - 50 * s, 48 * s, 50 * s);
        ctx.fillStyle = pal.silhouette || pal.far;
        ctx.fillRect(sx - 8 * s, GROUND_Y - 68 * s, 16 * s, 20 * s);
        // Sunset warm accent on stone edge
        ctx.fillStyle = hexToRgba(pal.glow, 0.35);
        ctx.fillRect(sx + 10 * s, GROUND_Y - 48 * s, 6 * s, 48 * s);
        if (roll > 0.4) {
          ctx.fillStyle = hexToRgba(pal.halo || pal.glow, 0.5);
          ctx.beginPath();
          ctx.arc(sx, GROUND_Y - 30 * s, 12 * s, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = pal.mid2;
          ctx.fillRect(sx - 4 * s, GROUND_Y - 34 * s, 8 * s, 12 * s);
        }
      }
    }
  }

  /** Near layer — closer foreground props, fastest parallax scroll. */
  function drawNearLayer(pal, zoneId, parX) {
    const TILE = 110;
    const startTile = Math.floor((parX - 80) / TILE) - 1;
    const endTile = Math.floor((parX + canvas.width + 80) / TILE) + 1;

    for (let i = startTile; i <= endTile; i++) {
      // Sparse tiling so the near layer doesn't crowd the playfield
      if (hash01(i * 17 + 4) < 0.42) continue;

      const wx = i * TILE + hash01(i * 19) * 28;
      const sx = wx - parX;
      const s = 0.85 + hash01(i * 23) * 0.5;
      const roll = hash01(i * 29);

      if (zoneId === "forest") {
        ctx.fillStyle = pal.near;
        ctx.beginPath();
        ctx.ellipse(sx, GROUND_Y + 4, 22 * s, 10 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        if (roll > 0.6) {
          ctx.fillStyle = hexToRgba(pal.glow2, 0.55);
          ctx.beginPath();
          ctx.arc(sx - 8 * s, GROUND_Y - 6 * s, 3.5 * s, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (zoneId === "village") {
        ctx.fillStyle = pal.near;
        ctx.fillRect(sx - 3, GROUND_Y - 16 * s, 5, 16 * s + 6);
        ctx.fillStyle = pal.wood;
        ctx.fillRect(sx - 14 * s, GROUND_Y - 4, 28 * s, 3);
      } else if (zoneId === "castle") {
        ctx.fillStyle = pal.near;
        ctx.fillRect(sx - 16 * s, GROUND_Y - 18 * s, 32 * s, 18 * s + 6);
        ctx.fillStyle = pal.ivy;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.ellipse(sx + 6 * s, GROUND_Y - 2, 10 * s, 6 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      } else {
        ctx.fillStyle = pal.mid2 || pal.near;
        ctx.fillRect(sx - 18 * s, GROUND_Y - 14 * s, 36 * s, 14 * s + 6);
        ctx.fillStyle = hexToRgba(pal.glow, 0.3);
        ctx.fillRect(sx - 18 * s, GROUND_Y - 14 * s, 36 * s, 3);
      }
    }
  }

  /**
   * Decorative secondary parallax (between mid & near) — fences, carts, hay,
   * sign posts. Non-colliding, purely visual; densest in the Village.
   */
  function drawDecorLayer(pal, zoneId, parX) {
    const TILE = 120;
    const startTile = Math.floor((parX - 90) / TILE) - 1;
    const endTile = Math.floor((parX + canvas.width + 90) / TILE) + 1;
    const density = zoneId === "village" ? 0.28 : zoneId === "forest" ? 0.55 : 0.62;

    for (let i = startTile; i <= endTile; i++) {
      if (hash01(i * 41 + 9) < density) continue;

      const wx = i * TILE + hash01(i * 37) * 40;
      const sx = wx - parX;
      const s = 0.75 + hash01(i * 43) * 0.4;
      const kind = hash01(i * 47);

      if (zoneId === "village") {
        if (kind < 0.28) {
          // Low fence stretch
          ctx.fillStyle = pal.wood;
          ctx.fillRect(sx - 22 * s, GROUND_Y - 6, 44 * s, 3);
          for (let p = -18; p <= 18; p += 12) {
            ctx.fillRect(sx + p * s, GROUND_Y - 18 * s, 3, 18 * s);
          }
        } else if (kind < 0.5) {
          // Cart
          ctx.fillStyle = pal.near;
          ctx.fillRect(sx - 16 * s, GROUND_Y - 16 * s, 32 * s, 12 * s);
          ctx.fillStyle = pal.wood;
          ctx.fillRect(sx - 18 * s, GROUND_Y - 18 * s, 36 * s, 3);
          ctx.beginPath();
          ctx.arc(sx - 10 * s, GROUND_Y - 2, 5 * s, 0, Math.PI * 2);
          ctx.arc(sx + 12 * s, GROUND_Y - 2, 5 * s, 0, Math.PI * 2);
          ctx.fillStyle = pal.far;
          ctx.fill();
        } else if (kind < 0.72) {
          // Hay bale
          ctx.fillStyle = pal.glow;
          ctx.beginPath();
          ctx.ellipse(sx, GROUND_Y - 10 * s, 14 * s, 10 * s, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = "rgba(80,50,20,0.35)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.ellipse(sx, GROUND_Y - 10 * s, 14 * s, 10 * s, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          // Sign post
          ctx.fillStyle = pal.near;
          ctx.fillRect(sx - 1.5, GROUND_Y - 34 * s, 3, 34 * s);
          ctx.fillStyle = pal.wall;
          ctx.fillRect(sx - 12 * s, GROUND_Y - 42 * s, 24 * s, 14 * s);
          ctx.strokeStyle = "rgba(20,14,30,0.3)";
          ctx.strokeRect(sx - 12 * s, GROUND_Y - 42 * s, 24 * s, 14 * s);
        }
      } else if (zoneId === "forest") {
        // Occasional stump / mushroom ring accent
        ctx.fillStyle = pal.mid;
        ctx.beginPath();
        ctx.ellipse(sx, GROUND_Y - 4, 10 * s, 5 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        if (kind > 0.6) {
          ctx.fillStyle = hexToRgba(pal.glow, 0.5);
          ctx.beginPath();
          ctx.arc(sx + 6 * s, GROUND_Y - 10 * s, 4 * s, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Sparse stone markers / rubble
        ctx.fillStyle = pal.near;
        ctx.fillRect(sx - 6 * s, GROUND_Y - 10 * s, 12 * s, 10 * s);
      }
    }
  }

  /**
   * Birds (morning) / bats + fireflies (night) — deterministic like particles.
   * Drawn above far/mid, behind player & obstacles.
   */
  function drawCreatures(zoneId, t) {
    const TILE = 300;
    const pad = 220;
    const startTile = Math.floor((cameraX - pad) / TILE) - 1;
    const endTile = Math.floor((cameraX + canvas.width + pad) / TILE) + 1;
    const isNight = selectedTheme === "night";
    const pal = zonePalette(zoneId);

    const edgeFade = (sx) => {
      const m = 80;
      if (sx < -m || sx > canvas.width + m) return 0;
      if (sx < m) return sx / m;
      if (sx > canvas.width - m) return (canvas.width - sx) / m;
      return 1;
    };

    for (let i = startTile; i <= endTile; i++) {
      if (hash01(i * 53 + 11) < 0.42) continue;

      const baseX = i * TILE + hash01(i * 59) * TILE * 0.7;
      const fade = edgeFade(baseX - cameraX);
      if (fade <= 0.01) continue;

      if (isNight) {
        // Bat flock — jagged wings, faster flutter
        if (hash01(i * 61) > 0.35) {
          const flock = 2 + Math.floor(hash01(i * 67) * 3);
          const par = cameraX * 0.48;
          for (let b = 0; b < flock; b++) {
            const bx = baseX - par + b * 16 + Math.sin(t * 1.8 + i + b) * 10;
            const by = 70 + hash01(i * 71 + b) * 90 + Math.sin(t * 3.2 + b) * 8;
            const flap = Math.sin(t * 14 + b * 2.1 + i) * 5;
            const sx = bx;
            const fadeB = edgeFade(sx);
            if (fadeB <= 0.01) continue;
            ctx.globalAlpha = 0.7 * fadeB;
            ctx.fillStyle = "#1a1624";
            ctx.beginPath();
            ctx.moveTo(sx - 7, by - flap);
            ctx.lineTo(sx - 2, by);
            ctx.lineTo(sx, by + 2);
            ctx.lineTo(sx + 2, by);
            ctx.lineTo(sx + 7, by - flap * 0.9);
            ctx.lineTo(sx + 3, by + 1);
            ctx.lineTo(sx - 3, by + 1);
            ctx.closePath();
            ctx.fill();
          }
        }
        // Forest fireflies near the ground (night + forest especially)
        if (zoneId === "forest" || hash01(i * 73) > 0.55) {
          for (let f = 0; f < 3; f++) {
            if (hash01(i * 79 + f) < 0.4) continue;
            const fx = baseX - cameraX + hash01(i * 83 + f) * 80 + Math.sin(t * 0.9 + f) * 12;
            const fy = GROUND_Y - 18 - hash01(i * 89 + f) * 50 + Math.cos(t * 1.3 + f) * 6;
            const pulse = 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * 4 + f * 2 + i));
            ctx.globalAlpha = pulse * fade;
            ctx.fillStyle = pal.glow;
            ctx.beginPath();
            ctx.arc(fx, fy, 1.8, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = hexToRgba(pal.glow, 0.35);
            ctx.beginPath();
            ctx.arc(fx, fy, 4.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.globalAlpha = 1;
      } else {
        // Morning: V-wing bird flock on slow parallax
        const flock = 3 + Math.floor(hash01(i * 91) * 3);
        const drift = t * (12 + hash01(i) * 8);
        for (let b = 0; b < flock; b++) {
          const bx = ((baseX - cameraX * PARALLAX.far + drift + b * 18) % (canvas.width + 160)) - 40;
          const by = 50 + hash01(i * 97 + b) * 70 + Math.sin(t * 0.6 + b) * 4;
          const flap = Math.sin(t * 3.5 + b * 1.4 + i) > 0 ? 4 : 1.5;
          ctx.globalAlpha = 0.55 * fade;
          ctx.strokeStyle = "rgba(40, 36, 50, 0.75)";
          ctx.lineWidth = 1.6;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(bx - 8, by - flap);
          ctx.lineTo(bx, by);
          ctx.lineTo(bx + 8, by - flap * 0.9);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
  }

  /* ======================================================================== */
  /* Ambient particles — fairies / smoke / embers, deterministic per tile so  */
  /* they never pop in/out abruptly.                                          */
  /* ======================================================================== */

  // Ambient particles — hashed from world tile index (no growing arrays).
  // Soft edge fade + cycle fades keep them from hard-popping at wraps/camera.
  function drawParticles(zoneId, t) {
    const TILE = 260;
    const pad = 200;
    const startTile = Math.floor((cameraX - pad) / TILE) - 1;
    const endTile = Math.floor((cameraX + canvas.width + pad) / TILE) + 1;
    const pal = zonePalette(zoneId);
    if (!pal) return;

    const edgeFade = (sx) => {
      const m = 70;
      if (sx < -m || sx > canvas.width + m) return 0;
      if (sx < m) return sx / m;
      if (sx > canvas.width - m) return (canvas.width - sx) / m;
      return 1;
    };

    for (let i = startTile; i <= endTile; i++) {
      // Sparse density so only a handful of particles are on screen.
      if (hash01(i * 31 + 7) < 0.38) continue;

      const baseX = i * TILE + hash01(i * 13) * TILE;
      const sx = baseX - cameraX;
      const fade = edgeFade(sx);
      if (fade <= 0.01) continue;

      const baseY = GROUND_Y - 60 - hash01(i * 17) * 160;
      const phase = hash01(i * 19) * Math.PI * 2;

      if (zoneId === "forest") {
        // Looping glowing fairy with a soft 4-dot trail
        for (let trail = 3; trail >= 0; trail--) {
          const tt = t - trail * 0.11;
          const tx = sx + Math.sin(tt * 0.9 + phase) * 26;
          const ty = baseY + Math.cos(tt * 1.3 + phase * 1.7) * 16;
          const a = (0.48 - trail * 0.1) * fade;
          if (a <= 0) continue;
          ctx.beginPath();
          ctx.fillStyle = hexToRgba(trail % 2 === 0 ? pal.glow : pal.glow2, a);
          ctx.arc(tx, ty, 3 - trail * 0.55, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (zoneId === "village") {
        // Rising chimney smoke — two staggered puffs, faded at birth/death
        const life = 72;
        for (let puff = 0; puff < 2; puff++) {
          const cycle = (t * 14 + phase * 40 + puff * 36) % life;
          const riseFade = Math.sin((cycle / life) * Math.PI);
          const sway = Math.sin(t * 0.75 + phase + puff) * (2 + cycle * 0.04);
          const a = 0.22 * riseFade * fade;
          if (a <= 0.01) continue;
          ctx.beginPath();
          ctx.fillStyle = `rgba(230, 225, 220, ${a})`;
          ctx.arc(sx + sway, GROUND_Y - 72 - cycle, 3.5 + cycle * 0.07, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (zoneId === "castle") {
        // Torch embers drifting up with soft fade-out
        const life = 52;
        for (let e = 0; e < 2; e++) {
          if (e === 1 && hash01(i * 41 + 3) < 0.45) continue;
          const cycle = (t * 38 + phase * 50 + e * 26) % life;
          const riseFade = Math.max(0, 1 - cycle / life);
          const wobble = Math.sin(t * 2.1 + phase + e) * (3 + cycle * 0.07);
          const a = 0.55 * riseFade * fade;
          if (a <= 0.01) continue;
          ctx.beginPath();
          ctx.fillStyle = hexToRgba(pal.glow, a);
          ctx.arc(sx + wobble + (e * 7 - 3), GROUND_Y - 38 - cycle * 1.15, 1.7 + (1 - riseFade) * 0.6, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        // Grand castle: slow golden motes — continuous sine drift (no wrap pop)
        const mx = sx + Math.sin(t * 0.22 + phase) * 42;
        const my = baseY + Math.cos(t * 0.16 + phase * 1.4) * 20;
        const pulse = 0.22 + 0.18 * (0.5 + 0.5 * Math.sin(t * 0.45 + phase));
        const a = pulse * fade;
        ctx.beginPath();
        ctx.fillStyle = hexToRgba(pal.halo || pal.glow, a);
        ctx.arc(mx, my, 2.3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /* ======================================================================== */
  /* Foreground world — placed scenery + obstacles with material styling      */
  /* ======================================================================== */

  function drawScenery(s, viewL, viewR) {
    if (s.x < viewL - 220 || s.x > viewR + 220) return;
    const sx = s.x - cameraX;

    if (s.type === "tree") {
      const w = 46 * s.scale;
      const h = 100 * s.scale;
      const pal = zonePalette("forest");
      // Trunk with rim
      drawObstacleShape(sx - 5, GROUND_Y - h * 0.35, 10, h * 0.35, 2, "#3d2a22", "rgba(255,220,180,0.2)");
      // Leafy canopy — overlapping lobes so it matches hedge material language
      const canopyY = GROUND_Y - h * 0.55;
      const lobes = [
        [0, -h * 0.42, w * 0.38],
        [-w * 0.28, -h * 0.22, w * 0.3],
        [w * 0.28, -h * 0.22, w * 0.3],
        [0, -h * 0.12, w * 0.34],
      ];
      for (const [ox, oy, r] of lobes) {
        ctx.beginPath();
        ctx.ellipse(sx + ox, canopyY + oy, r, r * 0.85, 0, 0, Math.PI * 2);
        ctx.fillStyle = pal.near;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(20,14,30,0.35)";
        ctx.stroke();
      }
      ctx.fillStyle = hexToRgba(pal.fog, 0.35);
      ctx.beginPath();
      ctx.ellipse(sx - 4, canopyY - h * 0.38, w * 0.18, w * 0.14, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (s.type === "cottage") {
      const w = 58 * s.scale;
      const h = 46 * s.scale;
      const pal = zonePalette("village");
      const left = sx - w / 2;
      // Wood siding walls
      drawObstacleShape(left, GROUND_Y - h, w, h, 4, pal.wood, hexToRgba(pal.wall, 0.55));
      // Vertical + horizontal plank lines
      ctx.strokeStyle = "rgba(20,14,30,0.22)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        const py = GROUND_Y - h + (h / 4) * i;
        ctx.beginPath();
        ctx.moveTo(left + 2, py);
        ctx.lineTo(left + w - 2, py);
        ctx.stroke();
      }
      for (let i = 1; i < 3; i++) {
        const px = left + (w / 3) * i;
        ctx.beginPath();
        ctx.moveTo(px, GROUND_Y - h + 2);
        ctx.lineTo(px, GROUND_Y - 2);
        ctx.stroke();
      }
      // Thatched triangular roof with straw strokes
      const roofPeak = GROUND_Y - h - 26 * s.scale;
      ctx.beginPath();
      ctx.moveTo(left - 8, GROUND_Y - h);
      ctx.lineTo(sx, roofPeak);
      ctx.lineTo(left + w + 8, GROUND_Y - h);
      ctx.closePath();
      ctx.fillStyle = "#9A7340";
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(20,14,30,0.4)";
      ctx.stroke();
      ctx.strokeStyle = "rgba(60,40,18,0.35)";
      ctx.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        const t = (i + 1) / 6;
        const y = GROUND_Y - h - (26 * s.scale) * (1 - t) * 0.85;
        const half = (w / 2 + 8) * t;
        ctx.beginPath();
        ctx.moveTo(sx - half, y);
        ctx.lineTo(sx + half, y);
        ctx.stroke();
      }
      // Door with frame
      drawObstacleShape(sx - 9, GROUND_Y - 22, 18, 22, 3, "#3f2a22", "rgba(255,220,180,0.15)");
      ctx.fillStyle = "#C9A35A";
      ctx.beginPath();
      ctx.arc(sx + 5, GROUND_Y - 11, 1.5, 0, Math.PI * 2);
      ctx.fill();
      // Lit window
      drawObstacleShape(left + w - 24, GROUND_Y - h + 10, 14, 12, 2, pal.glow, "rgba(255,255,220,0.5)");
      ctx.strokeStyle = "rgba(20,14,30,0.35)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(left + w - 17, GROUND_Y - h + 10);
      ctx.lineTo(left + w - 17, GROUND_Y - h + 22);
      ctx.moveTo(left + w - 24, GROUND_Y - h + 16);
      ctx.lineTo(left + w - 10, GROUND_Y - h + 16);
      ctx.stroke();
    } else if (s.type === "market_stall") {
      const w = 64 * s.scale;
      const h = 36 * s.scale;
      const pal = zonePalette("village");
      const left = sx - w / 2;
      // Counter
      drawObstacleShape(left, GROUND_Y - h * 0.45, w, h * 0.45, 3, pal.wood, hexToRgba(pal.wall, 0.4));
      // Posts
      ctx.fillStyle = pal.near;
      ctx.fillRect(left + 4, GROUND_Y - h - 4, 4, h + 4);
      ctx.fillRect(left + w - 8, GROUND_Y - h - 4, 4, h + 4);
      // Striped awning
      ctx.beginPath();
      ctx.moveTo(left - 6, GROUND_Y - h);
      ctx.lineTo(sx, GROUND_Y - h - 14 * s.scale);
      ctx.lineTo(left + w + 6, GROUND_Y - h);
      ctx.closePath();
      ctx.fillStyle = pal.glow;
      ctx.fill();
      ctx.fillStyle = pal.near;
      for (let i = 0; i < 5; i++) {
        const t0 = i / 5;
        const t1 = (i + 0.5) / 5;
        const x0 = left - 6 + (w + 12) * t0;
        const x1 = left - 6 + (w + 12) * t1;
        ctx.beginPath();
        ctx.moveTo(x0, GROUND_Y - h);
        ctx.lineTo(sx, GROUND_Y - h - 14 * s.scale);
        ctx.lineTo(x1, GROUND_Y - h);
        ctx.closePath();
        ctx.fill();
      }
      // Goods on counter
      ctx.fillStyle = "#6B9E6F";
      ctx.beginPath();
      ctx.arc(sx - 12 * s.scale, GROUND_Y - h * 0.55, 5 * s.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#D99B9E";
      ctx.fillRect(sx + 4 * s.scale, GROUND_Y - h * 0.62, 10 * s.scale, 8 * s.scale);
      ctx.fillStyle = pal.glow;
      ctx.beginPath();
      ctx.ellipse(sx + 18 * s.scale, GROUND_Y - h * 0.52, 6 * s.scale, 4 * s.scale, 0, 0, Math.PI * 2);
      ctx.fill();
    } else if (s.type === "forge") {
      const w = 54 * s.scale;
      const h = 48 * s.scale;
      const pal = zonePalette("village");
      const left = sx - w / 2;
      drawObstacleShape(left, GROUND_Y - h, w, h, 4, "#5a4a46", "rgba(255,200,160,0.2)");
      // Chimney
      ctx.fillStyle = "#3a3230";
      ctx.fillRect(sx + w * 0.15, GROUND_Y - h - 28 * s.scale, 12 * s.scale, 30 * s.scale);
      // Forge glow opening
      const flicker = 0.7 + 0.3 * Math.sin(elapsedRun * 8 + s.seed);
      const glow = ctx.createRadialGradient(sx, GROUND_Y - 18, 0, sx, GROUND_Y - 18, 22 * s.scale);
      glow.addColorStop(0, hexToRgba(pal.glow, 0.85 * flicker));
      glow.addColorStop(1, hexToRgba(pal.glow, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(sx, GROUND_Y - 16, 20 * s.scale, 0, Math.PI * 2);
      ctx.fill();
      drawObstacleShape(sx - 10 * s.scale, GROUND_Y - 22 * s.scale, 20 * s.scale, 16 * s.scale, 3, "#2a2018", hexToRgba(pal.glow, 0.5));
      // Anvil silhouette
      ctx.fillStyle = "#2E2748";
      ctx.fillRect(sx - 22 * s.scale, GROUND_Y - 14, 14 * s.scale, 8);
      ctx.fillRect(sx - 18 * s.scale, GROUND_Y - 20, 8 * s.scale, 6);
      // Smoke puff
      ctx.fillStyle = `rgba(200,200,210,${0.2 + 0.1 * Math.sin(elapsedRun * 2 + s.seed)})`;
      ctx.beginPath();
      ctx.arc(sx + w * 0.22, GROUND_Y - h - 34 * s.scale - Math.sin(elapsedRun * 1.5) * 4, 6 * s.scale, 0, Math.PI * 2);
      ctx.fill();
    } else if (s.type === "townhouse") {
      const w = 52 * s.scale;
      const h = 78 * s.scale;
      const pal = zonePalette("village");
      const left = sx - w / 2;
      // Two-story body
      drawObstacleShape(left, GROUND_Y - h, w, h, 4, pal.wall, "rgba(255,255,255,0.25)");
      // Floor line
      ctx.strokeStyle = "rgba(20,14,30,0.2)";
      ctx.beginPath();
      ctx.moveTo(left + 2, GROUND_Y - h * 0.48);
      ctx.lineTo(left + w - 2, GROUND_Y - h * 0.48);
      ctx.stroke();
      // Different roofline — stepped / saltbox peak offset
      const peak = GROUND_Y - h - 22 * s.scale;
      ctx.beginPath();
      ctx.moveTo(left - 6, GROUND_Y - h);
      ctx.lineTo(left + w * 0.35, peak);
      ctx.lineTo(left + w * 0.55, GROUND_Y - h - 10 * s.scale);
      ctx.lineTo(left + w + 6, GROUND_Y - h);
      ctx.closePath();
      ctx.fillStyle = "#7A4A3A";
      ctx.fill();
      ctx.strokeStyle = "rgba(20,14,30,0.4)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Upper + lower windows
      drawObstacleShape(left + 8, GROUND_Y - h + 10, 12, 12, 2, pal.glow, "rgba(255,255,220,0.45)");
      drawObstacleShape(left + w - 22, GROUND_Y - h + 10, 12, 12, 2, pal.glow, "rgba(255,255,220,0.45)");
      drawObstacleShape(left + w - 22, GROUND_Y - h * 0.4, 12, 14, 2, pal.glow, "rgba(255,255,220,0.4)");
      drawObstacleShape(sx - 8, GROUND_Y - 26, 16, 26, 3, "#3f2a22", "rgba(255,220,180,0.12)");
    } else if (s.type === "castle") {
      const w = 74 * s.scale;
      const h = 74 * s.scale;
      const pal = s.tier >= 3 ? zonePalette("grand_castle") : zonePalette("castle");
      const stoneShade = s.tier >= 3 ? "#4a3a5c" : pal.mid;
      const left = sx - w / 2;
      drawObstacleShape(left, GROUND_Y - h, w, h, 4, stoneShade, "rgba(255,255,255,0.18)");
      // Staggered brick / stone lines
      ctx.strokeStyle = "rgba(20,14,30,0.28)";
      ctx.lineWidth = 1;
      const rowH = h / 6;
      for (let row = 1; row < 6; row++) {
        const ry = GROUND_Y - h + row * rowH;
        ctx.beginPath();
        ctx.moveTo(left + 1, ry);
        ctx.lineTo(left + w - 1, ry);
        ctx.stroke();
        const offset = row % 2 === 0 ? w / 8 : 0;
        for (let col = 1; col < 4; col++) {
          const bx = left + offset + col * (w / 4);
          if (bx <= left + 2 || bx >= left + w - 2) continue;
          ctx.beginPath();
          ctx.moveTo(bx, ry);
          ctx.lineTo(bx, ry - rowH);
          ctx.stroke();
        }
      }
      // Battlements with rim
      for (let i = 0; i < 4; i++) {
        drawObstacleShape(left + i * (w / 4) + 3, GROUND_Y - h - 14, w / 5, 16, 2, stoneShade, "rgba(255,255,255,0.15)");
      }
      // Banner (tapered cloth)
      const bx = left + w - 22;
      const by = GROUND_Y - h + 8;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + 12, by);
      ctx.lineTo(bx + 12, by + 28);
      ctx.lineTo(bx + 6, by + 22);
      ctx.lineTo(bx, by + 28);
      ctx.closePath();
      ctx.fillStyle = pal.banner || "#C9C9D2";
      ctx.fill();
      ctx.strokeStyle = "rgba(20,14,30,0.4)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Torch sconce + flame
      const tx = left + 12;
      const ty = GROUND_Y - h + 22;
      ctx.fillStyle = "#2a2220";
      ctx.fillRect(tx - 2, ty, 4, 10);
      const flicker = 3.5 + Math.sin(elapsedRun * 7 + s.seed) * 1.2;
      const flame = ctx.createRadialGradient(tx, ty - 2, 0, tx, ty - 2, flicker * 3);
      flame.addColorStop(0, hexToRgba(pal.glow, 0.95));
      flame.addColorStop(1, hexToRgba(pal.glow, 0));
      ctx.fillStyle = flame;
      ctx.beginPath();
      ctx.arc(tx, ty - 2, flicker * 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pal.glow;
      ctx.beginPath();
      ctx.moveTo(tx - 3, ty);
      ctx.quadraticCurveTo(tx, ty - flicker * 2.2, tx + 3, ty);
      ctx.closePath();
      ctx.fill();
      // Ivy accent on castle walls
      if (s.tier >= 2) {
        const ivy = pal.ivy || "#5C7A52";
        ctx.strokeStyle = ivy;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(left + 4, GROUND_Y);
        ctx.quadraticCurveTo(left - 4, GROUND_Y - h * 0.45, left + 10, GROUND_Y - h * 0.85);
        ctx.stroke();
        ctx.fillStyle = ivy;
        for (let i = 0; i < 4; i++) {
          const iy = GROUND_Y - 12 - i * (h * 0.2);
          ctx.beginPath();
          ctx.ellipse(left + 6 + (i % 2) * 4, iy, 3, 2.2, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (s.type === "glow") {
      const pal = zonePalette(zoneAtWorldX(s.x).id);
      const bob = Math.sin(elapsedRun * 3 + s.seed) * 3;
      const postH = 26 * s.scale;
      if (zoneAtWorldX(s.x).id === "village") {
        ctx.strokeStyle = "#5a3f2c";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(sx, GROUND_Y);
        ctx.lineTo(sx, GROUND_Y - postH);
        ctx.stroke();
      }
      const glowR = 5 * s.scale;
      const rg = ctx.createRadialGradient(sx, GROUND_Y - postH + bob, 0, sx, GROUND_Y - postH + bob, glowR * 4);
      rg.addColorStop(0, hexToRgba(pal.glow, 0.9));
      rg.addColorStop(1, hexToRgba(pal.glow, 0));
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.arc(sx, GROUND_Y - postH + bob, glowR * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = pal.glow;
      ctx.beginPath();
      ctx.arc(sx, GROUND_Y - postH + bob, glowR, 0, Math.PI * 2);
      ctx.fill();
    } else if (s.type === "grand_gate") {
      const pal = zonePalette("grand_castle");
      drawObstacleShape(sx - 60, GROUND_Y - 160, 120, 160, 8, pal.silhouette, "rgba(255,255,255,0.12)");
      // Brick hint on gate towers
      ctx.strokeStyle = "rgba(249,223,174,0.12)";
      ctx.lineWidth = 1;
      for (let y = GROUND_Y - 150; y < GROUND_Y; y += 14) {
        ctx.beginPath();
        ctx.moveTo(sx - 58, y);
        ctx.lineTo(sx - 38, y);
        ctx.moveTo(sx + 38, y);
        ctx.lineTo(sx + 58, y);
        ctx.stroke();
      }
      drawRoundedRect(sx - 35, GROUND_Y - 90, 70, 90, 35, "#F5EFE3");
      ctx.strokeStyle = "rgba(20,14,30,0.35)";
      ctx.lineWidth = 2;
      ctx.strokeRect(sx - 35, GROUND_Y - 90, 70, 90);
      // Twin banners
      for (const side of [-1, 1]) {
        const bx = sx + side * 48;
        ctx.beginPath();
        ctx.moveTo(bx - 5, GROUND_Y - 150);
        ctx.lineTo(bx + 5, GROUND_Y - 150);
        ctx.lineTo(bx + 5, GROUND_Y - 118);
        ctx.lineTo(bx, GROUND_Y - 124);
        ctx.lineTo(bx - 5, GROUND_Y - 118);
        ctx.closePath();
        ctx.fillStyle = pal.halo;
        ctx.fill();
      }
      // Crown finial
      ctx.fillStyle = "#D4AF37";
      ctx.beginPath();
      ctx.moveTo(sx - 40, GROUND_Y - 170);
      ctx.lineTo(sx - 30, GROUND_Y - 190);
      ctx.lineTo(sx - 20, GROUND_Y - 170);
      ctx.lineTo(sx - 10, GROUND_Y - 190);
      ctx.lineTo(sx, GROUND_Y - 170);
      ctx.lineTo(sx + 10, GROUND_Y - 190);
      ctx.lineTo(sx + 20, GROUND_Y - 170);
      ctx.fill();
      // Torches flanking the arch
      for (const side of [-1, 1]) {
        const tx = sx + side * 28;
        const ty = GROUND_Y - 70;
        ctx.fillStyle = "#2a2220";
        ctx.fillRect(tx - 2, ty, 4, 12);
        ctx.fillStyle = pal.glow;
        ctx.beginPath();
        ctx.arc(tx, ty - 2, 3.5 + Math.sin(elapsedRun * 6 + side) * 0.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function zoneAtWorldX(x) {
    return zoneAt(x);
  }

  /** Obstacle rendering by material — jump-over = bright/saturated + low
   *  silhouette; climbable = rung/line/hanging texture ("climb this"). */
  function drawHazard(h, viewL, viewR) {
    if (h.x + h.w < viewL || h.x > viewR) return;
    const sx = h.x - cameraX;
    // Bright, slightly more saturated than zone midtones so jump-overs pop
    const JUMP_COLORS = {
      hedge: "#6FBF6B",
      fence: "#E0B06A",
      crate: "#D4894E",
      rock: "#C4C0B4",
      stone: "#C2C2CC",
    };
    const fill = JUMP_COLORS[h.material] || "#E0B06A";
    const hi = "rgba(255,255,255,0.45)";

    if (h.material === "hedge") {
      // Leafy bush silhouette — stacked lobes so it reads soft & crossable
      const lobes = [
        [h.w * 0.22, h.h * 0.55, h.w * 0.28],
        [h.w * 0.5, h.h * 0.42, h.w * 0.34],
        [h.w * 0.78, h.h * 0.55, h.w * 0.28],
        [h.w * 0.38, h.h * 0.72, h.w * 0.26],
        [h.w * 0.62, h.h * 0.72, h.w * 0.26],
      ];
      for (const [ox, oy, r] of lobes) {
        ctx.beginPath();
        ctx.ellipse(sx + ox, h.y + oy, r, r * 0.75, 0, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        rimCurrentPath();
      }
      // Base mound
      drawObstacleShape(sx + 2, h.y + h.h * 0.55, h.w - 4, h.h * 0.45, 6, fill, hi);
      // Leaf speckles
      ctx.fillStyle = "rgba(30,80,30,0.28)";
      for (let i = 0; i < h.w; i += 7) {
        ctx.beginPath();
        ctx.arc(sx + i + 3, h.y + 10 + (i % 14 === 0 ? 3 : 0), 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(200,240,180,0.35)";
      for (let i = 4; i < h.w; i += 11) {
        ctx.beginPath();
        ctx.arc(sx + i, h.y + 6, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (h.material === "fence") {
      // Pointed pickets + rail — unmistakably low & crossable
      const postW = 7;
      const gap = 11;
      for (let px = 0; px + postW <= h.w + 1; px += gap) {
        const x = sx + px;
        ctx.beginPath();
        ctx.moveTo(x, h.y + h.h);
        ctx.lineTo(x, h.y + 6);
        ctx.lineTo(x + postW / 2, h.y);
        ctx.lineTo(x + postW, h.y + 6);
        ctx.lineTo(x + postW, h.y + h.h);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(20,14,30,0.4)";
        ctx.stroke();
        ctx.strokeStyle = hi;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(x + 1.2, h.y + h.h - 2);
        ctx.lineTo(x + 1.2, h.y + 8);
        ctx.stroke();
      }
      // Horizontal rails
      drawObstacleShape(sx, h.y + h.h * 0.28, h.w, 4, 1, "#C99550", hi);
      drawObstacleShape(sx, h.y + h.h * 0.62, h.w, 4, 1, "#C99550", hi);
    } else if (h.material === "crate") {
      drawObstacleShape(sx, h.y, h.w, h.h, 3, fill, hi);
      // Plank boards
      ctx.strokeStyle = "rgba(60,30,12,0.35)";
      ctx.lineWidth = 1.2;
      for (let i = 1; i < 3; i++) {
        const py = h.y + (h.h / 3) * i;
        ctx.beginPath();
        ctx.moveTo(sx + 2, py);
        ctx.lineTo(sx + h.w - 2, py);
        ctx.stroke();
      }
      // X cross-boards
      ctx.strokeStyle = "rgba(40,20,8,0.45)";
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(sx + 3, h.y + 3);
      ctx.lineTo(sx + h.w - 3, h.y + h.h - 3);
      ctx.moveTo(sx + h.w - 3, h.y + 3);
      ctx.lineTo(sx + 3, h.y + h.h - 3);
      ctx.stroke();
      // Corner brackets
      ctx.strokeStyle = "rgba(255,230,200,0.35)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sx + 2, h.y + 2, h.w - 4, h.h - 4);
    } else {
      // Rounded rock / stone boulder — soft silhouette, mottled surface
      const cx = sx + h.w / 2;
      const cy = h.y + h.h * 0.55;
      const rx = h.w * 0.52;
      const ry = h.h * 0.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = "rgba(20,14,30,0.45)";
      ctx.stroke();
      // Light catch on upper-left
      ctx.beginPath();
      ctx.ellipse(cx - rx * 0.25, cy - ry * 0.35, rx * 0.35, ry * 0.22, -0.4, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,0.28)";
      ctx.fill();
      // Speckles
      ctx.fillStyle = "rgba(40,35,30,0.22)";
      for (let i = 0; i < 5; i++) {
        const ox = ((i * 17) % (h.w - 8)) - h.w / 2 + 4;
        const oy = ((i * 11) % (h.h - 8)) - h.h / 2 + 6;
        ctx.beginPath();
        ctx.arc(cx + ox * 0.35, cy + oy * 0.3, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawClimbable(c, viewL, viewR) {
    if (c.x + c.w < viewL || c.x > viewR) return;
    const sx = c.x - cameraX;
    // Darker / more textured than jump-overs so "climb this" reads instantly
    const MATERIAL_COLORS = { vine: "#3A6340", wood: "#7A4E2C", stone: "#5E5E6A" };
    const fill = MATERIAL_COLORS[c.material] || "#5E5E6A";

    if (c.material === "vine") {
      // Hanging vine curtain — organic strands + leaf clusters
      drawObstacleShape(sx, c.y, c.w, Math.min(10, c.h * 0.08), 3, "#2E4A32", "rgba(180,220,160,0.25)");
      const strands = 3;
      for (let si = 0; si < strands; si++) {
        const x0 = sx + 5 + si * ((c.w - 10) / Math.max(1, strands - 1));
        ctx.strokeStyle = si === 1 ? "#2E4E33" : "#456B4A";
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(x0, c.y + 6);
        for (let y = c.y + 14; y < c.y + c.h; y += 18) {
          const sway = Math.sin((y + si * 20) * 0.08) * 3;
          ctx.quadraticCurveTo(x0 + sway, y - 4, x0 - sway * 0.5, y);
        }
        ctx.stroke();
      }
      // Leaf clusters along strands
      ctx.fillStyle = "#5A8F5E";
      for (let y = c.y + 12; y < c.y + c.h - 4; y += 14) {
        const sway = Math.sin(y * 0.08) * 2;
        ctx.beginPath();
        ctx.ellipse(sx + c.w / 2 + sway, y, 5, 3.2, 0.3, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(sx + 6 + sway, y + 5, 3.2, 2.2, -0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(sx + c.w - 6 - sway, y + 5, 3.2, 2.2, 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
      // Outer rim so vines still separate from foliage backgrounds
      ctx.strokeStyle = "rgba(20,14,30,0.35)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(sx + 0.5, c.y + 0.5, c.w - 1, c.h - 1);
    } else if (c.material === "wood") {
      // Ladder: dark side rails + bright rungs — unmistakably climbable
      const railW = 5;
      drawObstacleShape(sx, c.y, railW, c.h, 2, fill, "rgba(255,230,200,0.25)");
      drawObstacleShape(sx + c.w - railW, c.y, railW, c.h, 2, fill, "rgba(255,230,200,0.25)");
      // Soft back panel so hitbox reads as a climbable column
      ctx.fillStyle = "rgba(90,60,35,0.25)";
      ctx.fillRect(sx + railW, c.y, c.w - railW * 2, c.h);
      for (let y = c.y + 8; y < c.y + c.h - 4; y += 13) {
        drawObstacleShape(sx + 2, y, c.w - 4, 4, 1.5, "#C99550", "rgba(255,245,220,0.55)");
      }
    } else {
      // Stone climbing wall — staggered bricks + carved handholds
      drawObstacleShape(sx, c.y, c.w, c.h, 3, fill, "rgba(255,255,255,0.22)");
      const brickH = 11;
      ctx.strokeStyle = "rgba(20,14,30,0.35)";
      ctx.lineWidth = 1;
      for (let row = 0, y = c.y + brickH; y < c.y + c.h; y += brickH, row++) {
        ctx.beginPath();
        ctx.moveTo(sx + 2, y);
        ctx.lineTo(sx + c.w - 2, y);
        ctx.stroke();
        const mid = sx + c.w / 2 + (row % 2 === 0 ? -3 : 3);
        ctx.beginPath();
        ctx.moveTo(mid, y);
        ctx.lineTo(mid, y - brickH);
        ctx.stroke();
      }
      // Handhold notches (recessed ovals catching light)
      for (let y = c.y + 16; y < c.y + c.h - 6; y += 22) {
        ctx.fillStyle = "rgba(10,10,16,0.35)";
        ctx.beginPath();
        ctx.ellipse(sx + c.w / 2, y, 5, 2.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.beginPath();
        ctx.ellipse(sx + c.w / 2 - 1, y - 1.2, 3.2, 1.2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawWorld() {
    const viewL = cameraX - 260;
    const viewR = cameraX + canvas.width + 260;

    world.scenery.forEach((s) => drawScenery(s, viewL, viewR));

    world.pits.forEach((pit) => {
      if (pit.x + pit.w < viewL || pit.x > viewR) return;
      ctx.fillStyle = "rgba(20, 14, 30, 0.5)";
      ctx.fillRect(pit.x - cameraX, GROUND_Y, pit.w, 80);
    });

    world.platforms.forEach((plat) => {
      if (plat.x + plat.w < viewL || plat.x > viewR) return;
      if (plat.type === "ground") {
        drawRoundedRect(plat.x - cameraX, plat.y, plat.w, 26, 4, "#8A7A5C");
        ctx.fillStyle = "#6f6248";
        ctx.fillRect(plat.x - cameraX, plat.y + 20, plat.w, 60);
      } else {
        drawObstacleShape(plat.x - cameraX, plat.y, plat.w, Math.min(plat.h, 24), 6, "#8F8F99", "rgba(255,255,255,0.3)");
      }
    });

    world.moving.forEach((m) => {
      if (m.x + m.w < viewL || m.x > viewR) return;
      drawObstacleShape(m.x - cameraX, m.y, m.w, m.h, 6, "#5FA6A3", "rgba(255,255,255,0.35)");
    });

    world.climbables.forEach((c) => drawClimbable(c, viewL, viewR));
    world.hazards.forEach((h) => drawHazard(h, viewL, viewR));

    world.collectibles.forEach((c) => {
      if (c.taken || c.x < viewL || c.x > viewR) return;
      ctx.beginPath();
      ctx.fillStyle = "#D4AF37";
      ctx.arc(c.x - cameraX, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    world.checkpoints.forEach((cp) => {
      if (cp.x < viewL || cp.x > viewR) return;
      ctx.fillStyle = cp.reached ? "#7FC7C4" : "#B9A9D6";
      ctx.fillRect(cp.x - cameraX, GROUND_Y - 70, 4, 70);
      ctx.beginPath();
      ctx.moveTo(cp.x - cameraX + 4, GROUND_Y - 70);
      ctx.lineTo(cp.x - cameraX + 28, GROUND_Y - 58);
      ctx.lineTo(cp.x - cameraX + 4, GROUND_Y - 46);
      ctx.fill();
    });
  }

  function drawRoyalty() {
    const gx = world.gateX - cameraX;
    drawCharacter(gx + 34, GROUND_Y - 48, "knight", { facing: 1, crown: true, trim: true, pose: "idle", phase: elapsedRun });
    drawCharacter(gx + 84, GROUND_Y - 48, "wanderer", { facing: -1, crown: true, trim: true, pose: "idle", phase: elapsedRun + 1 });
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const zone = zoneAt(player ? player.x : 0);
    const pal = zonePalette(zone.id);

    // Procedural parallax (far → mid → decor → near) before playable world
    drawSky(pal, zone.id);
    drawFarLayer(pal, zone.id, cameraX * PARALLAX.far);
    drawMidLayer(pal, zone.id, cameraX * PARALLAX.mid);
    drawCreatures(zone.id, elapsedRun);
    drawDecorLayer(pal, zone.id, cameraX * PARALLAX.decor);
    drawNearLayer(pal, zone.id, cameraX * PARALLAX.near);
    drawGroundWash(pal);
    drawParticles(zone.id, elapsedRun);

    drawWorld();

    if (state === "WIN" && winPhase >= 2) drawRoyalty();

    if (player) {
      const alpha = player.invuln > 0 && state !== "FAILED" ? 0.5 + 0.5 * Math.sin(elapsedRun * 20) : 1;
      ctx.globalAlpha = alpha;
      drawCharacter(player.x - cameraX, player.y, player.charId, {
        facing: player.facing,
        crouch: player.crouching,
        crown: player.hasCrown,
        trim: hasGoldenTrim,
        pose: currentPose(player),
        phase: player.animPhase,
      });
      ctx.globalAlpha = 1;
    }
  }

  function updateHUD() {
    const m = Math.floor(timeLeft / 60);
    const s = Math.floor(timeLeft % 60);
    hudTimer.textContent = `${m}:${String(s).padStart(2, "0")}`;
    const progress = Math.max(0, Math.min(1, player.x / WORLD_LENGTH));
    minimapDot.style.left = `${progress * 100}%`;
    zoneLabel.textContent = zoneAt(player.x).name;
  }

  /* ======================================================================== */
  /* Win / timeout                                                            */
  /* ======================================================================== */

  function beginWin() {
    state = "WIN";
    winPhase = 1;
    winTimer = 0;
    confettiSpawned = false;
    player.vx = 0;
    logEvent("win");
  }

  function updateWin(dt) {
    winTimer += dt;
    if (winPhase === 1) {
      player.x += 70 * dt;
      player.facing = 1;
      player.animPhase += dt * 4;
      if (winTimer > 2.2) {
        winPhase = 2;
        winTimer = 0;
        player.hasCrown = true;
      }
    } else if (winPhase === 2) {
      if (winTimer > 1.8) {
        winPhase = 3;
        showWinStats();
      }
    }
  }

  function showWinStats() {
    const used = RUN_SECONDS - timeLeft;
    const mm = Math.floor(used / 60);
    const ss = Math.floor(used % 60);
    const charName = CHARACTERS[selectedChar].name;
    winMsg.textContent = "The King and Queen welcome you to the Grand Castle!";
    winStats.innerHTML = `
      <li><span>Time</span><strong>${mm}:${String(ss).padStart(2, "0")}</strong></li>
      <li><span>Retries</span><strong>${retries}</strong></li>
      <li><span>Traveler</span><strong>${charName}</strong></li>
      <li><span>Unlock</span><strong>Golden trim</strong></li>
    `;
    hasGoldenTrim = true;
    localStorage.setItem(UNLOCK_KEY, "1");
    openOverlay(winOverlay);
    if (!confettiSpawned) {
      spawnConfetti();
      confettiSpawned = true;
    }
  }

  function spawnConfetti() {
    confettiEl.innerHTML = "";
    const colors = ["#7FC7C4", "#B9A9D6", "#E8B4B8", "#F5EFE3", "#D4AF37"];
    for (let i = 0; i < 28; i++) {
      const s = document.createElement("span");
      s.style.left = `${Math.random() * 100}%`;
      s.style.background = colors[i % colors.length];
      s.style.animationDelay = `${Math.random() * 0.6}s`;
      confettiEl.appendChild(s);
    }
  }

  function beginTimeout() {
    state = "TIMEOUT";
    logEvent("timeout");
    openOverlay(timeoutOverlay);
  }

  /* ======================================================================== */
  /* Game loop                                                                */
  /* ======================================================================== */

  const RENDERABLE_STATES = new Set(["PLAYING", "PAUSED", "FAILED", "WIN", "TIMEOUT"]);

  function loop(ts) {
    if (!lastTs) lastTs = ts;
    const dt = Math.min(0.033, (ts - lastTs) / 1000);
    lastTs = ts;

    if (state === "PLAYING") {
      elapsedRun += dt;
      timeLeft -= dt;
      if (timeLeft <= 0) {
        timeLeft = 0;
        beginTimeout();
      } else {
        updatePlayer(dt);
      }
      if (tooltipTimer > 0) {
        tooltipTimer -= dt;
        if (tooltipTimer <= 0) hideTooltip();
      }
      cameraX = Math.max(0, player.x - canvas.width * 0.28);
      updateHUD();
    } else if (state === "WIN") {
      updateWin(dt);
      cameraX = Math.max(0, player.x - canvas.width * 0.28);
    }
    // PAUSED / FAILED / TIMEOUT: loop skips simulation entirely — timer and
    // physics are frozen while their modal is open.

    if (RENDERABLE_STATES.has(state)) render();

    rafId = requestAnimationFrame(loop);
  }

  /* ======================================================================== */
  /* Screens / flow                                                          */
  /* ======================================================================== */

  function showScreen(name) {
    Object.values(screens).forEach((el) => {
      el.classList.add("hidden");
      el.setAttribute("aria-hidden", "true");
    });
    const el = screens[name];
    el.classList.remove("hidden");
    el.setAttribute("aria-hidden", "false");
  }

  function openOverlay(el) {
    el.classList.add("is-open");
    el.setAttribute("aria-hidden", "false");
  }

  function closeOverlays() {
    [failOverlay, pauseOverlay, winOverlay, timeoutOverlay].forEach((el) => {
      el.classList.remove("is-open");
      el.setAttribute("aria-hidden", "true");
    });
  }

  function startRun() {
    attemptNumber += 1;
    localStorage.setItem(ATTEMPT_KEY, String(attemptNumber));
    logEvent("character_selected", { character: selectedChar });

    world = buildWorld();
    player = makePlayer(selectedChar);
    cameraX = 0;
    timeLeft = RUN_SECONDS;
    elapsedRun = 0;
    retries = 0;
    speedMultiplier = 1;
    winPhase = 0;
    pendingCause = null;
    hints = { controlsFaded: false, jumpShown: false, climbShown: false, firstJumpSuccess: false };
    controlsHint.classList.remove("is-faded");
    controlsHint.setAttribute("aria-hidden", "false");
    hideTooltip();
    closeOverlays();
    hudRetries.textContent = "0";
    state = "PLAYING";
    showScreen("play");
    lastTs = 0;
    if (!rafId) rafId = requestAnimationFrame(loop);
  }

  function goMenu() {
    state = "MENU";
    closeOverlays();
    showScreen("menu");
    selectedChar = null;
    selectedTheme = "morning";
    btnPlay.disabled = true;
    document.querySelectorAll(".char-card").forEach((c) => c.classList.remove("is-selected"));
    document.querySelectorAll(".theme-card").forEach((c) => {
      const on = c.dataset.theme === "morning";
      c.classList.toggle("is-selected", on);
      c.setAttribute("aria-checked", on ? "true" : "false");
    });
  }

  /* ======================================================================== */
  /* Character select previews                                               */
  /* ======================================================================== */

  function paintPreviews() {
    document.querySelectorAll("[data-preview]").forEach((canvasEl) => {
      const id = canvasEl.dataset.preview;
      const pctx = canvasEl.getContext("2d");
      pctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
      drawMiniCharacter(pctx, 48, 78, id);
    });
  }

  /** Select-screen preview — same drawing path as gameplay (`drawCharacterOn`). */
  function drawMiniCharacter(pctx, px, py, charId) {
    // drawCharacterOn centers via translate(px + 14, py); subtract 14 so
    // callers can pass the visual center X the same way as before.
    drawCharacterOn(pctx, px - 14, py, charId, {
      facing: 1,
      pose: "idle",
      phase: 0,
      trim: hasGoldenTrim,
    });
  }

  /* ======================================================================== */
  /* Input                                                                    */
  /* ======================================================================== */

  const keyMap = {
    ArrowLeft: "left",
    ArrowRight: "right",
    ArrowUp: "up",
    ArrowDown: "down",
    " ": "space",
    a: "left",
    d: "right",
    w: "up",
    s: "down",
  };

  window.addEventListener("keydown", (e) => {
    const k = keyMap[e.key] || keyMap[e.key.toLowerCase()];
    if (k) {
      keys[k] = true;
      e.preventDefault();
    }
    if (e.key === "Escape" && state === "PLAYING") pauseGame();
    else if (e.key === "Escape" && state === "PAUSED") resumeGame();
  });

  window.addEventListener("keyup", (e) => {
    const k = keyMap[e.key] || keyMap[e.key.toLowerCase()];
    if (k) keys[k] = false;
  });

  canvas.addEventListener(
    "touchstart",
    (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      const rect = canvas.getBoundingClientRect();
      const x = (t.clientX - rect.left) / rect.width;
      const y = (t.clientY - rect.top) / rect.height;
      if (y < 0.35) keys.up = true;
      else if (y > 0.75) keys.down = true;
      else if (x < 0.35) keys.left = true;
      else keys.right = true;
    },
    { passive: false }
  );
  canvas.addEventListener("touchend", () => {
    keys.left = keys.right = keys.up = keys.down = keys.space = false;
  });

  function pauseGame() {
    if (state !== "PLAYING") return;
    state = "PAUSED";
    openOverlay(pauseOverlay);
  }

  function resumeGame() {
    if (state !== "PAUSED") return;
    state = "PLAYING";
    closeOverlays();
    lastTs = 0;
  }

  /* ======================================================================== */
  /* UI wiring                                                                */
  /* ======================================================================== */

  document.getElementById("btn-start").addEventListener("click", () => {
    state = "CHARACTER_SELECT";
    showScreen("select");
    paintPreviews();
  });

  document.getElementById("btn-back-menu").addEventListener("click", goMenu);

  document.querySelectorAll(".char-card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".char-card").forEach((c) => c.classList.remove("is-selected"));
      card.classList.add("is-selected");
      selectedChar = card.dataset.char;
      btnPlay.disabled = false;
    });
  });

  document.querySelectorAll(".theme-card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".theme-card").forEach((c) => {
        c.classList.remove("is-selected");
        c.setAttribute("aria-checked", "false");
      });
      card.classList.add("is-selected");
      card.setAttribute("aria-checked", "true");
      selectedTheme = card.dataset.theme === "night" ? "night" : "morning";
    });
  });

  btnPlay.addEventListener("click", () => {
    if (!selectedChar) return;
    const themeBtn = document.querySelector(".theme-card.is-selected");
    if (themeBtn) selectedTheme = themeBtn.dataset.theme === "night" ? "night" : "morning";
    startRun();
  });

  document.getElementById("btn-pause").addEventListener("click", pauseGame);
  document.getElementById("btn-resume").addEventListener("click", resumeGame);
  document.getElementById("btn-quit").addEventListener("click", () => {
    logEvent("retry", { note: "quit_to_menu" });
    goMenu();
  });

  // Fail modal — "Start Over" resumes from the last checkpoint; the timer and
  // game loop stayed frozen the entire time the modal was open.
  document.getElementById("btn-fail-restart").addEventListener("click", () => {
    logEvent("retry", { note: "start_over_after_fail" });
    respawnAtCheckpoint();
  });
  // "Get a Diamond" stays disabled — placeholder for a future reward/
  // monetization hook. No click handler needed while disabled.

  document.getElementById("btn-win-again").addEventListener("click", () => {
    logEvent("retry");
    startRun();
  });
  document.getElementById("btn-win-menu").addEventListener("click", goMenu);
  document.getElementById("btn-timeout-again").addEventListener("click", () => {
    logEvent("retry");
    startRun();
  });
  document.getElementById("btn-timeout-menu").addEventListener("click", goMenu);

  // Logical canvas size is fixed; CSS scales the element responsively.
  canvas.width = 960;
  canvas.height = 480;

  paintPreviews();
  showScreen("menu");
})();
