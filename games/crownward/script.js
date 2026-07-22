/**
 * Crownward — side-scrolling walk/climb/jump path to the Grand Castle.
 * State machine: MENU → CHARACTER_SELECT → PLAYING → (PAUSED) → WIN | TIMEOUT
 *
 * Analytics buffer: localStorage key aracage-games-crownward-analytics
 * Unlock (golden trim): aracage-games-crownward-unlock
 */
(function () {
  "use strict";

  /* ======================================================================== */
  /* Constants                                                                */
  /* ======================================================================== */

  const RUN_SECONDS = 30 * 60; // 30:00 countdown
  const WORLD_LENGTH = 52000; // ~5–12 min depending on pace / deaths
  const GROUND_Y = 400;
  const GRAVITY = 1800;
  const BASE_WALK = 165;
  const SPRINT_BONUS = 1.35;
  const JUMP_V = -520;
  const CLIMB_SPEED = 140;
  const DEATH_PENALTY = 10; // seconds removed from remaining time
  const ANALYTICS_KEY = "aracage-games-crownward-analytics";
  const UNLOCK_KEY = "aracage-games-crownward-unlock";
  const ATTEMPT_KEY = "aracage-games-crownward-attempt";

  const CHARACTERS = {
    knight: {
      id: "knight",
      name: "Knight",
      walkMul: 1.0,
      jumpMul: 1.0,
      colors: { body: "#B9A9D6", accent: "#3A3159", trim: "#F5EFE3" },
    },
    wanderer: {
      id: "wanderer",
      name: "Wanderer",
      walkMul: 1.08,
      jumpMul: 0.92,
      colors: { body: "#7FC7C4", accent: "#3A3159", trim: "#E8B4B8" },
    },
    fox: {
      id: "fox",
      name: "Fox Cub",
      walkMul: 1.1,
      jumpMul: 1.08,
      colors: { body: "#E8B4B8", accent: "#3A3159", trim: "#F5EFE3" },
    },
  };

  const ZONE_DEFS = [
    { id: "village", name: "Village", start: 0, end: 0.25 },
    { id: "outer_castle", name: "Outer Castle", start: 0.25, end: 0.5 },
    { id: "mid_castle", name: "Mid Castle", start: 0.5, end: 0.8 },
    { id: "grand_castle", name: "Grand Castle", start: 0.8, end: 1 },
  ];

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

  /** @type {'MENU'|'CHARACTER_SELECT'|'PLAYING'|'PAUSED'|'WIN'|'TIMEOUT'} */
  let state = "MENU";
  let selectedChar = null;
  let hasGoldenTrim = localStorage.getItem(UNLOCK_KEY) === "1";
  let attemptNumber = Number(localStorage.getItem(ATTEMPT_KEY) || 0);

  const keys = {
    left: false,
    right: false,
    up: false,
    down: false,
    space: false,
  };

  let world = null;
  let player = null;
  let cameraX = 0;
  let timeLeft = RUN_SECONDS;
  let elapsedRun = 0;
  let retries = 0;
  let lastTs = 0;
  let rafId = 0;
  let speedMultiplier = 1;

  let hints = {
    controlsShown: true,
    controlsFaded: false,
    jumpShown: false,
    jumpDone: false,
    climbShown: false,
    climbDone: false,
    firstJumpSuccess: false,
  };
  let tooltipTimer = 0;
  let tooltipText = "";

  let winPhase = 0; // 0 play, 1 walk-in, 2 royalty, 3 stats
  let winTimer = 0;
  let confettiSpawned = false;

  /* ======================================================================== */
  /* Analytics                                                                */
  /* ======================================================================== */

  function zoneAt(x) {
    const p = Math.max(0, Math.min(1, x / WORLD_LENGTH));
    for (let i = ZONE_DEFS.length - 1; i >= 0; i--) {
      if (p >= ZONE_DEFS[i].start) return ZONE_DEFS[i];
    }
    return ZONE_DEFS[0];
  }

  function logEvent(event, extra = {}) {
    const payload = {
      event,
      timestamp: Math.floor(elapsedRun),
      zone: zoneAt(player ? player.x : 0).id,
      positionX: player ? Math.round(player.x) : 0,
      causeOfDeath: null,
      character: selectedChar || null,
      attemptNumber,
      ...extra,
    };
    try {
      const buf = JSON.parse(localStorage.getItem(ANALYTICS_KEY) || "[]");
      buf.push(payload);
      // Keep last 200 events
      localStorage.setItem(ANALYTICS_KEY, JSON.stringify(buf.slice(-200)));
    } catch (_) {
      /* ignore quota */
    }
    // Hook for a future backend:
    // if (window.CROWNWARD_ANALYTICS_ENDPOINT) fetch(...)
  }

  /* ======================================================================== */
  /* World generation                                                         */
  /* ======================================================================== */

  function seededRand(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

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

    // Continuous ground segments interrupted by pits
    let x = 0;
    platforms.push({ x: -200, y: GROUND_Y, w: 900, h: 80, type: "ground" });

    function addGround(from, to) {
      platforms.push({ x: from, y: GROUND_Y, w: to - from, h: 80, type: "ground" });
    }

    // Zone-based obstacle placement
    ZONE_DEFS.forEach((zone, zi) => {
      const z0 = zone.start * WORLD_LENGTH;
      const z1 = zone.end * WORLD_LENGTH;
      const mid = (z0 + z1) / 2;

      checkpoints.push({ x: z0 + 80, y: GROUND_Y, zone: zone.id, id: `${zone.id}-start` });
      checkpoints.push({ x: mid, y: GROUND_Y, zone: zone.id, id: `${zone.id}-mid` });

      // Scenery density by zone
      const houseCount = zi === 0 ? 14 : zi === 1 ? 6 : zi === 2 ? 3 : 1;
      for (let i = 0; i < houseCount; i++) {
        const hx = z0 + 200 + rand() * (z1 - z0 - 400);
        const scale = zi === 0 ? 0.7 + rand() * 0.4 : zi === 3 ? 2.2 : 1 + zi * 0.35;
        scenery.push({
          type: zi === 0 ? "house" : "castle",
          x: hx,
          scale,
          tier: zi,
        });
      }

      // Segment obstacles along the zone
      let cursor = z0 + 500;
      while (cursor < z1 - 600) {
        const roll = rand();
        const density = 0.55 + zi * 0.12;

        if (roll < 0.18 * density) {
          // Pit — gap in the ground, then a landing pad
          const gap = 70 + zi * 25 + rand() * (40 + zi * 20);
          const run = 180 + rand() * 220;
          const landW = 160 + rand() * 100;
          addGround(x, cursor);
          pits.push({ x: cursor, w: gap });
          const landY = GROUND_Y - (zi >= 2 && rand() < 0.35 ? 36 : 0);
          platforms.push({
            x: cursor + gap,
            y: landY,
            w: landW,
            h: 22,
            type: "platform",
          });
          x = cursor + gap + landW;
          cursor = x + run;
        } else if (roll < 0.38 * density) {
          // Low obstacle (duck)
          hazards.push({
            x: cursor,
            y: GROUND_Y - 38,
            w: 70 + rand() * 40,
            h: 38,
            type: "low",
          });
          cursor += 220 + rand() * 180;
        } else if (roll < 0.58 * density) {
          // Jump block / fence
          hazards.push({
            x: cursor,
            y: GROUND_Y - (48 + zi * 8),
            w: 36 + rand() * 20,
            h: 48 + zi * 8,
            type: "block",
          });
          cursor += 200 + rand() * 160;
        } else if (roll < 0.78 * density) {
          // Climbable wall / ladder
          const h = 90 + zi * 40 + rand() * 50;
          climbables.push({
            x: cursor,
            y: GROUND_Y - h,
            w: 28,
            h,
            type: "ladder",
          });
          platforms.push({
            x: cursor - 20,
            y: GROUND_Y - h,
            w: 100 + rand() * 60,
            h: 18,
            type: "platform",
          });
          cursor += 280 + rand() * 200;
        } else if (zi >= 2 && roll < 0.9) {
          // Moving platform (mid / grand)
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
          cursor += 160 + rand() * 120;
        }

        // Occasional floating collectible
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

    // Fill remaining ground to end
    addGround(x, WORLD_LENGTH + 400);

    // Final gate
    const gateX = WORLD_LENGTH - 180;
    scenery.push({ type: "grand_gate", x: gateX, scale: 1 });
    platforms.push({ x: WORLD_LENGTH - 400, y: GROUND_Y, w: 800, h: 80, type: "ground" });

    // Mark first jump & climb for tutorials
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
    };
  }

  function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function playerBox(p) {
    const h = p.crouching ? p.h * 0.55 : p.h;
    const y = p.crouching ? p.y + p.h - h : p.y;
    return { x: p.x, y, w: p.w, h };
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

    // Moving platforms animate
    world.moving.forEach((m) => {
      m._prevX = m.x;
      m.x = m.ox + Math.sin(elapsedRun * (m.speed / 40) + m.phase) * m.range;
    });

    const wantJump = keys.up || keys.space;
    p.crouching = keys.down && p.onGround && !p.climbing;
    const boxH = p.crouching ? p.h * 0.55 : p.h;

    // Climb detection
    const nearClimb = world.climbables.find((c) => {
      const expanded = { x: c.x - 8, y: c.y, w: c.w + 16, h: c.h };
      return aabb(playerBox(p), expanded);
    });

    if (nearClimb && wantJump && !keys.down) {
      p.climbing = true;
      p.vy = 0;
      p.vx = 0;
      p.x = nearClimb.x + nearClimb.w / 2 - p.w / 2;
      if (keys.up || keys.space) {
        p.y -= CLIMB_SPEED * dt;
        if (!hints.climbDone) {
          hints.climbDone = true;
          hideTooltip();
          logEvent("collectible_interacted", { note: "first_climb" });
        }
      }
      if (keys.down) p.y += CLIMB_SPEED * dt;
      // Stay within climb bounds
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
      // Horizontal
      let move = 0;
      if (keys.right) move += 1;
      if (keys.left) move -= 1;
      const sprint = keys.right && !keys.left ? SPRINT_BONUS : 1;
      // Gentle auto-walk forward when no left input
      const auto = keys.left ? 0 : 0.35;
      const dir = move !== 0 ? move : auto;
      if (move !== 0) p.facing = move > 0 ? 1 : -1;

      const speed =
        BASE_WALK * p.walkMul * speedMultiplier * (move !== 0 ? sprint : 1) * (p.crouching ? 0.55 : 1);
      p.vx = dir * speed;

      // Jump
      if (wantJump && p.onGround && !p.crouching) {
        p.vy = JUMP_V * p.jumpMul;
        p.onGround = false;
        if (!hints.firstJumpSuccess) {
          hints.firstJumpSuccess = true;
          hints.jumpDone = true;
          hideTooltip();
          fadeControlsHint();
        }
      }

      p.vy += GRAVITY * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    // Clamp left
    if (p.x < 40) p.x = 40;

    // Platform collisions
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
      // Land on top
      if (p.vy >= 0 && prevBottom <= plat.y + 8) {
        p.y = plat.y - p.h;
        p.vy = 0;
        p.onGround = true;
        if (plat.type === "moving" && plat.ref) {
          p.x += plat.x - plat.prevX;
        }
      } else if (p.vy < 0 && p.y < plat.y + plat.h && p.y + p.h > plat.y + plat.h) {
        // Hit head
        p.y = plat.y + plat.h;
        p.vy = 0;
      }
    });

    // Hazards
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

    // Pits
    for (const pit of world.pits) {
      if (p.x + p.w > pit.x + 8 && p.x < pit.x + pit.w - 8 && p.y + p.h > GROUND_Y + 10) {
        die("pit");
        return;
      }
    }
    if (p.y > GROUND_Y + 120) {
      die("pit");
      return;
    }

    // Checkpoints
    world.checkpoints.forEach((cp) => {
      if (!cp.reached && Math.abs(p.x - cp.x) < 40 && Math.abs(p.y - (GROUND_Y - 40)) < 80) {
        cp.reached = true;
        world.lastCheckpoint = { x: cp.x, y: GROUND_Y - p.h };
        logEvent("checkpoint_reached", { checkpointId: cp.id });
      }
    });

    // Collectibles
    world.collectibles.forEach((c) => {
      if (c.taken) return;
      const dx = p.x + p.w / 2 - c.x;
      const dy = p.y + p.h / 2 - c.y;
      if (dx * dx + dy * dy < (c.r + 16) * (c.r + 16)) {
        c.taken = true;
        logEvent("collectible_interacted", { collectibleId: c.id });
      }
    });

    // Tutorials proximity
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

    // Fade controls after 60s or first jump
    if (hints.controlsShown && !hints.controlsFaded) {
      if (elapsedRun >= 60 || hints.firstJumpSuccess) fadeControlsHint();
    }

    // Win gate
    if (p.x >= world.gateX - 20 && state === "PLAYING") {
      beginWin();
    }
  }

  function die(cause) {
    retries += 1;
    hudRetries.textContent = String(retries);
    timeLeft = Math.max(0, timeLeft - DEATH_PENALTY);
    logEvent("death", { causeOfDeath: cause });
    const cp = world.lastCheckpoint;
    player.x = cp.x;
    player.y = cp.y;
    player.vx = 0;
    player.vy = 0;
    player.climbing = false;
    player.invuln = 1.2;
  }

  /* ======================================================================== */
  /* Tooltips / hints                                                         */
  /* ======================================================================== */

  function showTooltip(text, seconds) {
    tooltipText = text;
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
  /* Rendering                                                                */
  /* ======================================================================== */

  function drawRoundedRect(x, y, w, h, r, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
  }

  function drawCharacter(px, py, charId, facing, crouch, crown, trim) {
    const c = CHARACTERS[charId];
    const colors = c.colors;
    ctx.save();
    ctx.translate(px + 14, py);
    if (facing < 0) ctx.scale(-1, 1);

    const bodyH = crouch ? 28 : 40;
    const bodyY = crouch ? 20 : 8;

    // Body
    drawRoundedRect(-12, bodyY, 24, bodyH, 8, colors.body);
    // Head
    ctx.beginPath();
    ctx.fillStyle = colors.trim;
    ctx.arc(0, bodyY - 2, 11, 0, Math.PI * 2);
    ctx.fill();
    // Eyes
    ctx.fillStyle = colors.accent;
    ctx.beginPath();
    ctx.arc(3, bodyY - 3, 2, 0, Math.PI * 2);
    ctx.arc(8, bodyY - 3, 2, 0, Math.PI * 2);
    ctx.fill();

    if (charId === "fox") {
      // Ears
      ctx.fillStyle = colors.body;
      ctx.beginPath();
      ctx.moveTo(-8, bodyY - 10);
      ctx.lineTo(-2, bodyY - 20);
      ctx.lineTo(2, bodyY - 10);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(4, bodyY - 10);
      ctx.lineTo(10, bodyY - 20);
      ctx.lineTo(12, bodyY - 8);
      ctx.fill();
    }
    if (charId === "knight") {
      // Tiny helmet brim
      drawRoundedRect(-13, bodyY - 8, 26, 6, 2, colors.accent);
    }
    if (trim || hasGoldenTrim) {
      ctx.strokeStyle = "#D4AF37";
      ctx.lineWidth = 2;
      ctx.strokeRect(-12, bodyY, 24, bodyH);
    }
    if (crown) {
      ctx.fillStyle = "#D4AF37";
      ctx.beginPath();
      ctx.moveTo(-8, bodyY - 14);
      ctx.lineTo(-4, bodyY - 22);
      ctx.lineTo(0, bodyY - 14);
      ctx.lineTo(4, bodyY - 22);
      ctx.lineTo(8, bodyY - 14);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawWorld() {
    const viewL = cameraX - 40;
    const viewR = cameraX + canvas.width + 40;

    // Parallax hills
    ctx.fillStyle = "rgba(127, 199, 196, 0.35)";
    for (let i = 0; i < 8; i++) {
      const hx = ((i * 280 - cameraX * 0.3) % (canvas.width + 300)) - 50;
      ctx.beginPath();
      ctx.ellipse(hx, GROUND_Y - 40, 160, 50, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // Scenery
    world.scenery.forEach((s) => {
      if (s.x < viewL - 200 || s.x > viewR + 200) return;
      const sx = s.x - cameraX;
      if (s.type === "house") {
        const w = 50 * s.scale;
        const h = 45 * s.scale;
        drawRoundedRect(sx, GROUND_Y - h, w, h, 6, "#E8B4B8");
        ctx.fillStyle = "#3A3159";
        ctx.beginPath();
        ctx.moveTo(sx - 6, GROUND_Y - h);
        ctx.lineTo(sx + w / 2, GROUND_Y - h - 22 * s.scale);
        ctx.lineTo(sx + w + 6, GROUND_Y - h);
        ctx.fill();
      } else if (s.type === "castle") {
        const w = 70 * s.scale;
        const h = 70 * s.scale;
        const fills = ["#B9A9D6", "#7FC7C4", "#9a93b0", "#3A3159"];
        drawRoundedRect(sx, GROUND_Y - h, w, h, 4, fills[Math.min(s.tier, 3)]);
        // Battlements
        for (let i = 0; i < 4; i++) {
          drawRoundedRect(sx + i * (w / 4) + 2, GROUND_Y - h - 12, w / 5, 14, 2, fills[Math.min(s.tier, 3)]);
        }
      } else if (s.type === "grand_gate") {
        drawRoundedRect(sx, GROUND_Y - 160, 120, 160, 8, "#3A3159");
        drawRoundedRect(sx + 25, GROUND_Y - 90, 70, 90, 35, "#F5EFE3");
        // Crown on top
        ctx.fillStyle = "#D4AF37";
        ctx.beginPath();
        ctx.moveTo(sx + 40, GROUND_Y - 170);
        ctx.lineTo(sx + 50, GROUND_Y - 190);
        ctx.lineTo(sx + 60, GROUND_Y - 170);
        ctx.lineTo(sx + 70, GROUND_Y - 190);
        ctx.lineTo(sx + 80, GROUND_Y - 170);
        ctx.fill();
      }
    });

    // Pits (dark wells)
    world.pits.forEach((pit) => {
      if (pit.x + pit.w < viewL || pit.x > viewR) return;
      ctx.fillStyle = "rgba(58, 49, 89, 0.35)";
      ctx.fillRect(pit.x - cameraX, GROUND_Y, pit.w, 80);
    });

    // Platforms
    world.platforms.forEach((plat) => {
      if (plat.x + plat.w < viewL || plat.x > viewR) return;
      const color = plat.type === "ground" ? "#c4b69a" : "#B9A9D6";
      drawRoundedRect(plat.x - cameraX, plat.y, plat.w, Math.min(plat.h, 28), 6, color);
      if (plat.type === "ground") {
        ctx.fillStyle = "#a89478";
        ctx.fillRect(plat.x - cameraX, plat.y + 18, plat.w, 62);
      }
    });

    world.moving.forEach((m) => {
      if (m.x + m.w < viewL || m.x > viewR) return;
      drawRoundedRect(m.x - cameraX, m.y, m.w, m.h, 6, "#7FC7C4");
    });

    // Climbables
    world.climbables.forEach((c) => {
      if (c.x + c.w < viewL || c.x > viewR) return;
      drawRoundedRect(c.x - cameraX, c.y, c.w, c.h, 4, "#7FC7C4");
      ctx.strokeStyle = "rgba(58, 49, 89, 0.25)";
      ctx.lineWidth = 2;
      for (let y = c.y + 10; y < c.y + c.h; y += 14) {
        ctx.beginPath();
        ctx.moveTo(c.x - cameraX + 4, y);
        ctx.lineTo(c.x - cameraX + c.w - 4, y);
        ctx.stroke();
      }
    });

    // Hazards
    world.hazards.forEach((h) => {
      if (h.x + h.w < viewL || h.x > viewR) return;
      const col = h.type === "low" ? "#E8B4B8" : "#3A3159";
      drawRoundedRect(h.x - cameraX, h.y, h.w, h.h, 5, col);
    });

    // Collectibles
    world.collectibles.forEach((c) => {
      if (c.taken) return;
      if (c.x < viewL || c.x > viewR) return;
      ctx.beginPath();
      ctx.fillStyle = "#D4AF37";
      ctx.arc(c.x - cameraX, c.y, c.r, 0, Math.PI * 2);
      ctx.fill();
    });

    // Checkpoint flags
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
    // King & Queen near gate during win
    const gx = world.gateX - cameraX;
    drawCharacter(gx + 40, GROUND_Y - 48, "knight", 1, false, true, true);
    drawCharacter(gx + 80, GROUND_Y - 48, "wanderer", -1, false, true, true);
  }

  function render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Sky gradient already via CSS; soft clouds
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    for (let i = 0; i < 5; i++) {
      const cx = ((i * 220 - cameraX * 0.15) % (canvas.width + 200)) - 40;
      ctx.beginPath();
      ctx.ellipse(cx, 70 + (i % 3) * 20, 60, 22, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    drawWorld();

    if (state === "WIN" && winPhase >= 2) drawRoyalty();

    if (player) {
      const alpha = player.invuln > 0 ? 0.5 + 0.5 * Math.sin(elapsedRun * 20) : 1;
      ctx.globalAlpha = alpha;
      drawCharacter(
        player.x - cameraX,
        player.y,
        player.charId,
        player.facing,
        player.crouching,
        player.hasCrown,
        hasGoldenTrim
      );
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
  /* Win / timeout                                                             */
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
      // Auto-walk into gate
      player.x += 70 * dt;
      player.facing = 1;
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
      cameraX = player.x - canvas.width * 0.28;
      if (cameraX < 0) cameraX = 0;
      updateHUD();
    } else if (state === "WIN") {
      updateWin(dt);
      cameraX = player.x - canvas.width * 0.28;
    }

    if (state === "PLAYING" || state === "PAUSED" || state === "WIN" || state === "TIMEOUT") {
      render();
    }

    rafId = requestAnimationFrame(loop);
  }

  /* ======================================================================== */
  /* Screens / flow                                                           */
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
    [pauseOverlay, winOverlay, timeoutOverlay].forEach((el) => {
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
    hints = {
      controlsShown: true,
      controlsFaded: false,
      jumpShown: false,
      jumpDone: false,
      climbShown: false,
      climbDone: false,
      firstJumpSuccess: false,
    };
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
    btnPlay.disabled = true;
    document.querySelectorAll(".char-card").forEach((c) => c.classList.remove("is-selected"));
  }

  /* ======================================================================== */
  /* Character previews                                                       */
  /* ======================================================================== */

  function paintPreviews() {
    document.querySelectorAll("[data-preview]").forEach((c) => {
      const id = c.dataset.preview;
      const pctx = c.getContext("2d");
      pctx.clearRect(0, 0, c.width, c.height);
      // Temporary swap global ctx — draw into preview by reusing logic inline
      const prev = { ctx };
      // Simple inline draw
      const colors = CHARACTERS[id].colors;
      pctx.fillStyle = colors.body;
      roundRect(pctx, 36, 40, 24, 40, 8);
      pctx.fill();
      pctx.fillStyle = colors.trim;
      pctx.beginPath();
      pctx.arc(48, 34, 12, 0, Math.PI * 2);
      pctx.fill();
      pctx.fillStyle = colors.accent;
      pctx.beginPath();
      pctx.arc(52, 33, 2, 0, Math.PI * 2);
      pctx.arc(57, 33, 2, 0, Math.PI * 2);
      pctx.fill();
      if (id === "fox") {
        pctx.fillStyle = colors.body;
        pctx.beginPath();
        pctx.moveTo(38, 26);
        pctx.lineTo(42, 14);
        pctx.lineTo(46, 26);
        pctx.fill();
        pctx.beginPath();
        pctx.moveTo(50, 26);
        pctx.lineTo(56, 14);
        pctx.lineTo(58, 28);
        pctx.fill();
      }
      if (id === "knight") {
        pctx.fillStyle = colors.accent;
        roundRect(pctx, 34, 26, 28, 7, 2);
        pctx.fill();
      }
      if (hasGoldenTrim) {
        pctx.strokeStyle = "#D4AF37";
        pctx.lineWidth = 2;
        pctx.strokeRect(36, 40, 24, 40);
      }
      void prev;
    });
  }

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
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

  // Simple touch buttons via canvas edges (optional light support)
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

  btnPlay.addEventListener("click", () => {
    if (!selectedChar) return;
    startRun();
  });

  document.getElementById("btn-pause").addEventListener("click", pauseGame);
  document.getElementById("btn-resume").addEventListener("click", resumeGame);
  document.getElementById("btn-quit").addEventListener("click", () => {
    logEvent("retry", { note: "quit_to_menu" });
    goMenu();
  });

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
