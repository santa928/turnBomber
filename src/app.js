import { CELL, PLAYER, STATUS, createInitialState, reduce } from "./core/index.js";
import { createPixiBoard } from "./ui/pixiBoard.js";

const PHASE = Object.freeze({
  P1_INPUT: "P1_INPUT",
  P2_INPUT: "P2_INPUT",
  PASS_TO_P2: "PASS_TO_P2",
  RESOLVING: "RESOLVING",
  TURN_RESULT: "TURN_RESULT",
  GAME_OVER: "GAME_OVER"
});

const MATCH_MODE = Object.freeze({
  HOTSEAT: "HOTSEAT",
  CPU: "CPU"
});

const DIRECTION_VECTORS = Object.freeze({
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 }
});

function emptyCommand() {
  return { moves: [], placeBombStep: null };
}

function cloneCommand(command) {
  const placeBombStep = Number.isInteger(command?.placeBombStep)
    ? command.placeBombStep
    : null;
  return {
    moves: [...command.moves],
    placeBombStep
  };
}

function inBounds(state, x, y) {
  return x >= 0 && x < state.size && y >= 0 && y < state.size;
}

function isBlockedCell(cell) {
  return cell === CELL.SOLID || cell === CELL.SOFT || cell === CELL.VOID;
}

function hasBombAt(state, x, y) {
  return state.bombs.some((bomb) => bomb.x === x && bomb.y === y);
}

function apStartForPlayer(player) {
  const carry = Math.min(2, Math.max(0, player.apEnd ?? 0));
  let apStart = Math.min(5, carry + 3);
  if (player.apPenaltyNext) {
    apStart -= 1;
  }
  return Math.max(1, apStart);
}

function projectFromCommand(state, playerId, command) {
  const normalizedCommand = normalizeCommand(command);
  const player = state.players[playerId];
  const enemyId = playerId === PLAYER.P1 ? PLAYER.P2 : PLAYER.P1;
  const enemy = state.players[enemyId];
  let x = player.x;
  let y = player.y;
  let ap = apStartForPlayer(player);
  let bonusMoves = player.bootsTurns > 0 ? 1 : 0;
  const steps = [];
  const actions = buildActionSequence(normalizedCommand);
  let plannedBomb = null;
  const projectedBombs = state.bombs.map((bomb) => ({
    id: bomb.id,
    x: bomb.x,
    y: bomb.y
  }));

  const hasProjectedBombAt = (tx, ty) =>
    projectedBombs.some((bomb) => bomb.x === tx && bomb.y === ty) ||
    Boolean(plannedBomb && plannedBomb.x === tx && plannedBomb.y === ty);

  const findProjectedBombIndexAt = (tx, ty) =>
    projectedBombs.findIndex((bomb) => bomb.x === tx && bomb.y === ty);

  for (const action of actions) {
    if (action.type === "move") {
      let hasCost = false;
      if (ap > 0) {
        ap -= 1;
        hasCost = true;
      } else if (bonusMoves > 0) {
        bonusMoves -= 1;
        hasCost = true;
      }
      if (!hasCost) {
        continue;
      }

      const v = DIRECTION_VECTORS[action.direction];
      if (!v) {
        continue;
      }
      const nx = x + v.x;
      const ny = y + v.y;
      if (!inBounds(state, nx, ny)) {
        continue;
      }
      if (isBlockedCell(state.board[ny][nx])) {
        continue;
      }
      const bombIndex = findProjectedBombIndexAt(nx, ny);
      if (bombIndex >= 0) {
        if (!player.kick) {
          continue;
        }
        const pushX = nx + v.x;
        const pushY = ny + v.y;
        if (!inBounds(state, pushX, pushY)) {
          continue;
        }
        if (isBlockedCell(state.board[pushY][pushX])) {
          continue;
        }
        if (hasProjectedBombAt(pushX, pushY)) {
          continue;
        }
        if (enemy.alive && enemy.x === pushX && enemy.y === pushY) {
          continue;
        }
        projectedBombs[bombIndex].x = pushX;
        projectedBombs[bombIndex].y = pushY;
      }
      x = nx;
      y = ny;
      steps.push({ x, y });
      continue;
    }

    if (action.type === "place") {
      if (ap < 1) {
        continue;
      }
      ap -= 1;
      if (hasProjectedBombAt(x, y)) {
        continue;
      }
      plannedBomb = {
        x,
        y,
        owner: playerId,
        timer: 1,
        range: player.firePower
      };
    }
  }

  const canMoveMore = ap > 0 || bonusMoves > 0;
  const canPlaceBomb = ap > 0 && !plannedBomb && !hasBombAt(state, x, y);
  const placeBombPlanned = Boolean(plannedBomb);
  const apRemainingAfterCommand = ap;
  return {
    x,
    y,
    steps,
    plannedBomb,
    placeBombStep: normalizedCommand.placeBombStep,
    apStart: apStartForPlayer(player),
    apRemaining: ap,
    apRemainingAfterCommand,
    bonusMovesRemaining: bonusMoves,
    canMoveMore,
    canPlaceBomb,
    placeBombPlanned,
    projectedBombs
  };
}

function candidateMoves(state, playerId, projection) {
  if (!projection.canMoveMore) {
    return [];
  }
  const enemyId = playerId === PLAYER.P1 ? PLAYER.P2 : PLAYER.P1;
  const enemy = state.players[enemyId];
  const result = [];

  for (const [name, vector] of Object.entries(DIRECTION_VECTORS)) {
    const nx = projection.x + vector.x;
    const ny = projection.y + vector.y;
    if (!inBounds(state, nx, ny)) {
      continue;
    }
    if (isBlockedCell(state.board[ny][nx])) {
      continue;
    }
    const projectedBombs = projection.projectedBombs ?? state.bombs;
    const bombAtTarget = projectedBombs.find((bomb) => bomb.x === nx && bomb.y === ny);
    if (bombAtTarget) {
      const player = state.players[playerId];
      if (!player.kick) {
        continue;
      }
      const pushX = nx + vector.x;
      const pushY = ny + vector.y;
      if (!inBounds(state, pushX, pushY)) {
        continue;
      }
      if (isBlockedCell(state.board[pushY][pushX])) {
        continue;
      }
      const pushBlockedByBomb = projectedBombs.some(
        (bomb) => bomb.x === pushX && bomb.y === pushY
      );
      if (pushBlockedByBomb) {
        continue;
      }
      const pushBlockedByPlannedBomb = Boolean(
        projection.plannedBomb &&
          projection.plannedBomb.x === pushX &&
          projection.plannedBomb.y === pushY
      );
      if (pushBlockedByPlannedBomb) {
        continue;
      }
      if (enemy.alive && enemy.x === pushX && enemy.y === pushY) {
        continue;
      }
    }
    result.push({ direction: name, x: nx, y: ny });
  }
  return result;
}

function coordKeyForAi(x, y) {
  return `${x},${y}`;
}

function manhattanDistance(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function blastCellsForBomb(state, bomb) {
  const cells = [{ x: bomb.x, y: bomb.y }];
  for (const vector of Object.values(DIRECTION_VECTORS)) {
    for (let distance = 1; distance <= (bomb.range ?? 1); distance += 1) {
      const x = bomb.x + vector.x * distance;
      const y = bomb.y + vector.y * distance;
      if (!inBounds(state, x, y)) {
        break;
      }
      const cell = state.board[y][x];
      if (cell === CELL.SOLID || cell === CELL.VOID) {
        break;
      }
      cells.push({ x, y });
      if (cell === CELL.SOFT) {
        break;
      }
    }
  }
  return cells;
}

function dangerCellsForProjection(state, projection) {
  const dangerCells = new Set();
  const baseBombs = projection?.projectedBombs ?? state.bombs;
  const sourceBombById = new Map(state.bombs.map((bomb) => [bomb.id, bomb]));

  for (const bomb of baseBombs) {
    const sourceBomb = sourceBombById.get(bomb.id);
    if (!sourceBomb || sourceBomb.timer > 1) {
      continue;
    }
    const projectedBomb = {
      ...sourceBomb,
      x: bomb.x,
      y: bomb.y
    };
    for (const cell of blastCellsForBomb(state, projectedBomb)) {
      dangerCells.add(coordKeyForAi(cell.x, cell.y));
    }
  }
  return dangerCells;
}

function countAdjacentSoftWalls(state, x, y) {
  let count = 0;
  for (const vector of Object.values(DIRECTION_VECTORS)) {
    const nx = x + vector.x;
    const ny = y + vector.y;
    if (!inBounds(state, nx, ny)) {
      continue;
    }
    if (state.board[ny][nx] === CELL.SOFT) {
      count += 1;
    }
  }
  return count;
}

function bombCanReachTarget(state, from, to, range) {
  if (from.x !== to.x && from.y !== to.y) {
    return false;
  }
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  const distance = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
  if (distance === 0 || distance > range) {
    return false;
  }
  let x = from.x;
  let y = from.y;
  for (let step = 0; step < distance; step += 1) {
    x += dx;
    y += dy;
    const cell = state.board[y][x];
    if (cell === CELL.SOLID || cell === CELL.VOID || cell === CELL.SOFT) {
      return false;
    }
  }
  return true;
}

function shouldCpuPlaceBomb(state, playerId, projection) {
  const enemyId = playerId === PLAYER.P1 ? PLAYER.P2 : PLAYER.P1;
  const enemy = state.players[enemyId];
  const player = state.players[playerId];
  const position = { x: projection.x, y: projection.y };
  if (!enemy.alive) {
    return false;
  }

  if (bombCanReachTarget(state, position, enemy, player.firePower)) {
    return true;
  }

  const softWallCount = countAdjacentSoftWalls(state, position.x, position.y);
  if (softWallCount >= 2) {
    return true;
  }
  return softWallCount >= 1 && manhattanDistance(position, enemy) <= 2;
}

function backtrackPenalty(state, playerId, projection, nextPosition) {
  const player = state.players[playerId];
  const traversed = [{ x: player.x, y: player.y }, ...projection.steps];
  const previous = traversed[traversed.length - 2] ?? null;
  let penalty = 0;

  if (
    previous &&
    previous.x === nextPosition.x &&
    previous.y === nextPosition.y
  ) {
    penalty += 4;
  }

  const recentCells = traversed.slice(Math.max(0, traversed.length - 4), traversed.length - 1);
  if (recentCells.some((cell) => cell.x === nextPosition.x && cell.y === nextPosition.y)) {
    penalty += 1.2;
  }
  return penalty;
}

function buildCpuCommand(state, playerId = PLAYER.P2) {
  const command = emptyCommand();
  const enemyId = playerId === PLAYER.P1 ? PLAYER.P2 : PLAYER.P1;
  const enemy = state.players[enemyId];

  for (let step = 0; step < 8; step += 1) {
    const projection = projectFromCommand(state, playerId, command);
    if (!projection.canMoveMore) {
      break;
    }
    const moves = candidateMoves(state, playerId, projection);
    if (moves.length === 0) {
      break;
    }

    const dangerCells = dangerCellsForProjection(state, projection);
    const safeMoves = moves.filter(
      (move) => !dangerCells.has(coordKeyForAi(move.x, move.y))
    );
    const pool = safeMoves.length > 0 ? safeMoves : moves;
    const distanceBefore = manhattanDistance(
      { x: projection.x, y: projection.y },
      enemy
    );

    let bestMove = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const move of pool) {
      const nextCommand = cloneCommand(command);
      nextCommand.moves.push(move.direction);
      const nextProjection = projectFromCommand(state, playerId, nextCommand);
      const nextDangerCells = dangerCellsForProjection(state, nextProjection);
      const nextPosition = { x: nextProjection.x, y: nextProjection.y };
      const distanceAfter = manhattanDistance(nextPosition, enemy);
      let score = (distanceBefore - distanceAfter) * 2;

      const dangerKey = coordKeyForAi(nextPosition.x, nextPosition.y);
      if (nextDangerCells.has(dangerKey)) {
        score -= 20;
      }
      if (state.items.some((item) => item.x === nextPosition.x && item.y === nextPosition.y)) {
        score += 5;
      }
      score += countAdjacentSoftWalls(state, nextPosition.x, nextPosition.y) * 0.6;
      score -= backtrackPenalty(state, playerId, projection, nextPosition);

      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    }

    if (!bestMove) {
      break;
    }
    command.moves.push(bestMove.direction);
  }

  const finalProjection = projectFromCommand(state, playerId, command);
  const finalDangerCells = dangerCellsForProjection(state, finalProjection);
  const finalKey = coordKeyForAi(finalProjection.x, finalProjection.y);
  if (
    finalProjection.canPlaceBomb &&
    !finalDangerCells.has(finalKey) &&
    shouldCpuPlaceBomb(state, playerId, finalProjection)
  ) {
    command.placeBombStep = command.moves.length;
  }

  return command;
}

function summarizePlayer(player) {
  const alive = player.alive ? "生存" : "死亡";
  const kick = player.kick ? "Kick:あり" : "Kick:なし";
  const boots = player.bootsTurns > 0 ? `Boots:${player.bootsTurns}` : "Boots:0";
  return `${alive} / Fire:${player.firePower} / ${kick} / ${boots}`;
}

function commandText(command) {
  if (!command.moves.length) {
    return "移動: なし";
  }
  return `移動: ${command.moves.join(" → ")}`;
}

function winnerText(status, matchMode) {
  if (status === STATUS.P1_WIN) {
    return "P1 の勝利";
  }
  if (status === STATUS.P2_WIN) {
    return matchMode === MATCH_MODE.CPU ? "CPU の勝利" : "P2 の勝利";
  }
  if (status === STATUS.DRAW) {
    return "引き分け";
  }
  return "続行";
}

function cloneStateForView(state) {
  return {
    ...state,
    board: state.board.map((row) => row.slice()),
    players: {
      [PLAYER.P1]: { ...state.players[PLAYER.P1] },
      [PLAYER.P2]: { ...state.players[PLAYER.P2] }
    },
    bombs: state.bombs.map((bomb) => ({ ...bomb })),
    items: state.items.map((item) => ({ ...item }))
  };
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

function commandHasBomb(command) {
  return Number.isInteger(command?.placeBombStep);
}

function normalizePlaceBombStep(moves, placeBombStep) {
  if (!Number.isInteger(placeBombStep)) {
    return null;
  }
  return Math.max(0, Math.min(moves.length, placeBombStep));
}

function buildActionSequence(command) {
  const actions = [];
  const placeBombStep = normalizePlaceBombStep(command.moves, command.placeBombStep);
  for (let moveIndex = 0; moveIndex <= command.moves.length; moveIndex += 1) {
    if (placeBombStep === moveIndex) {
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

function normalizeCommand(command) {
  const moves = Array.isArray(command?.moves)
    ? command.moves.filter((move) => Object.hasOwn(DIRECTION_VECTORS, move))
    : [];
  const hasExplicitStep = Number.isInteger(command?.placeBombStep);
  const placeBombStep = hasExplicitStep
    ? command.placeBombStep
    : command?.placeBomb
      ? moves.length
      : null;
  return {
    moves,
    placeBombStep: normalizePlaceBombStep(moves, placeBombStep)
  };
}

function shortDirection(direction) {
  if (direction === "up") {
    return "↑";
  }
  if (direction === "down") {
    return "↓";
  }
  if (direction === "left") {
    return "←";
  }
  if (direction === "right") {
    return "→";
  }
  return "-";
}

function playerStepLabel(playerId, detail) {
  if (!detail) {
    return `${playerId}: 待機`;
  }
  if (detail.action === "place") {
    return `${playerId}: 設置 ${detail.result}`;
  }
  if (detail.action === "move") {
    return `${playerId}: ${shortDirection(detail.direction)} ${detail.result}`;
  }
  return `${playerId}: ${detail.result}`;
}

function collectItemForPreview(state, player) {
  const index = state.items.findIndex((item) => item.x === player.x && item.y === player.y);
  if (index < 0) {
    return;
  }
  state.items.splice(index, 1);
}

function posKey(x, y) {
  return `${x},${y}`;
}

function parsePosKey(key) {
  const [x, y] = key.split(",").map(Number);
  return { x, y };
}

function addBlastOwner(blastOwners, x, y, owner) {
  const key = posKey(x, y);
  if (!blastOwners.has(key)) {
    blastOwners.set(key, new Set());
  }
  blastOwners.get(key).add(owner);
}

function resolveExplosionsForPreview(state) {
  const queue = [];
  for (const bomb of state.bombs) {
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
    addBlastOwner(blastOwners, bomb.x, bomb.y, bomb.owner);

    for (const vector of Object.values(DIRECTION_VECTORS)) {
      for (let distance = 1; distance <= bomb.range; distance += 1) {
        const x = bomb.x + vector.x * distance;
        const y = bomb.y + vector.y * distance;
        if (!inBounds(state, x, y)) {
          break;
        }
        const cell = state.board[y][x];
        if (cell === CELL.SOLID || cell === CELL.VOID) {
          break;
        }

        addBlastOwner(blastOwners, x, y, bomb.owner);
        if (cell === CELL.SOFT) {
          destroyedSoftWalls.add(posKey(x, y));
          break;
        }

        const chainBomb = state.bombs.find(
          (candidate) =>
            candidate.x === x &&
            candidate.y === y &&
            !explodedBombIds.has(candidate.id)
        );
        if (chainBomb) {
          queue.push(chainBomb);
        }
      }
    }
  }

  return {
    explodedBombIds,
    blastOwners,
    destroyedSoftWalls
  };
}

function buildResolutionFrames(initialState, p1Commands, p2Commands) {
  const previewState = cloneStateForView(initialState);
  const commandMap = {
    [PLAYER.P1]: normalizeCommand(p1Commands),
    [PLAYER.P2]: normalizeCommand(p2Commands)
  };
  const actionSequences = {
    [PLAYER.P1]: buildActionSequence(commandMap[PLAYER.P1]),
    [PLAYER.P2]: buildActionSequence(commandMap[PLAYER.P2])
  };
  const resources = {
    [PLAYER.P1]: {
      apRemaining: apStartForPlayer(previewState.players[PLAYER.P1]),
      bonusMoveRemaining: previewState.players[PLAYER.P1].bootsTurns > 0 ? 1 : 0
    },
    [PLAYER.P2]: {
      apRemaining: apStartForPlayer(previewState.players[PLAYER.P2]),
      bonusMoveRemaining: previewState.players[PLAYER.P2].bootsTurns > 0 ? 1 : 0
    }
  };

  const frames = [];
  const maxSteps = Math.max(
    actionSequences[PLAYER.P1].length,
    actionSequences[PLAYER.P2].length
  );

  for (let stepIndex = 0; stepIndex < maxSteps; stepIndex += 1) {
    const actionMap = {
      [PLAYER.P1]: actionSequences[PLAYER.P1][stepIndex] ?? null,
      [PLAYER.P2]: actionSequences[PLAYER.P2][stepIndex] ?? null
    };
    const intents = {};
    const perPlayer = {
      [PLAYER.P1]: null,
      [PLAYER.P2]: null
    };
    const sources = {
      [PLAYER.P1]: {
        x: previewState.players[PLAYER.P1].x,
        y: previewState.players[PLAYER.P1].y
      },
      [PLAYER.P2]: {
        x: previewState.players[PLAYER.P2].x,
        y: previewState.players[PLAYER.P2].y
      }
    };

    for (const playerId of [PLAYER.P1, PLAYER.P2]) {
      const player = previewState.players[playerId];
      const action = actionMap[playerId];
      if (!action) {
        continue;
      }
      if (!player.alive) {
        perPlayer[playerId] = { result: "死亡中" };
        continue;
      }
      if (action.type !== "move") {
        continue;
      }
      const direction = action.direction;
      const hasCost = consumeMoveCost(resources[playerId]);
      if (!hasCost) {
        perPlayer[playerId] = { action: "move", direction, result: "AP不足" };
        continue;
      }
      const vector = DIRECTION_VECTORS[direction];
      const toX = player.x + vector.x;
      const toY = player.y + vector.y;
      const intent = {
        playerId,
        direction,
        fromX: player.x,
        fromY: player.y,
        toX,
        toY,
        valid: true,
        kind: "move"
      };
      if (!inBounds(previewState, toX, toY)) {
        intent.valid = false;
        perPlayer[playerId] = { action: "move", direction, result: "失敗(範囲外)" };
      } else if (isBlockedCell(previewState.board[toY][toX])) {
        intent.valid = false;
        perPlayer[playerId] = { action: "move", direction, result: "失敗(壁)" };
      } else {
        const bombIndex = previewState.bombs.findIndex((bomb) => bomb.x === toX && bomb.y === toY);
        if (bombIndex >= 0) {
          if (!player.kick) {
            intent.valid = false;
            perPlayer[playerId] = { action: "move", direction, result: "失敗(ボム)" };
          } else {
            intent.kind = "kick";
            intent.kickBombId = previewState.bombs[bombIndex].id;
            intent.pushToX = toX + vector.x;
            intent.pushToY = toY + vector.y;
          }
        }
      }
      intents[playerId] = intent;
      if (!perPlayer[playerId]) {
        perPlayer[playerId] = { action: "move", direction, result: "試行中" };
      }
    }

    const i1 = intents[PLAYER.P1];
    const i2 = intents[PLAYER.P2];
    if (i1?.valid && i2?.valid) {
      const sameTarget = i1.toX === i2.toX && i1.toY === i2.toY;
      if (sameTarget) {
        i1.valid = false;
        i2.valid = false;
        perPlayer[PLAYER.P1] = {
          action: "move",
          direction: i1.direction,
          result: "失敗(競合)"
        };
        perPlayer[PLAYER.P2] = {
          action: "move",
          direction: i2.direction,
          result: "失敗(競合)"
        };
      }
    }

    const p1Stays =
      !i1?.valid ||
      (i1.toX === sources[PLAYER.P1].x && i1.toY === sources[PLAYER.P1].y);
    const p2Stays =
      !i2?.valid ||
      (i2.toX === sources[PLAYER.P2].x && i2.toY === sources[PLAYER.P2].y);

    if (
      i1?.valid &&
      i1.toX === sources[PLAYER.P2].x &&
      i1.toY === sources[PLAYER.P2].y &&
      p2Stays
    ) {
      i1.valid = false;
      perPlayer[PLAYER.P1] = {
        action: "move",
        direction: i1.direction,
        result: "失敗(相手位置)"
      };
    }
    if (
      i2?.valid &&
      i2.toX === sources[PLAYER.P1].x &&
      i2.toY === sources[PLAYER.P1].y &&
      p1Stays
    ) {
      i2.valid = false;
      perPlayer[PLAYER.P2] = {
        action: "move",
        direction: i2.direction,
        result: "失敗(相手位置)"
      };
    }

    for (const playerId of [PLAYER.P1, PLAYER.P2]) {
      const intent = intents[playerId];
      if (!intent?.valid || intent.kind !== "kick") {
        continue;
      }
      if (!inBounds(previewState, intent.pushToX, intent.pushToY)) {
        intent.valid = false;
        perPlayer[playerId] = {
          action: "move",
          direction: intent.direction,
          result: "失敗(Kick範囲外)"
        };
        continue;
      }
      if (previewState.board[intent.pushToY][intent.pushToX] !== CELL.FLOOR) {
        intent.valid = false;
        perPlayer[playerId] = {
          action: "move",
          direction: intent.direction,
          result: "失敗(Kick壁)"
        };
        continue;
      }
      const blockedByBomb = previewState.bombs.some(
        (bomb) =>
          bomb.id !== intent.kickBombId &&
          bomb.x === intent.pushToX &&
          bomb.y === intent.pushToY
      );
      if (blockedByBomb) {
        intent.valid = false;
        perPlayer[playerId] = {
          action: "move",
          direction: intent.direction,
          result: "失敗(Kickボム)"
        };
        continue;
      }
      const blockedByPlayer = Object.values(sources).some(
        (source) => source.x === intent.pushToX && source.y === intent.pushToY
      );
      if (blockedByPlayer) {
        intent.valid = false;
        perPlayer[playerId] = {
          action: "move",
          direction: intent.direction,
          result: "失敗(Kick相手)"
        };
      }
    }

    if (i1?.valid && i2?.valid && i1.kind === "kick" && i2.kind === "kick") {
      if (
        i1.kickBombId === i2.kickBombId ||
        (i1.pushToX === i2.pushToX && i1.pushToY === i2.pushToY)
      ) {
        i1.valid = false;
        i2.valid = false;
        perPlayer[PLAYER.P1] = {
          action: "move",
          direction: i1.direction,
          result: "失敗(Kick競合)"
        };
        perPlayer[PLAYER.P2] = {
          action: "move",
          direction: i2.direction,
          result: "失敗(Kick競合)"
        };
      }
    }

    for (const playerId of [PLAYER.P1, PLAYER.P2]) {
      const intent = intents[playerId];
      if (!intent?.valid || intent.kind !== "kick") {
        continue;
      }
      const bomb = previewState.bombs.find((candidate) => candidate.id === intent.kickBombId);
      if (!bomb) {
        intent.valid = false;
        perPlayer[playerId] = {
          action: "move",
          direction: intent.direction,
          result: "失敗(Kick対象なし)"
        };
        continue;
      }
      bomb.x = intent.pushToX;
      bomb.y = intent.pushToY;
      perPlayer[playerId] = {
        action: "move",
        direction: intent.direction,
        result: "Kick成功"
      };
    }

    for (const playerId of [PLAYER.P1, PLAYER.P2]) {
      const intent = intents[playerId];
      if (!intent?.valid) {
        continue;
      }
      previewState.players[playerId].x = intent.toX;
      previewState.players[playerId].y = intent.toY;
      if (intent.kind === "move") {
        perPlayer[playerId] = {
          action: "move",
          direction: intent.direction,
          result: "成功"
        };
      }
    }

    collectItemForPreview(previewState, previewState.players[PLAYER.P1]);
    collectItemForPreview(previewState, previewState.players[PLAYER.P2]);

    const placeCandidates = [];
    for (const playerId of [PLAYER.P1, PLAYER.P2]) {
      const action = actionMap[playerId];
      if (!action || action.type !== "place") {
        continue;
      }
      const player = previewState.players[playerId];
      if (!player.alive) {
        perPlayer[playerId] = { action: "place", result: "失敗(死亡中)" };
        continue;
      }
      if (resources[playerId].apRemaining < 1) {
        perPlayer[playerId] = { action: "place", result: "失敗(AP不足)" };
        continue;
      }
      resources[playerId].apRemaining -= 1;
      if (previewState.bombs.some((bomb) => bomb.x === player.x && bomb.y === player.y)) {
        perPlayer[playerId] = { action: "place", result: "失敗(既存ボム)" };
        continue;
      }
      placeCandidates.push({
        owner: playerId,
        x: player.x,
        y: player.y,
        timer: 1,
        range: player.firePower,
        bornTurn: previewState.turn,
        id: `preview-${playerId}-${previewState.turn}-${stepIndex}`
      });
    }

    if (
      placeCandidates.length === 2 &&
      placeCandidates[0].x === placeCandidates[1].x &&
      placeCandidates[0].y === placeCandidates[1].y
    ) {
      perPlayer[PLAYER.P1] = { action: "place", result: "失敗(同時競合)" };
      perPlayer[PLAYER.P2] = { action: "place", result: "失敗(同時競合)" };
      placeCandidates.length = 0;
    }

    if (placeCandidates.length > 0) {
      previewState.bombs.push(...placeCandidates);
      for (const bomb of placeCandidates) {
        perPlayer[bomb.owner] = { action: "place", result: "成功" };
      }
    }

    const movingPlayers = {};
    for (const playerId of [PLAYER.P1, PLAYER.P2]) {
      const from = sources[playerId];
      const to = previewState.players[playerId];
      if (!to.alive) {
        continue;
      }
      if (from.x === to.x && from.y === to.y) {
        continue;
      }
      movingPlayers[playerId] = {
        from: { x: from.x, y: from.y },
        to: { x: to.x, y: to.y }
      };
    }

    frames.push({
      type: "action",
      state: cloneStateForView(previewState),
      title: `${stepIndex + 1} AP目の解決`,
      body:
        `${playerStepLabel(PLAYER.P1, perPlayer[PLAYER.P1])}\n` +
        `${playerStepLabel(PLAYER.P2, perPlayer[PLAYER.P2])}`,
      duration: 760,
      movingPlayers
    });
  }

  if (previewState.bombs.length > 0) {
    for (const bomb of previewState.bombs) {
      if (bomb.bornTurn === previewState.turn) {
        continue;
      }
      bomb.timer -= 1;
    }
    frames.push({
      type: "timer",
      state: cloneStateForView(previewState),
      title: "ボムタイマー減少",
      body: "全ボムの残りターンを更新",
      duration: 680
    });

    const explosion = resolveExplosionsForPreview(previewState);
    if (explosion.blastOwners.size > 0) {
      const blastCells = [];
      for (const [key, owners] of explosion.blastOwners.entries()) {
        const position = parsePosKey(key);
        let owner = null;
        if (owners.has(PLAYER.P1) && !owners.has(PLAYER.P2)) {
          owner = PLAYER.P1;
        } else if (owners.has(PLAYER.P2) && !owners.has(PLAYER.P1)) {
          owner = PLAYER.P2;
        }
        blastCells.push({
          ...position,
          owner
        });
      }

      frames.push({
        type: "explosion",
        state: cloneStateForView(previewState),
        title: "爆発",
        body: "爆風が展開中",
        duration: 940,
        activeBlastCells: blastCells,
        showBombRanges: false
      });

      previewState.bombs = previewState.bombs.filter(
        (bomb) => !explosion.explodedBombIds.has(bomb.id)
      );
      for (const key of explosion.destroyedSoftWalls) {
        const { x, y } = parsePosKey(key);
        if (inBounds(previewState, x, y)) {
          previewState.board[y][x] = CELL.FLOOR;
        }
      }
      for (const playerId of [PLAYER.P1, PLAYER.P2]) {
        const player = previewState.players[playerId];
        if (!player.alive) {
          continue;
        }
        const owners = explosion.blastOwners.get(posKey(player.x, player.y));
        if (!owners) {
          continue;
        }
        const opponentId = playerId === PLAYER.P1 ? PLAYER.P2 : PLAYER.P1;
        if (owners.has(opponentId) || owners.has(playerId)) {
          player.alive = false;
        }
      }

      frames.push({
        type: "after-explosion",
        state: cloneStateForView(previewState),
        title: "爆発後",
        body: "爆発結果を反映",
        duration: 700
      });
    }
  }

  frames.push({
    type: "finalize",
    state: cloneStateForView(previewState),
    title: "爆発・縮小・勝敗判定",
    body: "残りフェーズを解決しています…",
    duration: 760
  });

  return frames;
}

function wait(ms) {
  return new Promise((resolvePromise) => {
    window.setTimeout(resolvePromise, ms);
  });
}

function waitAnimationFrame() {
  return new Promise((resolvePromise) => {
    window.requestAnimationFrame(() => resolvePromise());
  });
}

function renderResolutionFrame(frame, options = {}) {
  renderer.render({
    state: frame.state,
    activePlayerId: null,
    candidateTargets: [],
    projection: null,
    plannedBombs: [],
    activeBlastCells: frame.activeBlastCells ?? [],
    showBombRanges: frame.showBombRanges ?? true,
    playerPositionsOverride: options.playerPositionsOverride ?? null
  });
}

async function playResolutionAnimation() {
  const frames = buildResolutionFrames(
    gameState,
    pendingCommands[PLAYER.P1],
    pendingCommands[PLAYER.P2]
  );
  hideOverlay();

  for (let index = 0; index < frames.length; index += 1) {
    const frame = frames[index];
    const headline = frame.body?.split("\n")[0] ?? "";
    elements.phaseText.textContent = `${frame.title}${headline ? ` / ${headline}` : ""}`;

    const movingPlayers = frame.movingPlayers ?? {};
    const movingPlayerIds = Object.keys(movingPlayers);
    const hasMovementAnimation = movingPlayerIds.length > 0;

    if (!hasMovementAnimation) {
      renderResolutionFrame(frame);
      await wait(frame.duration);
      continue;
    }

    const moveDuration = Math.min(520, Math.max(300, Math.floor(frame.duration * 0.62)));
    const holdDuration = Math.max(120, frame.duration - moveDuration);
    const start = performance.now();
    let now = start;

    while (now - start < moveDuration) {
      const progress = Math.min(1, (now - start) / moveDuration);
      const playerPositionsOverride = {};
      for (const playerId of movingPlayerIds) {
        const movement = movingPlayers[playerId];
        playerPositionsOverride[playerId] = {
          x: movement.from.x + (movement.to.x - movement.from.x) * progress,
          y: movement.from.y + (movement.to.y - movement.from.y) * progress
        };
      }
      renderResolutionFrame(frame, { playerPositionsOverride });
      await waitAnimationFrame();
      now = performance.now();
    }

    renderResolutionFrame(frame);
    await wait(holdDuration);
  }
}

const elements = {
  phaseText: document.getElementById("phaseText"),
  modeText: document.getElementById("modeText"),
  modeHotseatBtn: document.getElementById("modeHotseatBtn"),
  modeCpuBtn: document.getElementById("modeCpuBtn"),
  turnText: document.getElementById("turnText"),
  playerText: document.getElementById("playerText"),
  apText: document.getElementById("apText"),
  movesText: document.getElementById("movesText"),
  p1Text: document.getElementById("p1Text"),
  p2Text: document.getElementById("p2Text"),
  commandMoves: document.getElementById("commandMoves"),
  commandBomb: document.getElementById("commandBomb"),
  apChipText: document.getElementById("apChipText"),
  bombBtn: document.getElementById("bombBtn"),
  confirmBtn: document.getElementById("confirmBtn"),
  undoBtn: document.getElementById("undoBtn"),
  clearBtn: document.getElementById("clearBtn"),
  overlay: document.getElementById("overlay"),
  overlayTitle: document.getElementById("overlayTitle"),
  overlayBody: document.getElementById("overlayBody"),
  overlayAction: document.getElementById("overlayAction")
};

function createMatchState() {
  const seed = Math.floor(Math.random() * 0x100000000) >>> 0;
  return createInitialState({ seed });
}

let gameState = createMatchState();
let phase = PHASE.P1_INPUT;
let matchMode = MATCH_MODE.HOTSEAT;
let pendingCommands = {
  [PLAYER.P1]: emptyCommand(),
  [PLAYER.P2]: emptyCommand()
};

let renderer;

function p2DisplayName() {
  return matchMode === MATCH_MODE.CPU ? "CPU(P2)" : "P2";
}

function updateModeControls() {
  const isHotseat = matchMode === MATCH_MODE.HOTSEAT;
  const modeLocked = phase === PHASE.RESOLVING;
  elements.modeHotseatBtn.classList.toggle("is-active", isHotseat);
  elements.modeCpuBtn.classList.toggle("is-active", !isHotseat);
  elements.modeHotseatBtn.setAttribute("aria-pressed", String(isHotseat));
  elements.modeCpuBtn.setAttribute("aria-pressed", String(!isHotseat));
  elements.modeHotseatBtn.disabled = modeLocked;
  elements.modeCpuBtn.disabled = modeLocked;
  elements.modeText.textContent = isHotseat
    ? "同じ端末で交互に入力"
    : "P2 は CPU が自動入力";
}

function activePlayerId() {
  if (phase === PHASE.P1_INPUT) {
    return PLAYER.P1;
  }
  if (phase === PHASE.P2_INPUT) {
    return PLAYER.P2;
  }
  return null;
}

function activeCommand() {
  const playerId = activePlayerId();
  if (!playerId) {
    return null;
  }
  return pendingCommands[playerId];
}

function setOverlay({ title, body, actionLabel, onAction, showAction = true }) {
  elements.overlay.classList.remove("hidden");
  elements.overlayTitle.textContent = title;
  elements.overlayBody.textContent = body;
  elements.overlayAction.style.display = showAction ? "inline-flex" : "none";
  elements.overlayAction.disabled = false;
  elements.overlayAction.textContent = actionLabel ?? "OK";
  elements.overlayAction.onclick = showAction ? onAction : null;
}

function hideOverlay() {
  elements.overlay.classList.add("hidden");
  elements.overlayAction.onclick = null;
}

function updateSidebar(projection, candidates) {
  const activeId = activePlayerId();
  elements.turnText.textContent = `#${gameState.turn}`;
  elements.p1Text.textContent = summarizePlayer(gameState.players[PLAYER.P1]);
  elements.p2Text.textContent = `${p2DisplayName()} / ${summarizePlayer(gameState.players[PLAYER.P2])}`;

  if (!activeId) {
    elements.playerText.textContent = "-";
    elements.apText.textContent = "入力待機中";
    elements.movesText.textContent = "";
    elements.commandMoves.textContent = "移動: -";
    elements.commandBomb.textContent = "ボム: -";
    elements.apChipText.textContent = "-";
    return;
  }

  const command = pendingCommands[activeId];
  if (matchMode === MATCH_MODE.CPU && activeId === PLAYER.P1) {
    elements.playerText.textContent = "あなた (P1)";
  } else if (matchMode === MATCH_MODE.CPU && activeId === PLAYER.P2) {
    elements.playerText.textContent = "CPU (P2)";
  } else {
    elements.playerText.textContent = activeId;
  }
  const bombSuffix = projection.placeBombPlanned ? "（ボム予約 -1 反映）" : "";
  elements.apText.textContent = `AP開始 ${projection.apStart} / 残り ${projection.apRemainingAfterCommand}${bombSuffix}`;
  elements.movesText.textContent = `追加移動残 ${projection.bonusMovesRemaining} / 候補 ${candidates.length} マス`;
  elements.commandMoves.textContent = commandText(command);
  elements.commandBomb.textContent = projection.placeBombPlanned
    ? `ボム: 設置する（移動${projection.placeBombStep}回後 / 爆発まで1ターン）`
    : "ボム: 設置しない";
  elements.apChipText.textContent = String(projection.apRemainingAfterCommand);
}

function updateButtons(projection) {
  const inputPhase = phase === PHASE.P1_INPUT || phase === PHASE.P2_INPUT;
  const command = activeCommand();
  const hasMoves = Boolean(command?.moves.length);
  const hasBomb = commandHasBomb(command);
  const canPlace = inputPhase && projection?.canPlaceBomb;

  elements.bombBtn.disabled = !inputPhase || (!hasBomb && !canPlace);
  elements.confirmBtn.disabled = !inputPhase;
  elements.undoBtn.disabled = !inputPhase || (!hasMoves && !hasBomb);
  elements.clearBtn.disabled = !inputPhase || (!hasMoves && !hasBomb);
  elements.confirmBtn.textContent =
    matchMode === MATCH_MODE.CPU && phase === PHASE.P1_INPUT ? "CPUと解決" : "確定";
}

function phaseLabel() {
  if (phase === PHASE.P1_INPUT) {
    return matchMode === MATCH_MODE.CPU ? "あなた (P1) が入力中" : "P1 が入力中";
  }
  if (phase === PHASE.P2_INPUT) {
    return matchMode === MATCH_MODE.CPU ? "CPU が入力中" : "P2 が入力中";
  }
  if (phase === PHASE.PASS_TO_P2) {
    return "端末を P2 に渡してください";
  }
  if (phase === PHASE.RESOLVING) {
    return "同時解決中…";
  }
  if (phase === PHASE.TURN_RESULT) {
    return "解決完了";
  }
  return "ゲーム終了";
}

function refresh() {
  const playerId = activePlayerId();
  const projection = playerId
    ? projectFromCommand(gameState, playerId, pendingCommands[playerId])
    : null;
  const candidates = playerId ? candidateMoves(gameState, playerId, projection) : [];
  const plannedBombs = [];
  if (playerId) {
    const command = pendingCommands[playerId];
    if (commandHasBomb(command)) {
      const commandProjection = projectFromCommand(gameState, playerId, command);
      if (commandProjection.placeBombPlanned) {
        plannedBombs.push({
          x: commandProjection.plannedBomb.x,
          y: commandProjection.plannedBomb.y,
          owner: playerId,
          timer: commandProjection.plannedBomb.timer,
          range: commandProjection.plannedBomb.range,
          isActiveOwner: true
        });
      }
    }
  }

  renderer.render({
    state: gameState,
    activePlayerId: playerId,
    candidateTargets: candidates,
    projection,
    plannedBombs
  });

  elements.phaseText.textContent = phaseLabel();
  updateModeControls();
  updateSidebar(
    projection ?? {
      apStart: 0,
      apRemaining: 0,
      apRemainingAfterCommand: 0,
      bonusMovesRemaining: 0,
      placeBombPlanned: false
    },
    candidates
  );
  updateButtons(projection ?? { canPlaceBomb: false });
}

function appendMoveByCell(cell) {
  const playerId = activePlayerId();
  if (!playerId) {
    return;
  }
  const command = pendingCommands[playerId];
  const projection = projectFromCommand(gameState, playerId, command);
  const candidates = candidateMoves(gameState, playerId, projection);
  const target = candidates.find((item) => item.x === cell.x && item.y === cell.y);
  if (!target) {
    return;
  }
  command.moves.push(target.direction);
  refresh();
}

function onTapCell(cell) {
  if (phase !== PHASE.P1_INPUT && phase !== PHASE.P2_INPUT) {
    return;
  }
  appendMoveByCell(cell);
}

function setNextTurnStart() {
  pendingCommands = {
    [PLAYER.P1]: emptyCommand(),
    [PLAYER.P2]: emptyCommand()
  };
  phase = PHASE.P1_INPUT;
  hideOverlay();
  refresh();
}

function restartGame() {
  gameState = createMatchState();
  setNextTurnStart();
}

async function finalizeTurn() {
  document.body.classList.add("resolving");
  phase = PHASE.RESOLVING;
  refresh();

  await playResolutionAnimation();

  gameState = reduce(
    gameState,
    pendingCommands[PLAYER.P1],
    pendingCommands[PLAYER.P2]
  );
  document.body.classList.remove("resolving");

  if (gameState.status === STATUS.ONGOING) {
    phase = PHASE.TURN_RESULT;
    const p2Label = matchMode === MATCH_MODE.CPU ? "CPU" : "P2";
    setOverlay({
      title: "ターン解決完了",
      body:
        `P1: ${commandText(pendingCommands[PLAYER.P1])}\n` +
        `${p2Label}: ${commandText(pendingCommands[PLAYER.P2])}`,
      actionLabel: "次ターンへ",
      onAction: () => setNextTurnStart()
    });
    refresh();
    return;
  }

  phase = PHASE.GAME_OVER;
  setOverlay({
    title: "ゲーム終了",
    body: winnerText(gameState.status, matchMode),
    actionLabel: "再戦する",
    onAction: () => restartGame()
  });
  refresh();
}

elements.bombBtn.addEventListener("click", () => {
  const playerId = activePlayerId();
  if (!playerId) {
    return;
  }
  const command = pendingCommands[playerId];
  if (commandHasBomb(command)) {
    command.placeBombStep = null;
    refresh();
    return;
  }
  const projection = projectFromCommand(gameState, playerId, command);
  if (!projection.canPlaceBomb) {
    return;
  }
  command.placeBombStep = command.moves.length;
  refresh();
});

elements.undoBtn.addEventListener("click", () => {
  const command = activeCommand();
  if (!command) {
    return;
  }
  const hasBomb = commandHasBomb(command);
  if (hasBomb && command.placeBombStep === command.moves.length) {
    command.placeBombStep = null;
  } else if (command.moves.length > 0) {
    command.moves.pop();
    if (hasBomb) {
      command.placeBombStep = normalizePlaceBombStep(command.moves, command.placeBombStep);
    }
  } else if (hasBomb) {
    command.placeBombStep = null;
  }
  refresh();
});

elements.clearBtn.addEventListener("click", () => {
  const playerId = activePlayerId();
  if (!playerId) {
    return;
  }
  pendingCommands[playerId] = emptyCommand();
  refresh();
});

elements.modeHotseatBtn.addEventListener("click", () => {
  if (matchMode === MATCH_MODE.HOTSEAT) {
    return;
  }
  matchMode = MATCH_MODE.HOTSEAT;
  restartGame();
});

elements.modeCpuBtn.addEventListener("click", () => {
  if (matchMode === MATCH_MODE.CPU) {
    return;
  }
  matchMode = MATCH_MODE.CPU;
  restartGame();
});

elements.confirmBtn.addEventListener("click", () => {
  if (phase === PHASE.P1_INPUT) {
    pendingCommands[PLAYER.P1] = cloneCommand(pendingCommands[PLAYER.P1]);

    if (matchMode === MATCH_MODE.CPU) {
      pendingCommands[PLAYER.P2] = buildCpuCommand(gameState, PLAYER.P2);
      finalizeTurn();
      return;
    }

    phase = PHASE.PASS_TO_P2;
    setOverlay({
      title: "P2 の番です",
      body: "端末を渡してください。準備ができたら開始を押してください。",
      actionLabel: "P2 入力開始",
      onAction: () => {
        phase = PHASE.P2_INPUT;
        pendingCommands[PLAYER.P2] = emptyCommand();
        hideOverlay();
        refresh();
      }
    });
    refresh();
    return;
  }

  if (phase === PHASE.P2_INPUT) {
    pendingCommands[PLAYER.P2] = cloneCommand(pendingCommands[PLAYER.P2]);
    finalizeTurn();
  }
});

async function bootstrap() {
  const root = document.getElementById("pixiRoot");
  renderer = await createPixiBoard(root, onTapCell);
  refresh();
}

bootstrap();
