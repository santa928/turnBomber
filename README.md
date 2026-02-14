# Turn Bomber

同時手番ホットシート型の 2D ボム対戦ゲームです。  
本リポジトリは **コアルール実装 + ブラウザUI + PWA(オフライン対応)** を含みます。

## アプリ説明

- 2人対戦 / CPU対戦を切り替え可能
- 1ターン内で移動とボム設置を入力し、同時解決
- PWA インストール後は、初回キャッシュ完了済みならオフラインでもプレイ可能

## 起動方法

### 1) Docker Compose（推奨）

```bash
cp .env.sample .env
docker compose up
```

ブラウザで `http://localhost:8080` を開いてください。  
(`APP_PORT` を変更した場合はそのポートに読み替えます)

### 2) 簡易起動（Docker単発）

```bash
docker run --rm -p 8080:8080 -v "$PWD:/app" -w /app python:3.12-alpine python -m http.server 8080
```

## 操作方法

- 盤面タップ: 移動予約を追加
- `ボム`: 現在の入力コマンドに設置を追加/解除
- `確定`:
  - 2人対戦: P1入力確定後に P2入力へ
  - CPU対戦: P1入力確定で即解決
- `1手戻す`: 直前入力を取り消し
- `クリア`: 現在プレイヤーの入力を全消去

## PWA（オフラインプレイ）

1. オンライン状態でアプリを開く
2. 一度リロードして Service Worker のキャッシュを有効化する
3. ブラウザの「ホーム画面に追加 / インストール」を実行する
4. 以後はネットワーク切断時も起動してプレイ可能

## 実装済みコアAPI

- `src/core/index.js`
  - `createInitialState(options?)`
  - `createFloorState(options?)`
  - `reduce(state, p1Commands, p2Commands)`

```js
import { createInitialState, reduce } from "./src/core/index.js";

let state = createInitialState();
state = reduce(
  state,
  { moves: ["right", "down"], placeBombStep: 1 },
  { moves: ["left"] }
);
```

## テスト

```bash
npm test
```

## ドキュメント

- `docs/要件定義書.md`
- `docs/仕様書.md`
- `docs/機能一覧.md`
- `docs/仕様補足.md`
