/**
 * Flow — hand-authored puzzle levels (Parts 1–3: levels 1–10).
 *
 * Each level:
 *   { id, name, rows, cols, par, tiles: [{ type, rotation, row, col, ... }, ...] }
 *   Optional: perfectTime (seconds) — Level 10 soft time-attack bonus only
 *
 * Optional tile fields:
 *   colorId       — source/target pair (0 pink, 1 teal, 2 gold); default 0
 *   locked        — pipe cannot rotate
 *   flowDirection — oneway only, e.g. "N-to-S" (allowed entry → exit)
 *   maxRotations  — per-tile click budget; locks when exhausted
 *
 * Source/target rotations set their single open side (not rotatable in play).
 * Pipe tiles ship with scrambled rotations unless locked on the solution.
 */
(function (global) {
  /** @type {Array<object>} */
  const FLOW_LEVELS = [
    /* ------------------------------------------------------------------ */
    /* Level 1 — 3×3, ~3 optimal moves                                    */
    /* Solution path: S(0,0)E → H(0,1) → C WS(0,2) → V(1,2) → T(2,2)N    */
    /* ------------------------------------------------------------------ */
    {
      id: 1,
      name: "Warm-up",
      rows: 3,
      cols: 3,
      par: 3,
      tiles: [
        { type: "source", rotation: 90, row: 0, col: 0 }, // east
        { type: "straight", rotation: 0, row: 0, col: 1 }, // needs 90 (1 move)
        { type: "curve", rotation: 0, row: 0, col: 2 }, // needs 180 (2 moves)
        { type: "straight", rotation: 0, row: 1, col: 2 }, // correct N–S
        { type: "target", rotation: 0, row: 2, col: 2 }, // north
      ],
    },

    /* ------------------------------------------------------------------ */
    /* Level 2 — 4×4 snake, straight/curve only                           */
    /* Solution: S(0,0)E → H → H → C↓ → C← → H → H → C↓ → C→ → H → H →  */
    /*           C↓ → T(3,3)N                                             */
    /* ------------------------------------------------------------------ */
    {
      id: 2,
      name: "Long Bend",
      rows: 4,
      cols: 4,
      par: 6,
      tiles: [
        { type: "source", rotation: 90, row: 0, col: 0 }, // east
        { type: "straight", rotation: 0, row: 0, col: 1 }, // needs 90
        { type: "straight", rotation: 90, row: 0, col: 2 }, // correct
        { type: "curve", rotation: 90, row: 0, col: 3 }, // needs 180 (W–S)
        { type: "curve", rotation: 180, row: 1, col: 3 }, // needs 270 (N–W)
        { type: "straight", rotation: 90, row: 1, col: 2 }, // correct
        { type: "straight", rotation: 0, row: 1, col: 1 }, // needs 90
        { type: "curve", rotation: 90, row: 1, col: 0 }, // correct (E–S)
        { type: "curve", rotation: 0, row: 2, col: 0 }, // correct (N–E)
        { type: "straight", rotation: 0, row: 2, col: 1 }, // needs 90
        { type: "straight", rotation: 90, row: 2, col: 2 }, // correct
        { type: "curve", rotation: 90, row: 2, col: 3 }, // needs 180 (W–S)
        { type: "target", rotation: 0, row: 3, col: 3 }, // north
      ],
    },

    /* ------------------------------------------------------------------ */
    /* Level 3 — 4×4 with one mandatory tjunction on the path             */
    /* Solution: S(0,0)E → H → H → C↓ → C← → Tj(NES) → C→ → C↓ → T(3,3)N */
    /* ------------------------------------------------------------------ */
    {
      id: 3,
      name: "Junction",
      rows: 4,
      cols: 4,
      par: 5,
      tiles: [
        { type: "source", rotation: 90, row: 0, col: 0 }, // east
        { type: "straight", rotation: 0, row: 0, col: 1 }, // needs 90
        { type: "straight", rotation: 90, row: 0, col: 2 }, // correct
        { type: "curve", rotation: 90, row: 0, col: 3 }, // needs 180 (W–S)
        { type: "curve", rotation: 180, row: 1, col: 3 }, // needs 270 (N–W)
        { type: "tjunction", rotation: 0, row: 1, col: 2 }, // needs 90 (N,E,S)
        { type: "curve", rotation: 270, row: 2, col: 2 }, // needs 0 (N–E)
        { type: "curve", rotation: 180, row: 2, col: 3 }, // correct (W–S)
        { type: "target", rotation: 0, row: 3, col: 3 }, // north
      ],
    },

    /* ------------------------------------------------------------------ */
    /* Level 4 — 5×5, two color pairs (paths physically separate)         */
    /* Pink 0: S(0,0)E → H → C↓ → Tj(NES) → T(2,2)N                       */
    /* Teal 1: S(4,0)E → H → H → C↑ → V → T(2,3)S                          */
    /* ------------------------------------------------------------------ */
    {
      id: 4,
      name: "Twin Streams",
      rows: 5,
      cols: 5,
      par: 8,
      tiles: [
        { type: "source", rotation: 90, row: 0, col: 0, colorId: 0 },
        { type: "straight", rotation: 0, row: 0, col: 1 }, // needs 90
        { type: "curve", rotation: 90, row: 0, col: 2 }, // needs 180 (W–S)
        { type: "tjunction", rotation: 0, row: 1, col: 2 }, // needs 90 (N,E,S)
        { type: "target", rotation: 0, row: 2, col: 2, colorId: 0 },

        { type: "source", rotation: 90, row: 4, col: 0, colorId: 1 },
        { type: "straight", rotation: 0, row: 4, col: 1 }, // needs 90
        { type: "straight", rotation: 0, row: 4, col: 2 }, // needs 90
        { type: "curve", rotation: 90, row: 4, col: 3 }, // needs 270 (W–N)
        { type: "straight", rotation: 90, row: 3, col: 3 }, // needs 0 (N–S)
        { type: "target", rotation: 180, row: 2, col: 3, colorId: 1 }, // south
      ],
    },

    /* ------------------------------------------------------------------ */
    /* Level 5 — 5×5, locked anchors on the solution path                 */
    /* S(0,0)E → H(locked@90) → C↓ → V(locked@0) → C→ → H → C↓ → V → T↑ */
    /* ------------------------------------------------------------------ */
    {
      id: 5,
      name: "Fixed Points",
      rows: 5,
      cols: 5,
      par: 6,
      tiles: [
        { type: "source", rotation: 90, row: 0, col: 0 },
        { type: "straight", rotation: 90, row: 0, col: 1, locked: true },
        { type: "curve", rotation: 0, row: 0, col: 2 }, // needs 180 (W–S)
        { type: "straight", rotation: 0, row: 1, col: 2, locked: true },
        { type: "curve", rotation: 180, row: 2, col: 2 }, // needs 0 (N–E)
        { type: "straight", rotation: 0, row: 2, col: 3 }, // needs 90
        { type: "curve", rotation: 90, row: 2, col: 4 }, // needs 180 (W–S)
        { type: "straight", rotation: 90, row: 3, col: 4 }, // needs 0
        { type: "target", rotation: 0, row: 4, col: 4 },
      ],
    },

    /* ------------------------------------------------------------------ */
    /* Level 6 — 6×6, oneway tiles                                        */
    /* S↓ → oneway N→S → V → C→ → oneway W→E → H → C↓ → V → T↑           */
    /* Scrambled oneways keep both ports open but reverse entry blocked.  */
    /* ------------------------------------------------------------------ */
    {
      id: 6,
      name: "One Way",
      rows: 6,
      cols: 6,
      par: 7,
      tiles: [
        { type: "source", rotation: 180, row: 0, col: 1 },
        {
          type: "oneway",
          rotation: 180,
          flowDirection: "S-to-N",
          row: 1,
          col: 1,
        }, // needs N-to-S
        { type: "straight", rotation: 90, row: 2, col: 1 }, // needs 0
        { type: "curve", rotation: 180, row: 3, col: 1 }, // needs 0 (N–E)
        {
          type: "oneway",
          rotation: 90,
          flowDirection: "E-to-W",
          row: 3,
          col: 2,
        }, // needs W-to-E
        { type: "straight", rotation: 0, row: 3, col: 3 }, // needs 90
        { type: "curve", rotation: 0, row: 3, col: 4 }, // needs 180 (W–S)
        { type: "straight", rotation: 90, row: 4, col: 4 }, // needs 0
        { type: "target", rotation: 0, row: 5, col: 4 },
      ],
    },

    /* ------------------------------------------------------------------ */
    /* Level 7 — 6×6, three color pairs (no locked / oneway)              */
    /* Pink 0:  S(0,0)E → H → C↓ → Tj(NES) → T(2,2)N                      */
    /* Teal 1:  S(0,5)S → V → C← → H → C↓ → V → T(4,3)N                   */
    /* Gold 2:  S(5,0)E → H → H → H → C↑ → V → C→ → T(3,5)W               */
    /* ------------------------------------------------------------------ */
    {
      id: 7,
      name: "Tricolor",
      rows: 6,
      cols: 6,
      par: 12,
      tiles: [
        // Color 0 — pink
        { type: "source", rotation: 90, row: 0, col: 0, colorId: 0 },
        { type: "straight", rotation: 0, row: 0, col: 1 }, // needs 90
        { type: "curve", rotation: 90, row: 0, col: 2 }, // needs 180 (W–S)
        { type: "tjunction", rotation: 0, row: 1, col: 2 }, // needs 90 (N,E,S)
        { type: "target", rotation: 0, row: 2, col: 2, colorId: 0 },

        // Color 1 — teal
        { type: "source", rotation: 180, row: 0, col: 5, colorId: 1 },
        { type: "straight", rotation: 90, row: 1, col: 5 }, // needs 0
        { type: "curve", rotation: 0, row: 2, col: 5 }, // needs 270 (N–W)
        { type: "straight", rotation: 0, row: 2, col: 4 }, // needs 90
        { type: "curve", rotation: 0, row: 2, col: 3 }, // needs 90 (E–S)
        { type: "straight", rotation: 90, row: 3, col: 3 }, // needs 0
        { type: "target", rotation: 0, row: 4, col: 3, colorId: 1 },

        // Color 2 — gold
        { type: "source", rotation: 90, row: 5, col: 0, colorId: 2 },
        { type: "straight", rotation: 0, row: 5, col: 1 }, // needs 90
        { type: "straight", rotation: 0, row: 5, col: 2 }, // needs 90
        { type: "straight", rotation: 0, row: 5, col: 3 }, // needs 90
        { type: "curve", rotation: 90, row: 5, col: 4 }, // needs 270 (W–N)
        { type: "straight", rotation: 90, row: 4, col: 4 }, // needs 0
        { type: "curve", rotation: 0, row: 3, col: 4 }, // needs 90 (E–S)
        { type: "target", rotation: 270, row: 3, col: 5, colorId: 2 },
      ],
    },

    /* ------------------------------------------------------------------ */
    /* Level 8 — 6×6, limited rotations (maxRotations)                    */
    /* Solution: S(0,0)E → H(max1) → C↓(max2) → V → Tj(NES,max1) → H →   */
    /*           C↓ → V → T(4,4)N                                         */
    /* Tight budgets: H needs 1, C needs 2, Tj needs 1 — no overshoot.    */
    /* ------------------------------------------------------------------ */
    {
      id: 8,
      name: "Budget Turns",
      rows: 6,
      cols: 6,
      par: 8,
      tiles: [
        { type: "source", rotation: 90, row: 0, col: 0 },
        {
          type: "straight",
          rotation: 0,
          row: 0,
          col: 1,
          maxRotations: 1,
        }, // needs 90
        {
          type: "curve",
          rotation: 0,
          row: 0,
          col: 2,
          maxRotations: 2,
        }, // needs 180 (W–S)
        { type: "straight", rotation: 0, row: 1, col: 2 }, // correct N–S
        {
          type: "tjunction",
          rotation: 0,
          row: 2,
          col: 2,
          maxRotations: 1,
        }, // needs 90 (N,E,S)
        { type: "straight", rotation: 0, row: 2, col: 3 }, // needs 90
        { type: "curve", rotation: 90, row: 2, col: 4 }, // needs 180 (W–S)
        { type: "straight", rotation: 0, row: 3, col: 4 }, // correct N–S
        { type: "target", rotation: 0, row: 4, col: 4 },
      ],
    },

    /* ------------------------------------------------------------------ */
    /* Level 9 — 7×7, two colors + locked + oneway                        */
    /* Pink 0: S(0,0)E → H → C↓ → V(locked@0) → C→ → oneway W→E → C↓ →   */
    /*         T(3,4)N                                                    */
    /* Teal 1: S(6,0)E → H → H → C↑ → V → C→(E–S) → H → T(4,5)W           */
    /* ------------------------------------------------------------------ */
    {
      id: 9,
      name: "Cross Current",
      rows: 7,
      cols: 7,
      par: 11,
      tiles: [
        // Color 0 — pink
        { type: "source", rotation: 90, row: 0, col: 0, colorId: 0 },
        { type: "straight", rotation: 0, row: 0, col: 1 }, // needs 90
        { type: "curve", rotation: 90, row: 0, col: 2 }, // needs 180 (W–S)
        {
          type: "straight",
          rotation: 0,
          row: 1,
          col: 2,
          locked: true,
        }, // N–S locked
        { type: "curve", rotation: 270, row: 2, col: 2 }, // needs 0 (N–E)
        {
          type: "oneway",
          rotation: 180,
          flowDirection: "S-to-N",
          row: 2,
          col: 3,
        }, // needs W-to-E (1 click)
        { type: "curve", rotation: 90, row: 2, col: 4 }, // needs 180 (W–S)
        { type: "target", rotation: 0, row: 3, col: 4, colorId: 0 },

        // Color 1 — teal
        { type: "source", rotation: 90, row: 6, col: 0, colorId: 1 },
        { type: "straight", rotation: 0, row: 6, col: 1 }, // needs 90
        { type: "straight", rotation: 0, row: 6, col: 2 }, // needs 90
        { type: "curve", rotation: 180, row: 6, col: 3 }, // needs 270 (W–N)
        { type: "straight", rotation: 0, row: 5, col: 3 }, // correct N–S
        { type: "curve", rotation: 0, row: 4, col: 3 }, // needs 90 (E–S)
        { type: "straight", rotation: 0, row: 4, col: 4 }, // needs 90
        { type: "target", rotation: 270, row: 4, col: 5, colorId: 1 },
      ],
    },

    /* ------------------------------------------------------------------ */
    /* Level 10 — 7×7 finale: 3 colors + locked + oneway + maxRotations   */
    /* Soft time attack: perfectTime 90s (bonus only, never fails).       */
    /* Pink 0: S(0,0)E → H(max1) → C↓ → V(locked@0) → C→ → oneway W→E →  */
    /*         C↓(max2) → T(3,4)N                                         */
    /* Teal 1: S(0,6)S → V → V → V → C← → H → C↓(E–S) → T(5,4)N           */
    /* Gold 2: S(6,0)E → H → H → C↑ → V → C←(W–S) → H → T(4,1)E           */
    /* ------------------------------------------------------------------ */
    {
      id: 10,
      name: "Grand Conduit",
      rows: 7,
      cols: 7,
      par: 16,
      perfectTime: 90,
      tiles: [
        // Color 0 — pink
        { type: "source", rotation: 90, row: 0, col: 0, colorId: 0 },
        {
          type: "straight",
          rotation: 0,
          row: 0,
          col: 1,
          maxRotations: 1,
        }, // needs 90
        { type: "curve", rotation: 90, row: 0, col: 2 }, // needs 180 (W–S)
        {
          type: "straight",
          rotation: 0,
          row: 1,
          col: 2,
          locked: true,
        },
        { type: "curve", rotation: 270, row: 2, col: 2 }, // needs 0 (N–E)
        {
          type: "oneway",
          rotation: 180,
          flowDirection: "S-to-N",
          row: 2,
          col: 3,
        }, // needs W-to-E (1 click)
        {
          type: "curve",
          rotation: 90,
          row: 2,
          col: 4,
          maxRotations: 2,
        }, // needs 180 (W–S)
        { type: "target", rotation: 0, row: 3, col: 4, colorId: 0 },

        // Color 1 — teal
        { type: "source", rotation: 180, row: 0, col: 6, colorId: 1 },
        { type: "straight", rotation: 90, row: 1, col: 6 }, // needs 0
        { type: "straight", rotation: 0, row: 2, col: 6 }, // correct
        { type: "straight", rotation: 0, row: 3, col: 6 }, // correct
        { type: "curve", rotation: 180, row: 4, col: 6 }, // needs 270 (N–W)
        { type: "straight", rotation: 0, row: 4, col: 5 }, // needs 90
        { type: "curve", rotation: 0, row: 4, col: 4 }, // needs 90 (E–S)
        { type: "target", rotation: 0, row: 5, col: 4, colorId: 1 },

        // Color 2 — gold
        { type: "source", rotation: 90, row: 6, col: 0, colorId: 2 },
        { type: "straight", rotation: 0, row: 6, col: 1 }, // needs 90
        { type: "straight", rotation: 0, row: 6, col: 2 }, // needs 90
        { type: "curve", rotation: 180, row: 6, col: 3 }, // needs 270 (W–N)
        { type: "straight", rotation: 0, row: 5, col: 3 }, // correct N–S
        { type: "curve", rotation: 90, row: 4, col: 3 }, // needs 180 (W–S)
        { type: "straight", rotation: 0, row: 4, col: 2 }, // needs 90
        { type: "target", rotation: 90, row: 4, col: 1, colorId: 2 }, // east
      ],
    },
  ];

  global.FLOW_LEVELS = FLOW_LEVELS;
})(typeof window !== "undefined" ? window : globalThis);
