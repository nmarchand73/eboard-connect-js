# eboard-connect-js

Browser TypeScript library to connect **electronic chess boards** from web apps.

Supported boards:

| Brand | Transports | Model |
|-------|------------|--------|
| [Chessnut](https://www.chessnutech.com/) (Air, Air+, Go, Pro, …) | Web Bluetooth + WebHID | Placement stream → optional `inferMoveFromPlacements` |
| [ChessUp](https://www.playchessup.com/) | Web Bluetooth (Nordic UART) | On-board move resolution → `move` + full `boardState` FEN |

Chessnut uses the official [Chessnut eBoard BLE protocol](https://github.com/chessnutech/Chessnut_eBoards). ChessUp uses a community-documented BLE framing (no public LED API). Requires Chromium (Chrome / Edge) on `localhost` or HTTPS. **Safari is not supported.**

```
Projects/chess/
├── eboard-connect-js/   ← this package
├── move_by_move/
├── CHESS_ANALYSER/
└── Avoidable_mistakes/
```

## Install in another chess project

```bash
# from that app's package.json directory
npm install ../../eboard-connect-js
# or in package.json:
# "eboard-connect-js": "file:../../eboard-connect-js"
```

Optional peer for Chessnut move inference: `chess.js`.

For a **vanilla JS (no bundler)** host such as Chess Insight, build the browser IIFE:

```bash
cd /path/to/chess/eboard-connect-js
npm install
npx esbuild src/browser.ts --bundle --format=iife --global-name=EboardConnect --outfile=../CHESS_ANALYSER/web-app/frontend/js/vendor/eboard-connect.js --platform=browser
```

Then load `eboard-connect.js` and use `window.EboardConnect.ChessnutBoard` or `window.EboardConnect.ChessUpBoard`.

```bash
cd /path/to/chess/eboard-connect-js
npm install
npm test
npm run build
```

### ChessUp BLE probe

With the package built (`npm run build`), serve the repo root over HTTPS or open via a local static server, then visit [`examples/chessup-probe.html`](examples/chessup-probe.html). Power the ChessUp, disconnect the official app, click **Connect**, and inspect notify hex / parsed `move` / `boardState` lines.

```bash
npx --yes serve .
# open http://localhost:3000/examples/chessup-probe.html
```

## Usage — Chessnut

```ts
import { ChessnutBoard, isBleSupported, isHidSupported } from "eboard-connect-js";

const board = new ChessnutBoard();

board.on("position", ({ placement }) => {
  console.log(placement); // "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR"
});

board.on("disconnect", () => console.log("disconnected"));
board.on("error", (err) => console.error(err));

// After a page refresh, reconnect without the chooser (same origin permission):
// await board.connect({ transport: "ble", reconnect: true });

if (isBleSupported()) {
  await board.connect({ transport: "ble" });
} else if (isHidSupported()) {
  await board.connect({ transport: "hid" });
}

await board.setLeds(["e2", "e4"]);
const battery = await board.getBattery();
await board.disconnect();
```

`inferMoveFromPlacements(before, after, turn)` (needs `chess.js`) returns a SAN string when exactly one legal move explains the placement change.

## Usage — ChessUp

ChessUp is a chess computer: prefer the resolved `move` event. Full FEN (castling / EP / clocks) arrives on `boardState`. There is **no public LED API**.

**Board protection (default):** connections are **listen-only** — the host ACKs moves and may poll state. Pushing moves (`sendMove`) or loading a FEN (`setBoardState`) requires `allowMutatingCommands: true`. Unofficial assistance lights (`sendAssistance` / CMD `0x10`) require `allowAssistanceLights: true` (also implied by mutating).

```ts
import {
  ChessUpBoard,
  assistanceColoursForHighlight,
  isBleSupported,
} from "eboard-connect-js";

const board = new ChessUpBoard();

if (isBleSupported()) {
  await board.connect({ allowAssistanceLights: true });
}

// One colour per sorted legal move — green highlights e2e4, others red:
const legal = [/* {from,to} from chess.js verbose moves */];
await board.sendAssistance(
  assistanceColoursForHighlight(legal, { from: "e2", to: "e4" }),
);
await board.sendAssistance([]); // clear attempt
```

## Limits

- **Chessnut:** placement only — castling rights, en passant, clocks are not reported by the board.
- **ChessUp:** BLE only (USB is for charging). Protocol is unofficial / may change with firmware. No free-form LED control. Only one BLE client at a time (close the official app).
- Safari / Firefox do not expose Web Bluetooth / WebHID.
