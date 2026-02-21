import { CELL, ITEM, PLAYER } from "../core/index.js";

const PIXI_MODULE_URLS = [
  "https://cdn.jsdelivr.net/npm/pixi.js@8.6.6/dist/pixi.mjs",
  "https://unpkg.com/pixi.js@8.6.6/dist/pixi.mjs"
];
const PIXI_SCRIPT_URLS = [
  "https://cdn.jsdelivr.net/npm/pixi.js@8.6.6/dist/pixi.min.js",
  "https://unpkg.com/pixi.js@8.6.6/dist/pixi.min.js"
];

let Application;
let Container;
let Graphics;
let Text;
let TextStyle;
let pixiLoadPromise = null;

const BOARD_SIZE = 7;
const CELL_SIZE = 66;
const GAP = 5;
const PADDING = 16;
const BOARD_PIXELS = BOARD_SIZE * CELL_SIZE + (BOARD_SIZE - 1) * GAP;
const CANVAS_SIZE = BOARD_PIXELS + PADDING * 2;

let stepStyle;
let timerStyle;
let overlapStyle;
let itemLabelStyle;

const BLAST_DIRECTIONS = Object.freeze([
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 }
]);

function itemColor(itemType) {
  if (itemType === ITEM.FIRE_UP) {
    return 0xdf4e2a;
  }
  if (itemType === ITEM.BOOTS) {
    return 0x3c8ddb;
  }
  return 0x3d9b51;
}

function itemLabel(itemType) {
  if (itemType === ITEM.FIRE_UP) {
    return "F";
  }
  if (itemType === ITEM.BOOTS) {
    return "B";
  }
  return "K";
}

function cellColors(cell) {
  if (cell === CELL.SOLID) {
    return { fill: 0x7f7460, line: 0x655b49 };
  }
  if (cell === CELL.SOFT) {
    return { fill: 0xb88956, line: 0x8e6638 };
  }
  if (cell === CELL.VOID) {
    return { fill: 0x1e1b16, line: 0x0f0d0b };
  }
  return { fill: 0xf6efd8, line: 0xd3c4a0 };
}

function toPixel(x, y) {
  return {
    x: PADDING + x * (CELL_SIZE + GAP),
    y: PADDING + y * (CELL_SIZE + GAP)
  };
}

function center(x, y) {
  const p = toPixel(x, y);
  return {
    x: p.x + CELL_SIZE / 2,
    y: p.y + CELL_SIZE / 2
  };
}

function inBounds(size, x, y) {
  return x >= 0 && x < size && y >= 0 && y < size;
}

function blastCells(board, size, bomb) {
  const cells = [{ x: bomb.x, y: bomb.y, origin: true }];
  for (const direction of BLAST_DIRECTIONS) {
    for (let distance = 1; distance <= (bomb.range ?? 1); distance += 1) {
      const x = bomb.x + direction.x * distance;
      const y = bomb.y + direction.y * distance;
      if (!inBounds(size, x, y)) {
        break;
      }
      const terrain = board[y][x];
      if (terrain === CELL.SOLID || terrain === CELL.VOID) {
        break;
      }
      cells.push({ x, y, origin: false });
      if (terrain === CELL.SOFT) {
        break;
      }
    }
  }
  return cells;
}

function bombColor(owner) {
  return owner === PLAYER.P1 ? 0x7a1e2d : 0x1a4f80;
}

function blastColor(owner) {
  return owner === PLAYER.P1 ? 0xd7776c : 0x6e99cf;
}

function assignPixiExports(pixi) {
  if (!pixi) {
    return false;
  }
  const ready =
    typeof pixi.Application === "function" &&
    typeof pixi.Container === "function" &&
    typeof pixi.Graphics === "function" &&
    typeof pixi.Text === "function" &&
    typeof pixi.TextStyle === "function";
  if (!ready) {
    return false;
  }
  ({
    Application,
    Container,
    Graphics,
    Text,
    TextStyle
  } = pixi);
  return true;
}

function resolvePixiGlobal() {
  return assignPixiExports(globalThis.PIXI);
}

function loadScript(url) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-pixi-src="${url}"]`);
    if (existing?.dataset.loaded === "true") {
      resolve(true);
      return;
    }

    const script = existing ?? document.createElement("script");
    script.src = url;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.pixiSrc = url;

    script.addEventListener("load", () => {
      script.dataset.loaded = "true";
      resolve(true);
    });
    script.addEventListener("error", () => {
      reject(new Error(`PIXI script load failed: ${url}`));
    });

    if (!existing) {
      document.head.appendChild(script);
    }
  });
}

async function loadPixi() {
  if (Application && Container && Graphics && Text && TextStyle) {
    return true;
  }
  if (resolvePixiGlobal()) {
    return true;
  }

  if (!pixiLoadPromise) {
    pixiLoadPromise = (async () => {
      for (const url of PIXI_MODULE_URLS) {
        try {
          const pixi = await import(url);
          if (assignPixiExports(pixi)) {
            return true;
          }
        } catch (error) {
          console.warn(`PIXI 読み込み失敗: ${url}`, error);
        }
      }
      for (const url of PIXI_SCRIPT_URLS) {
        try {
          await loadScript(url);
          if (resolvePixiGlobal()) {
            return true;
          }
        } catch (error) {
          console.warn(`PIXI 読み込み失敗: ${url}`, error);
        }
      }
      return false;
    })();
  }

  return pixiLoadPromise;
}

function ensureTextStyles() {
  if (stepStyle && timerStyle && overlapStyle && itemLabelStyle) {
    return;
  }
  stepStyle = new TextStyle({
    fontFamily: "Murecho, sans-serif",
    fontWeight: "800",
    fill: 0xffffff,
    fontSize: 12
  });
  timerStyle = new TextStyle({
    fontFamily: "Murecho, sans-serif",
    fontWeight: "800",
    fill: 0xfff9ea,
    fontSize: 14
  });
  overlapStyle = new TextStyle({
    fontFamily: "Murecho, sans-serif",
    fontWeight: "900",
    fill: 0x3a2b19,
    fontSize: 11
  });
  itemLabelStyle = new TextStyle({
    fontFamily: "Murecho, sans-serif",
    fontWeight: "900",
    fill: 0xffffff,
    fontSize: 15
  });
}

function createFallbackBoard(rootElement) {
  rootElement.innerHTML =
    '<div style="display:grid;place-items:center;min-height:280px;padding:18px;text-align:center;color:#3d3726;font-weight:700;">盤面ライブラリの読み込みに失敗しました。\n通信を確認して再読み込みしてください。</div>';
  return {
    render() {}
  };
}

function drawTimerBadge(layer, bomb, options = {}) {
  const { x: px, y: py } = toPixel(bomb.x, bomb.y);
  const chip = new Graphics();
  chip.circle(px + 14, py + 14, 12);
  chip.fill({
    color: bombColor(bomb.owner),
    alpha: options.alpha ?? 0.94
  });
  chip.stroke({
    color: options.strokeColor ?? 0xfff3d8,
    width: options.strokeWidth ?? 2
  });
  layer.addChild(chip);

  const timer = new Text({
    text: String(Math.max(0, bomb.timer ?? 0)),
    style: timerStyle
  });
  timer.anchor.set(0.5);
  timer.position.set(px + 14, py + 15);
  timer.alpha = options.textAlpha ?? 1;
  layer.addChild(timer);
}

export async function createPixiBoard(rootElement, onCellTap) {
  const loaded = await loadPixi();
  if (!loaded) {
    return createFallbackBoard(rootElement, onCellTap);
  }
  ensureTextStyles();

  const app = new Application();
  await app.init({
    width: CANVAS_SIZE,
    height: CANVAS_SIZE,
    backgroundAlpha: 0,
    antialias: true,
    resolution: Math.max(1, window.devicePixelRatio || 1),
    autoDensity: true
  });

  rootElement.innerHTML = "";
  rootElement.appendChild(app.canvas);
  app.canvas.style.width = "100%";
  app.canvas.style.maxWidth = "100%";
  app.canvas.style.height = "auto";
  app.canvas.style.display = "block";

  const boardLayer = new Container();
  const blastLayer = new Container();
  const overlayLayer = new Container();
  const bombLayer = new Container();
  const itemLayer = new Container();
  const playerLayer = new Container();
  const effectLayer = new Container();
  const badgeLayer = new Container();
  const stepLayer = new Container();
  app.stage.addChild(
    boardLayer,
    blastLayer,
    overlayLayer,
    itemLayer,
    bombLayer,
    playerLayer,
    effectLayer,
    badgeLayer,
    stepLayer
  );

  const tappableCells = [];
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      const area = new Graphics();
      const { x: px, y: py } = toPixel(x, y);
      area.rect(px, py, CELL_SIZE, CELL_SIZE);
      area.fill({ color: 0x000000, alpha: 0.001 });
      area.eventMode = "static";
      area.cursor = "pointer";
      area.on("pointertap", () => onCellTap({ x, y }));
      overlayLayer.addChild(area);
      tappableCells.push(area);
    }
  }

  function render({
    state,
    activePlayerId,
    candidateTargets,
    projection,
    plannedBombs = [],
    activeBlastCells = [],
    showBombRanges = true,
    playerPositionsOverride = null
  }) {
    boardLayer.removeChildren();
    blastLayer.removeChildren();
    itemLayer.removeChildren();
    bombLayer.removeChildren();
    playerLayer.removeChildren();
    effectLayer.removeChildren();
    badgeLayer.removeChildren();
    stepLayer.removeChildren();

    const candidateSet = new Set((candidateTargets ?? []).map((item) => `${item.x},${item.y}`));
    const stepNodes = projection?.steps ?? [];
    const projectedSet = new Set(stepNodes.map((item) => `${item.x},${item.y}`));

    for (let y = 0; y < state.size; y += 1) {
      for (let x = 0; x < state.size; x += 1) {
        const cell = state.board[y][x];
        const { x: px, y: py } = toPixel(x, y);
        const { fill, line } = cellColors(cell);

        const g = new Graphics();
        g.roundRect(px, py, CELL_SIZE, CELL_SIZE, 11);
        g.fill(fill);
        g.stroke({ color: line, width: 2 });

        const key = `${x},${y}`;
        if (candidateSet.has(key)) {
          g.roundRect(px + 2, py + 2, CELL_SIZE - 4, CELL_SIZE - 4, 9);
          g.stroke({ color: 0x2f968f, width: 3 });
        }
        if (projectedSet.has(key)) {
          g.roundRect(px + 6, py + 6, CELL_SIZE - 12, CELL_SIZE - 12, 7);
          g.stroke({ color: 0x3d6ca8, width: 2 });
        }
        boardLayer.addChild(g);
      }
    }

    const projectedBombs = (plannedBombs ?? []).map((bomb) => ({
      ...bomb,
      timer: bomb.timer ?? 2,
      range: bomb.range ?? 1,
      planned: true
    }));
    const boardBombs = state.bombs.map((bomb) => ({
      ...bomb,
      range: bomb.range ?? 1,
      planned: false
    }));
    const allBombs = [...boardBombs, ...projectedBombs];

    if (showBombRanges) {
      for (const bomb of allBombs) {
        const cells = blastCells(state.board, state.size, bomb);
        for (const cell of cells) {
          const { x: px, y: py } = toPixel(cell.x, cell.y);
          const blast = new Graphics();
          blast.roundRect(px + 3, py + 3, CELL_SIZE - 6, CELL_SIZE - 6, 10);
          const alpha = cell.origin
            ? bomb.planned
              ? 0.2
              : 0.34
            : bomb.planned
              ? 0.14
              : 0.24;
          blast.fill({
            color: blastColor(bomb.owner),
            alpha
          });
          blast.stroke({
            color: bombColor(bomb.owner),
            width: cell.origin ? 2.4 : 1.6,
            alpha: bomb.planned ? 0.35 : 0.62
          });
          blastLayer.addChild(blast);
        }
      }
    }

    for (const item of state.items) {
      const c = center(item.x, item.y);
      const g = new Graphics();
      g.roundRect(c.x - 14, c.y - 14, 28, 28, 8);
      g.fill(itemColor(item.type));
      g.stroke({ color: 0xffffff, width: 2 });
      itemLayer.addChild(g);

      const label = new Text({
        text: itemLabel(item.type),
        style: itemLabelStyle
      });
      label.anchor.set(0.5);
      label.position.set(c.x, c.y + 0.5);
      itemLayer.addChild(label);
    }

    const playerPositions = new Set(
      [state.players[PLAYER.P1], state.players[PLAYER.P2]]
        .filter((player) => player.alive)
        .map((player) => `${player.x},${player.y}`)
    );

    for (const bomb of boardBombs) {
      const c = center(bomb.x, bomb.y);
      const occupied = playerPositions.has(`${bomb.x},${bomb.y}`);
      const bombX = occupied ? c.x + 14 : c.x;
      const bombY = occupied ? c.y + 14 : c.y;
      const shell = new Graphics();
      shell.circle(bombX, bombY, occupied ? 12 : 16);
      shell.fill(0x2f2a20);
      shell.stroke({ color: 0xffdfa2, width: 2 });
      bombLayer.addChild(shell);
    }

    for (const plannedBomb of projectedBombs) {
      const c = center(plannedBomb.x, plannedBomb.y);
      const occupied = playerPositions.has(`${plannedBomb.x},${plannedBomb.y}`);
      const bombX = occupied ? c.x + 14 : c.x;
      const bombY = occupied ? c.y + 14 : c.y;
      const shell = new Graphics();
      shell.circle(bombX, bombY, occupied ? 12 : 16);
      shell.fill({
        color: bombColor(plannedBomb.owner),
        alpha: plannedBomb.isActiveOwner ? 0.6 : 0.38
      });
      shell.stroke({
        color: plannedBomb.isActiveOwner ? 0xfff3d9 : 0xd7d1c2,
        width: 2
      });
      bombLayer.addChild(shell);
    }

    const p1 = state.players[PLAYER.P1];
    const p2 = state.players[PLAYER.P2];
    const overridePositions = playerPositionsOverride ?? {};
    const drawPlayer = (player, fill, labelText) => {
      if (!player.alive) {
        return;
      }
      const position = overridePositions[player.id] ?? { x: player.x, y: player.y };
      const c = center(position.x, position.y);
      const marker = new Graphics();
      marker.circle(c.x, c.y, 18);
      marker.fill(fill);
      marker.stroke({ color: 0xffffff, width: 2 });
      if (activePlayerId === player.id) {
        marker.circle(c.x, c.y, 22);
        marker.stroke({ color: 0xfee9b5, width: 3 });
      }
      playerLayer.addChild(marker);

      const label = new Text({ text: labelText, style: stepStyle });
      label.anchor.set(0.5);
      label.position.set(c.x, c.y + 0.5);
      playerLayer.addChild(label);
    };

    drawPlayer(p1, 0xa4303f, "P1");
    drawPlayer(p2, 0x0f5e9c, "P2");

    for (const cell of activeBlastCells) {
      const { x: px, y: py } = toPixel(cell.x, cell.y);
      const ownerColor = cell.owner === PLAYER.P1
        ? 0xff6c4a
        : cell.owner === PLAYER.P2
          ? 0x76b8ff
          : 0xffd65f;
      const pulse = new Graphics();
      pulse.roundRect(px + 1, py + 1, CELL_SIZE - 2, CELL_SIZE - 2, 11);
      pulse.fill({ color: ownerColor, alpha: 0.48 });
      pulse.stroke({ color: 0xfff6df, width: 2, alpha: 0.86 });
      effectLayer.addChild(pulse);
    }

    for (const bomb of boardBombs) {
      drawTimerBadge(badgeLayer, bomb);
    }
    for (const bomb of projectedBombs) {
      drawTimerBadge(badgeLayer, bomb, {
        alpha: bomb.isActiveOwner ? 0.72 : 0.5,
        textAlpha: bomb.isActiveOwner ? 0.95 : 0.72,
        strokeColor: bomb.isActiveOwner ? 0xfff3d8 : 0xd2cbc0,
        strokeWidth: 1.5
      });
    }

    for (const player of [p1, p2]) {
      if (!player.alive) {
        continue;
      }
      const bombOnCell = allBombs.find((bomb) => bomb.x === player.x && bomb.y === player.y);
      if (!bombOnCell) {
        continue;
      }
      const c = center(player.x, player.y);
      const ring = new Graphics();
      ring.circle(c.x, c.y, 24);
      ring.stroke({ color: 0xffd667, width: 3 });
      badgeLayer.addChild(ring);

      const marker = new Text({ text: "BOMB", style: overlapStyle });
      marker.anchor.set(0.5);
      marker.position.set(c.x, c.y + 27);
      badgeLayer.addChild(marker);
    }

    stepNodes.forEach((step, index) => {
      const c = center(step.x, step.y);
      const badge = new Graphics();
      badge.circle(c.x + 20, c.y - 20, 10);
      badge.fill(0x3f434d);
      badge.stroke({ color: 0xffffff, width: 1.5 });
      stepLayer.addChild(badge);

      const n = new Text({ text: String(index + 1), style: stepStyle });
      n.anchor.set(0.5);
      n.position.set(c.x + 20, c.y - 20);
      n.scale.set(0.85);
      stepLayer.addChild(n);
    });

    app.render();
  }

  return {
    render,
    destroy() {
      app.destroy(true);
      tappableCells.length = 0;
    }
  };
}
