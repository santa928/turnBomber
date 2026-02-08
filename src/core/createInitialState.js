import {
  CELL,
  DEFAULT_SIZE,
  ITEM,
  STATUS,
  PLAYER
} from "./constants.js";

function nextSeed(seed) {
  return (seed * 1664525 + 1013904223) >>> 0;
}

function nextRandom(seed) {
  const valueSeed = nextSeed(seed >>> 0);
  return { seed: valueSeed, value: valueSeed / 0x100000000 };
}

function createEmptyBoard(size) {
  return Array.from({ length: size }, () =>
    Array.from({ length: size }, () => CELL.FLOOR)
  );
}

function carveSolidWalls(board) {
  const size = board.length;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const isBorder = x === 0 || y === 0 || x === size - 1 || y === size - 1;
      const isGrid = x % 2 === 0 && y % 2 === 0;
      if (isBorder || isGrid) {
        board[y][x] = CELL.SOLID;
      }
    }
  }
}

function clearSpawnCorridors(board, spawn) {
  const size = board.length;
  const cells = [
    [spawn.x, spawn.y],
    [spawn.x + 1, spawn.y],
    [spawn.x - 1, spawn.y],
    [spawn.x, spawn.y + 1],
    [spawn.x, spawn.y - 1]
  ];
  for (const [x, y] of cells) {
    if (x >= 0 && x < size && y >= 0 && y < size) {
      board[y][x] = CELL.FLOOR;
    }
  }
}

function placeSoftWalls(board, seed, softWallRatio) {
  const size = board.length;
  let currentSeed = seed >>> 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (board[y][x] !== CELL.FLOOR) {
        continue;
      }
      const { seed: randomSeed, value } = nextRandom(currentSeed);
      currentSeed = randomSeed;
      if (value < softWallRatio) {
        board[y][x] = CELL.SOFT;
      }
    }
  }
  return currentSeed;
}

function createPlayer(id, x, y) {
  return {
    id,
    x,
    y,
    alive: true,
    firePower: 1,
    kick: false,
    bootsTurns: 0,
    apStart: 0,
    apEnd: 0,
    apPenaltyNext: false
  };
}

export function createInitialState(options = {}) {
  const size = options.size ?? DEFAULT_SIZE;
  const initialSeed = (options.seed ?? 0x1f2e3d4c) >>> 0;
  const softWallRatio = options.softWallRatio ?? 0.45;
  const board = createEmptyBoard(size);
  carveSolidWalls(board);

  const p1Spawn = options.p1Spawn ?? { x: 1, y: 1 };
  const p2Spawn = options.p2Spawn ?? { x: size - 2, y: size - 2 };
  clearSpawnCorridors(board, p1Spawn);
  clearSpawnCorridors(board, p2Spawn);

  const seededAfterSoft = placeSoftWalls(board, initialSeed, softWallRatio);
  clearSpawnCorridors(board, p1Spawn);
  clearSpawnCorridors(board, p2Spawn);
  board[p1Spawn.y][p1Spawn.x] = CELL.FLOOR;
  board[p2Spawn.y][p2Spawn.x] = CELL.FLOOR;

  return {
    turn: 1,
    size,
    board,
    players: {
      [PLAYER.P1]: createPlayer(PLAYER.P1, p1Spawn.x, p1Spawn.y),
      [PLAYER.P2]: createPlayer(PLAYER.P2, p2Spawn.x, p2Spawn.y)
    },
    bombs: [],
    items: [],
    status: STATUS.ONGOING,
    rng: seededAfterSoft,
    nextBombId: 1,
    nextItemId: 1
  };
}

export function createFloorState(options = {}) {
  const size = options.size ?? DEFAULT_SIZE;
  const board = createEmptyBoard(size);
  const p1Spawn = options.p1Spawn ?? { x: 1, y: 1 };
  const p2Spawn = options.p2Spawn ?? { x: size - 2, y: size - 2 };

  return {
    turn: options.turn ?? 1,
    size,
    board,
    players: {
      [PLAYER.P1]: createPlayer(PLAYER.P1, p1Spawn.x, p1Spawn.y),
      [PLAYER.P2]: createPlayer(PLAYER.P2, p2Spawn.x, p2Spawn.y)
    },
    bombs: [],
    items: [],
    status: STATUS.ONGOING,
    rng: (options.seed ?? 1234) >>> 0,
    nextBombId: 1,
    nextItemId: 1
  };
}

export function randomItemFromValue(value) {
  if (value < 1 / 3) {
    return ITEM.FIRE_UP;
  }
  if (value < 2 / 3) {
    return ITEM.BOOTS;
  }
  return ITEM.KICK;
}
