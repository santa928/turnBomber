import {
  CELL,
  DIRECTIONS,
  ITEM_DROP_RATE,
  ITEM_GUARANTEE_ORDER,
  ITEM_GUARANTEED_MINIMUMS,
  ITEM_MAX_ON_BOARD,
  ITEM,
  PLAYER,
  STATUS
} from "./constants.js";
import { randomItemFromValue } from "./createInitialState.js";

function cloneBoard(board) {
  return board.map((row) => row.slice());
}

function cloneState(state) {
  return {
    ...state,
    board: cloneBoard(state.board),
    players: {
      [PLAYER.P1]: { ...state.players[PLAYER.P1] },
      [PLAYER.P2]: { ...state.players[PLAYER.P2] }
    },
    bombs: state.bombs.map((bomb) => ({ ...bomb })),
    items: state.items.map((item) => ({ ...item })),
    itemSpawnedCounts: {
      [ITEM.FIRE_UP]: state.itemSpawnedCounts?.[ITEM.FIRE_UP] ?? 0,
      [ITEM.BOOTS]: state.itemSpawnedCounts?.[ITEM.BOOTS] ?? 0,
      [ITEM.KICK]: state.itemSpawnedCounts?.[ITEM.KICK] ?? 0
    }
  };
}

function normalizeCommands(command) {
  const moves = Array.isArray(command?.moves)
    ? command.moves.filter((move) => Object.hasOwn(DIRECTIONS, move))
    : [];
  const hasExplicitPlaceStep = Number.isInteger(command?.placeBombStep);
  let placeBombStep = null;
  if (hasExplicitPlaceStep) {
    placeBombStep = command.placeBombStep;
  } else if (command?.placeBomb) {
    placeBombStep = moves.length;
  }
  if (placeBombStep !== null) {
    placeBombStep = Math.max(0, Math.min(moves.length, placeBombStep));
  }
  return {
    moves,
    placeBombStep
  };
}

function buildActionSequence(command) {
  const actions = [];
  for (let moveIndex = 0; moveIndex <= command.moves.length; moveIndex += 1) {
    if (command.placeBombStep === moveIndex) {
      actions.push({ type: "place" });
    }
    if (moveIndex < command.moves.length) {
      actions.push({
        type: "move",
        direction: command.moves[moveIndex]
      });
    }
  }
  return actions;
}

function nextSeed(seed) {
  return (seed * 1664525 + 1013904223) >>> 0;
}

function random(stateRef) {
  stateRef.rng = nextSeed(stateRef.rng >>> 0);
  return stateRef.rng / 0x100000000;
}

function ensureItemSpawnedCounts(state) {
  if (!state.itemSpawnedCounts) {
    state.itemSpawnedCounts = {
      [ITEM.FIRE_UP]: 0,
      [ITEM.BOOTS]: 0,
      [ITEM.KICK]: 0
    };
  }
  return state.itemSpawnedCounts;
}

function nextGuaranteedItemType(state) {
  const counts = ensureItemSpawnedCounts(state);
  for (const itemType of ITEM_GUARANTEE_ORDER) {
    const minimum = ITEM_GUARANTEED_MINIMUMS[itemType] ?? 0;
    if ((counts[itemType] ?? 0) < minimum) {
      return itemType;
    }
  }
  return null;
}

function inBounds(state, x, y) {
  return x >= 0 && x < state.size && y >= 0 && y < state.size;
}

function posKey(x, y) {
  return `${x},${y}`;
}

function parseKey(key) {
  const [x, y] = key.split(",").map(Number);
  return { x, y };
}

function findBombIndexAt(state, x, y) {
  return state.bombs.findIndex((bomb) => bomb.x === x && bomb.y === y);
}

function hasBombAt(state, x, y) {
  return findBombIndexAt(state, x, y) >= 0;
}

function hasItemAt(state, x, y) {
  return state.items.findIndex((item) => item.x === x && item.y === y);
}

function consumeMoveCost(resource) {
  if (resource.apRemaining > 0) {
    resource.apRemaining -= 1;
    return true;
  }
  if (resource.bonusMoveRemaining > 0) {
    resource.bonusMoveRemaining -= 1;
    return true;
  }
  return false;
}

function shrinkLayerForTurn(turn) {
  if (turn < 15) {
    return 0;
  }
  return 1 + Math.floor((turn - 15) / 3);
}

function initTurnResources(nextState) {
  const resources = {};
  for (const playerId of [PLAYER.P1, PLAYER.P2]) {
    const player = nextState.players[playerId];
    if (!player.alive) {
      player.apStart = 0;
      player.apEnd = 0;
      resources[playerId] = { apRemaining: 0, bonusMoveRemaining: 0 };
      continue;
    }

    const carry = Math.min(2, Math.max(0, player.apEnd ?? 0));
    let apStart = Math.min(5, carry + 3);
    if (player.apPenaltyNext) {
      apStart -= 1;
    }
    apStart = Math.max(1, apStart);
    player.apStart = apStart;
    player.apPenaltyNext = false;

    const bonusMoveRemaining = player.bootsTurns > 0 ? 1 : 0;
    if (player.bootsTurns > 0) {
      player.bootsTurns -= 1;
    }
    resources[playerId] = {
      apRemaining: apStart,
      bonusMoveRemaining
    };
  }
  return resources;
}

function applyItem(player, itemType) {
  if (itemType === "FireUp") {
    player.firePower += 1;
    return;
  }
  if (itemType === "Boots") {
    player.bootsTurns += 2;
    return;
  }
  if (itemType === "Kick") {
    player.kick = true;
  }
}

function collectItemIfNeeded(nextState, player) {
  if (!player.alive) {
    return;
  }
  const itemIndex = hasItemAt(nextState, player.x, player.y);
  if (itemIndex < 0) {
    return;
  }
  const [item] = nextState.items.splice(itemIndex, 1);
  applyItem(player, item.type);
}

function isTerrainBlocked(cell) {
  return cell === CELL.SOLID || cell === CELL.SOFT || cell === CELL.VOID;
}

function resolveMovementStep(nextState, resources, actionMap) {
  const p1 = nextState.players[PLAYER.P1];
  const p2 = nextState.players[PLAYER.P2];
  const sources = {
    [PLAYER.P1]: { x: p1.x, y: p1.y },
    [PLAYER.P2]: { x: p2.x, y: p2.y }
  };
  const intents = {};

  for (const playerId of [PLAYER.P1, PLAYER.P2]) {
    const player = nextState.players[playerId];
    if (!player.alive) {
      continue;
    }
    const action = actionMap[playerId];
    if (!action || action.type !== "move") {
      continue;
    }
    const direction = action.direction;
    const resource = resources[playerId];
    if (!consumeMoveCost(resource)) {
      continue;
    }

    const vector = DIRECTIONS[direction];
    const toX = player.x + vector.x;
    const toY = player.y + vector.y;
    const intent = {
      playerId,
      fromX: player.x,
      fromY: player.y,
      toX,
      toY,
      direction,
      kind: "move",
      valid: true
    };
    if (!inBounds(nextState, toX, toY)) {
      intent.valid = false;
    } else if (isTerrainBlocked(nextState.board[toY][toX])) {
      intent.valid = false;
    } else {
      const bombIndex = findBombIndexAt(nextState, toX, toY);
      if (bombIndex >= 0) {
        if (!player.kick) {
          intent.valid = false;
        } else {
          intent.kind = "kick";
          intent.kickBombId = nextState.bombs[bombIndex].id;
          intent.kickBombIndex = bombIndex;
          intent.pushToX = toX + vector.x;
          intent.pushToY = toY + vector.y;
        }
      }
    }
    intents[playerId] = intent;
  }

  const i1 = intents[PLAYER.P1];
  const i2 = intents[PLAYER.P2];
  if (i1?.valid && i2?.valid) {
    const sameTarget = i1.toX === i2.toX && i1.toY === i2.toY;
    const swap =
      i1.toX === i2.fromX &&
      i1.toY === i2.fromY &&
      i2.toX === i1.fromX &&
      i2.toY === i1.fromY;
    if (sameTarget || swap) {
      i1.valid = false;
      i2.valid = false;
    }
  }

  if (
    i1?.valid &&
    i1.toX === sources[PLAYER.P2].x &&
    i1.toY === sources[PLAYER.P2].y
  ) {
    i1.valid = false;
  }
  if (
    i2?.valid &&
    i2.toX === sources[PLAYER.P1].x &&
    i2.toY === sources[PLAYER.P1].y
  ) {
    i2.valid = false;
  }

  for (const playerId of [PLAYER.P1, PLAYER.P2]) {
    const intent = intents[playerId];
    if (!intent?.valid || intent.kind !== "kick") {
      continue;
    }
    if (!inBounds(nextState, intent.pushToX, intent.pushToY)) {
      intent.valid = false;
      continue;
    }
    if (nextState.board[intent.pushToY][intent.pushToX] !== CELL.FLOOR) {
      intent.valid = false;
      continue;
    }

    const pushBlockedByBomb = nextState.bombs.some(
      (bomb) =>
        bomb.id !== intent.kickBombId &&
        bomb.x === intent.pushToX &&
        bomb.y === intent.pushToY
    );
    if (pushBlockedByBomb) {
      intent.valid = false;
      continue;
    }

    const pushBlockedByPlayerSource = Object.values(sources).some(
      (position) => position.x === intent.pushToX && position.y === intent.pushToY
    );
    if (pushBlockedByPlayerSource) {
      intent.valid = false;
      continue;
    }

    const otherPlayerId = playerId === PLAYER.P1 ? PLAYER.P2 : PLAYER.P1;
    const otherIntent = intents[otherPlayerId];
    if (
      otherIntent?.valid &&
      otherIntent.toX === intent.pushToX &&
      otherIntent.toY === intent.pushToY
    ) {
      intent.valid = false;
    }
  }

  if (i1?.valid && i2?.valid && i1.kind === "kick" && i2.kind === "kick") {
    if (
      i1.kickBombId === i2.kickBombId ||
      (i1.pushToX === i2.pushToX && i1.pushToY === i2.pushToY)
    ) {
      i1.valid = false;
      i2.valid = false;
    }
  }

  for (const playerId of [PLAYER.P1, PLAYER.P2]) {
    const intent = intents[playerId];
    if (!intent?.valid || intent.kind !== "kick") {
      continue;
    }
    const bomb = nextState.bombs.find((candidate) => candidate.id === intent.kickBombId);
    if (!bomb) {
      intent.valid = false;
      continue;
    }
    bomb.x = intent.pushToX;
    bomb.y = intent.pushToY;
  }

  for (const playerId of [PLAYER.P1, PLAYER.P2]) {
    const intent = intents[playerId];
    if (!intent?.valid) {
      continue;
    }
    const player = nextState.players[playerId];
    player.x = intent.toX;
    player.y = intent.toY;
  }

  collectItemIfNeeded(nextState, nextState.players[PLAYER.P1]);
  collectItemIfNeeded(nextState, nextState.players[PLAYER.P2]);
}

function resolvePlacementStep(nextState, resources, actionMap) {
  const candidates = [];
  for (const playerId of [PLAYER.P1, PLAYER.P2]) {
    const player = nextState.players[playerId];
    const action = actionMap[playerId];
    if (!player.alive || !action || action.type !== "place") {
      continue;
    }
    if (resources[playerId].apRemaining < 1) {
      continue;
    }
    resources[playerId].apRemaining -= 1;

    if (hasBombAt(nextState, player.x, player.y)) {
      continue;
    }
    candidates.push({
      owner: playerId,
      x: player.x,
      y: player.y,
      timer: 2,
      range: player.firePower,
      id: `b${nextState.nextBombId}`
    });
    nextState.nextBombId += 1;
  }

  if (
    candidates.length === 2 &&
    candidates[0].x === candidates[1].x &&
    candidates[0].y === candidates[1].y
  ) {
    return;
  }
  nextState.bombs.push(...candidates);
}

function resolveActionPhase(nextState, resources, commandMap) {
  const actionSequences = {
    [PLAYER.P1]: buildActionSequence(commandMap[PLAYER.P1]),
    [PLAYER.P2]: buildActionSequence(commandMap[PLAYER.P2])
  };
  const maxSteps = Math.max(
    actionSequences[PLAYER.P1].length,
    actionSequences[PLAYER.P2].length
  );
  for (let step = 0; step < maxSteps; step += 1) {
    const actionMap = {
      [PLAYER.P1]: actionSequences[PLAYER.P1][step] ?? null,
      [PLAYER.P2]: actionSequences[PLAYER.P2][step] ?? null
    };
    resolveMovementStep(nextState, resources, actionMap);
    resolvePlacementStep(nextState, resources, actionMap);
  }
}

function resolveTimerPhase(nextState) {
  for (const bomb of nextState.bombs) {
    bomb.timer -= 1;
  }
}

function addBlastCell(blastOwners, x, y, owner) {
  const key = posKey(x, y);
  if (!blastOwners.has(key)) {
    blastOwners.set(key, new Set());
  }
  blastOwners.get(key).add(owner);
}

function resolveExplosionPhase(nextState) {
  const queue = [];
  for (const bomb of nextState.bombs) {
    if (bomb.timer <= 0) {
      queue.push(bomb);
    }
  }

  const explodedBombIds = new Set();
  const blastOwners = new Map();
  const destroyedSoftWalls = new Set();

  while (queue.length > 0) {
    const bomb = queue.pop();
    if (!bomb || explodedBombIds.has(bomb.id)) {
      continue;
    }
    explodedBombIds.add(bomb.id);
    addBlastCell(blastOwners, bomb.x, bomb.y, bomb.owner);

    for (const direction of Object.values(DIRECTIONS)) {
      for (let distance = 1; distance <= bomb.range; distance += 1) {
        const x = bomb.x + direction.x * distance;
        const y = bomb.y + direction.y * distance;
        if (!inBounds(nextState, x, y)) {
          break;
        }
        const cell = nextState.board[y][x];
        if (cell === CELL.SOLID || cell === CELL.VOID) {
          break;
        }

        addBlastCell(blastOwners, x, y, bomb.owner);

        if (cell === CELL.SOFT) {
          destroyedSoftWalls.add(posKey(x, y));
          break;
        }

        const chainBomb = nextState.bombs.find(
          (candidate) => candidate.x === x && candidate.y === y
        );
        if (chainBomb && !explodedBombIds.has(chainBomb.id)) {
          queue.push(chainBomb);
        }
      }
    }
  }

  nextState.bombs = nextState.bombs.filter((bomb) => !explodedBombIds.has(bomb.id));
  return { blastOwners, destroyedSoftWalls };
}

function resolveDamageAndSelfPenalty(nextState, blastOwners) {
  const selfHit = {
    [PLAYER.P1]: false,
    [PLAYER.P2]: false
  };
  for (const playerId of [PLAYER.P1, PLAYER.P2]) {
    const player = nextState.players[playerId];
    if (!player.alive) {
      continue;
    }
    const key = posKey(player.x, player.y);
    const owners = blastOwners.get(key);
    if (!owners) {
      continue;
    }
    const opponentId = playerId === PLAYER.P1 ? PLAYER.P2 : PLAYER.P1;
    if (owners.has(opponentId)) {
      player.alive = false;
      continue;
    }
    if (owners.has(playerId)) {
      selfHit[playerId] = true;
    }
  }

  for (const playerId of [PLAYER.P1, PLAYER.P2]) {
    const player = nextState.players[playerId];
    if (player.alive && selfHit[playerId]) {
      player.apPenaltyNext = true;
    }
  }
}

function resolveDestroyedWallsAndDrops(nextState, destroyedSoftWalls) {
  for (const key of destroyedSoftWalls) {
    const { x, y } = parseKey(key);
    if (!inBounds(nextState, x, y)) {
      continue;
    }
    nextState.board[y][x] = CELL.FLOOR;
    if (nextState.items.length >= ITEM_MAX_ON_BOARD) {
      continue;
    }

    const guaranteedType = nextGuaranteedItemType(nextState);
    if (!guaranteedType && random(nextState) >= ITEM_DROP_RATE) {
      continue;
    }
    const itemType = guaranteedType ?? randomItemFromValue(random(nextState));
    nextState.items.push({
      id: `i${nextState.nextItemId}`,
      type: itemType,
      x,
      y
    });
    ensureItemSpawnedCounts(nextState)[itemType] += 1;
    nextState.nextItemId += 1;
  }
}

function resolveShrink(nextState) {
  const layer = Math.min(shrinkLayerForTurn(nextState.turn), Math.floor(nextState.size / 2));
  if (layer <= 0) {
    return;
  }
  for (let y = 0; y < nextState.size; y += 1) {
    for (let x = 0; x < nextState.size; x += 1) {
      const ringIndex = Math.min(
        x,
        y,
        nextState.size - 1 - x,
        nextState.size - 1 - y
      );
      if (ringIndex < layer) {
        nextState.board[y][x] = CELL.VOID;
      }
    }
  }

  nextState.items = nextState.items.filter(
    (item) => nextState.board[item.y][item.x] !== CELL.VOID
  );
  nextState.bombs = nextState.bombs.filter(
    (bomb) => nextState.board[bomb.y][bomb.x] !== CELL.VOID
  );
  for (const playerId of [PLAYER.P1, PLAYER.P2]) {
    const player = nextState.players[playerId];
    if (player.alive && nextState.board[player.y][player.x] === CELL.VOID) {
      player.alive = false;
    }
  }
}

function resolveStatus(nextState) {
  const p1Alive = nextState.players[PLAYER.P1].alive;
  const p2Alive = nextState.players[PLAYER.P2].alive;
  if (!p1Alive && !p2Alive) {
    nextState.status = STATUS.DRAW;
    return;
  }
  if (!p1Alive) {
    nextState.status = STATUS.P2_WIN;
    return;
  }
  if (!p2Alive) {
    nextState.status = STATUS.P1_WIN;
    return;
  }
  nextState.status = STATUS.ONGOING;
}

function finalizeAp(nextState, resources) {
  for (const playerId of [PLAYER.P1, PLAYER.P2]) {
    const player = nextState.players[playerId];
    player.apEnd = player.alive ? resources[playerId].apRemaining : 0;
  }
}

export function reduce(state, p1Commands = {}, p2Commands = {}) {
  if (state.status && state.status !== STATUS.ONGOING) {
    return state;
  }

  const nextState = cloneState(state);
  const commandMap = {
    [PLAYER.P1]: normalizeCommands(p1Commands),
    [PLAYER.P2]: normalizeCommands(p2Commands)
  };
  const resources = initTurnResources(nextState);

  resolveActionPhase(nextState, resources, commandMap);
  resolveTimerPhase(nextState);
  const { blastOwners, destroyedSoftWalls } = resolveExplosionPhase(nextState);
  resolveDamageAndSelfPenalty(nextState, blastOwners);
  resolveDestroyedWallsAndDrops(nextState, destroyedSoftWalls);
  resolveShrink(nextState);
  resolveStatus(nextState);
  finalizeAp(nextState, resources);

  nextState.turn += 1;
  return nextState;
}
