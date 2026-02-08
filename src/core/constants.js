export const CELL = Object.freeze({
  FLOOR: "Floor",
  SOLID: "SolidWall",
  SOFT: "SoftWall",
  VOID: "Void"
});

export const ITEM = Object.freeze({
  FIRE_UP: "FireUp",
  BOOTS: "Boots",
  KICK: "Kick"
});

export const PLAYER = Object.freeze({
  P1: "P1",
  P2: "P2"
});

export const STATUS = Object.freeze({
  ONGOING: "ongoing",
  P1_WIN: "p1_win",
  P2_WIN: "p2_win",
  DRAW: "draw"
});

export const DIRECTIONS = Object.freeze({
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
});

export const DEFAULT_SIZE = 7;
export const ITEM_DROP_RATE = 0.3;
export const ITEM_MAX_ON_BOARD = 3;
