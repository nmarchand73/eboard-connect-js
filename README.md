# eboard-connect-js

Browser TypeScript library to connect **electronic chess boards** from web apps.

Current support: [Chessnut](https://www.chessnutech.com/) (Air, Air+, Go, Pro, …) over:

- **Web Bluetooth** (BLE)
- **WebHID** (USB cable)

Based on the official [Chessnut eBoard BLE protocol](https://github.com/chessnutech/Chessnut_eBoards). Requires Chromium (Chrome / Edge) on `localhost` or HTTPS. **Safari is not supported.**

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

Optional peer for move inference: `chess.js`.

```bash
cd /path/to/chess/eboard-connect-js
npm install
npm test
npm run build
```

## Usage

```ts
import { ChessnutBoard, isBleSupported, isHidSupported } from "eboard-connect-js";

const board = new ChessnutBoard();

board.on("position", ({ placement }) => {
  console.log(placement); // "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR"
});

board.on("disconnect", () => console.log("disconnected"));
board.on("error", (err) => console.error(err));

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

## Limits

- Placement only — castling rights, en passant, clocks are not reported by the board.
- Safari / Firefox do not expose Web Bluetooth / WebHID.
