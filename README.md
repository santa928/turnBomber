# turnBomber

同時手番ホットシート型ボム対戦ゲームのコアルール実装です。  
UI/描画から分離した純粋関数で 1 ターン進行できます。

## 実装済みコアAPI

- `src/core/index.js`
  - `createInitialState(options?)`: 7x7 初期盤面生成（Solid格子 + Soft配置）
  - `createFloorState(options?)`: テスト向け全Floor状態生成
  - `reduce(state, p1Commands, p2Commands)`: 1ターン進行

```js
import { createInitialState, reduce } from "./src/core/index.js";

let state = createInitialState();
state = reduce(
  state,
  { moves: ["right", "down"], placeBomb: true },
  { moves: ["left"], placeBomb: false }
);
```

## コマンド形式

```js
{
  moves: ["up" | "down" | "left" | "right", ...],
  placeBomb: boolean
}
```

## 仕様対応範囲

- AP持ち越し/回復/自爆ペナルティ
- 同時移動（同マス競合・すれ違い不成立、失敗時AP消費）
- 設置（同時設置、設置後2ターン爆発）
- 爆発（十字、Soft停止破壊、Solid遮断、連鎖）
- 自爆（死亡しない・次ターンAP-1）
- Kick（1マス押し、失敗時移動不成立）
- Soft破壊時ドロップ（30%、同時存在上限3）
- 盤面縮小（turn 15/18/... で外周からVoid化）
- 勝敗判定（同時死亡は引き分け）

## テスト実行

依存追加なしで Node 標準テストを使用します。

```bash
npm test
```
