import test from "node:test";
import assert from "node:assert/strict";
import { CELL, PLAYER, STATUS, createFloorState, reduce } from "../src/core/index.js";

function makeState() {
  const state = createFloorState({ size: 7, turn: 1, seed: 42 });
  state.players[PLAYER.P1].apEnd = 0;
  state.players[PLAYER.P2].apEnd = 0;
  return state;
}

test("同時移動: 同マス侵入は両者不成立", () => {
  const state = makeState();
  state.players[PLAYER.P1].x = 2;
  state.players[PLAYER.P1].y = 3;
  state.players[PLAYER.P2].x = 4;
  state.players[PLAYER.P2].y = 3;

  const next = reduce(
    state,
    { moves: ["right"] },
    { moves: ["left"] }
  );

  assert.deepEqual(
    { x: next.players[PLAYER.P1].x, y: next.players[PLAYER.P1].y },
    { x: 2, y: 3 }
  );
  assert.deepEqual(
    { x: next.players[PLAYER.P2].x, y: next.players[PLAYER.P2].y },
    { x: 4, y: 3 }
  );
  assert.equal(next.players[PLAYER.P1].apEnd, 2);
  assert.equal(next.players[PLAYER.P2].apEnd, 2);
});

test("同時移動: すれ違いは両者不成立", () => {
  const state = makeState();
  state.players[PLAYER.P1].x = 2;
  state.players[PLAYER.P1].y = 3;
  state.players[PLAYER.P2].x = 3;
  state.players[PLAYER.P2].y = 3;

  const next = reduce(
    state,
    { moves: ["right"] },
    { moves: ["left"] }
  );

  assert.deepEqual(
    { x: next.players[PLAYER.P1].x, y: next.players[PLAYER.P1].y },
    { x: 2, y: 3 }
  );
  assert.deepEqual(
    { x: next.players[PLAYER.P2].x, y: next.players[PLAYER.P2].y },
    { x: 3, y: 3 }
  );
  assert.equal(next.players[PLAYER.P1].apEnd, 2);
  assert.equal(next.players[PLAYER.P2].apEnd, 2);
});

test("移動失敗でもAPは消費される", () => {
  const state = makeState();
  state.players[PLAYER.P1].x = 1;
  state.players[PLAYER.P1].y = 2;
  state.players[PLAYER.P2].x = 5;
  state.players[PLAYER.P2].y = 5;
  state.board[2][2] = CELL.SOLID;

  const next = reduce(state, { moves: ["right"] }, {});

  assert.deepEqual(
    { x: next.players[PLAYER.P1].x, y: next.players[PLAYER.P1].y },
    { x: 1, y: 2 }
  );
  assert.equal(next.players[PLAYER.P1].apEnd, 2);
});

test("設置: 1ターン1回まで、同時同マス設置は不成立", () => {
  const state = makeState();
  state.players[PLAYER.P1].x = 3;
  state.players[PLAYER.P1].y = 3;
  state.players[PLAYER.P2].x = 3;
  state.players[PLAYER.P2].y = 3;

  const next = reduce(
    state,
    { placeBomb: true },
    { placeBomb: true }
  );

  assert.equal(next.bombs.length, 0);
  assert.equal(next.players[PLAYER.P1].apEnd, 2);
  assert.equal(next.players[PLAYER.P2].apEnd, 2);
});

test("ボム: 設置から2ターン後爆発、連鎖が発生する", () => {
  const state = makeState();
  state.players[PLAYER.P1].x = 1;
  state.players[PLAYER.P1].y = 1;
  state.players[PLAYER.P2].x = 5;
  state.players[PLAYER.P2].y = 5;
  state.bombs = [
    { id: "b1", owner: PLAYER.P1, x: 3, y: 3, timer: 1, range: 1 },
    { id: "b2", owner: PLAYER.P2, x: 4, y: 3, timer: 2, range: 1 }
  ];

  const next = reduce(state, {}, {});

  assert.equal(next.bombs.length, 0);
  assert.equal(next.players[PLAYER.P1].alive, true);
  assert.equal(next.players[PLAYER.P2].alive, true);
});

test("爆風: SoftWallで停止して破壊、SolidWallで遮断", () => {
  const state = makeState();
  state.players[PLAYER.P1].x = 5;
  state.players[PLAYER.P1].y = 5;
  state.players[PLAYER.P2].x = 1;
  state.players[PLAYER.P2].y = 1;
  state.board[3][2] = CELL.SOFT;
  state.board[2][1] = CELL.SOLID;
  state.bombs = [
    { id: "b1", owner: PLAYER.P1, x: 1, y: 3, timer: 1, range: 3 },
    { id: "b2", owner: PLAYER.P2, x: 3, y: 3, timer: 2, range: 1 }
  ];

  const next = reduce(state, {}, {});

  assert.equal(next.board[3][2], CELL.FLOOR);
  assert.equal(next.bombs.some((bomb) => bomb.id === "b2"), true);
  assert.equal(next.players[PLAYER.P2].alive, true);
});

test("自爆: 死亡しないが次ターンAP-1", () => {
  const state = makeState();
  state.players[PLAYER.P1].x = 3;
  state.players[PLAYER.P1].y = 3;
  state.players[PLAYER.P2].x = 5;
  state.players[PLAYER.P2].y = 5;
  state.bombs = [{ id: "b1", owner: PLAYER.P1, x: 3, y: 3, timer: 1, range: 1 }];

  const turn1 = reduce(state, {}, {});
  assert.equal(turn1.players[PLAYER.P1].alive, true);
  assert.equal(turn1.players[PLAYER.P1].apPenaltyNext, true);

  const turn2 = reduce(turn1, {}, {});
  assert.equal(turn2.players[PLAYER.P1].apStart, 4);
  assert.equal(turn2.players[PLAYER.P1].apPenaltyNext, false);
});

test("キック: 1マス押し出し成功", () => {
  const state = makeState();
  state.players[PLAYER.P1].x = 2;
  state.players[PLAYER.P1].y = 2;
  state.players[PLAYER.P1].kick = true;
  state.players[PLAYER.P2].x = 6;
  state.players[PLAYER.P2].y = 6;
  state.bombs = [{ id: "b1", owner: PLAYER.P2, x: 3, y: 2, timer: 3, range: 1 }];

  const next = reduce(state, { moves: ["right"] }, {});

  assert.deepEqual(
    { x: next.players[PLAYER.P1].x, y: next.players[PLAYER.P1].y },
    { x: 3, y: 2 }
  );
  assert.deepEqual(
    { x: next.bombs[0].x, y: next.bombs[0].y },
    { x: 4, y: 2 }
  );
});

test("キック: 押し先が塞がると移動不成立(AP消費)", () => {
  const state = makeState();
  state.players[PLAYER.P1].x = 2;
  state.players[PLAYER.P1].y = 2;
  state.players[PLAYER.P1].kick = true;
  state.players[PLAYER.P2].x = 6;
  state.players[PLAYER.P2].y = 6;
  state.board[2][4] = CELL.SOLID;
  state.bombs = [{ id: "b1", owner: PLAYER.P2, x: 3, y: 2, timer: 3, range: 1 }];

  const next = reduce(state, { moves: ["right"] }, {});

  assert.deepEqual(
    { x: next.players[PLAYER.P1].x, y: next.players[PLAYER.P1].y },
    { x: 2, y: 2 }
  );
  assert.deepEqual(
    { x: next.bombs[0].x, y: next.bombs[0].y },
    { x: 3, y: 2 }
  );
  assert.equal(next.players[PLAYER.P1].apEnd, 2);
});

test("縮小: Void侵入不可、Void化で即死、オブジェクト消滅", () => {
  const state = makeState();
  state.turn = 15;
  state.players[PLAYER.P1].x = 0;
  state.players[PLAYER.P1].y = 0;
  state.players[PLAYER.P2].x = 3;
  state.players[PLAYER.P2].y = 3;
  state.bombs = [{ id: "b1", owner: PLAYER.P1, x: 0, y: 1, timer: 3, range: 1 }];
  state.items = [{ id: "i1", type: "FireUp", x: 1, y: 0 }];

  const next = reduce(state, {}, {});

  assert.equal(next.board[0][0], CELL.VOID);
  assert.equal(next.players[PLAYER.P1].alive, false);
  assert.equal(next.bombs.length, 0);
  assert.equal(next.items.length, 0);
  assert.equal(next.status, STATUS.P2_WIN);

  const moveToVoid = makeState();
  moveToVoid.board[2][2] = CELL.VOID;
  moveToVoid.players[PLAYER.P1].x = 1;
  moveToVoid.players[PLAYER.P1].y = 2;
  moveToVoid.players[PLAYER.P2].x = 6;
  moveToVoid.players[PLAYER.P2].y = 6;
  const blocked = reduce(moveToVoid, { moves: ["right"] }, {});
  assert.deepEqual(
    { x: blocked.players[PLAYER.P1].x, y: blocked.players[PLAYER.P1].y },
    { x: 1, y: 2 }
  );
  assert.equal(blocked.players[PLAYER.P1].apEnd, 2);
});

test("勝敗: 同時死亡は引き分け", () => {
  const state = makeState();
  state.players[PLAYER.P1].x = 3;
  state.players[PLAYER.P1].y = 2;
  state.players[PLAYER.P2].x = 3;
  state.players[PLAYER.P2].y = 4;
  state.bombs = [
    { id: "b1", owner: PLAYER.P1, x: 3, y: 3, timer: 1, range: 1 },
    { id: "b2", owner: PLAYER.P2, x: 3, y: 1, timer: 1, range: 1 }
  ];

  const next = reduce(state, {}, {});

  assert.equal(next.players[PLAYER.P1].alive, false);
  assert.equal(next.players[PLAYER.P2].alive, false);
  assert.equal(next.status, STATUS.DRAW);
});
