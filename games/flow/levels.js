/**
 * Flow — hand-authored puzzle levels (Part 1: 1–3 playable; 4–10 reserved).
 *
 * Each level:
 *   { id, name, rows, cols, par, tiles: [{ type, rotation, row, col }, ...] }
 *
 * Source/target rotations set their single open side (not rotatable in play).
 * Pipe tiles ship with scrambled rotations; solution notes are comments only.
 */
(function (global) {
  /** @type {Array<{id:number,name:string,rows:number,cols:number,par:number,tiles:Array<{type:string,rotation:number,row:number,col:number}>}>} */
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
    /* Solution:                                                          */
    /*   S→H→H→C↓ →C←H←H←C↓ →C→H→H→C↓ →T↑                               */
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
    /* Solution: S→H→H→C↓ →C← →T(NES)↓ →C→ →C↓ →T↑                       */
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
  ];

  global.FLOW_LEVELS = FLOW_LEVELS;
})(typeof window !== "undefined" ? window : globalThis);
