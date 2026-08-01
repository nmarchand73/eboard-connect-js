import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildLedCommand,
  decodeBoardBytes,
  decodeFenNotification,
  encodeLedPayload,
  parseBatteryPayload,
  PIECE_NIBBLES,
} from "./protocol.js";

/** Encode placement → 32 board bytes (inverse of decode, for fixtures). */
function encodePlacement(placement: string): Uint8Array {
  const pieceToNibble = new Map<string, number>();
  PIECE_NIBBLES.forEach((p, i) => {
    if (p) pieceToNibble.set(p, i);
  });

  const ranks = placement.split("/");
  assert.equal(ranks.length, 8);
  const squares: number[] = []; // h8→a1 order per rank row

  for (const rank of ranks) {
    const row: string[] = [];
    for (const ch of rank) {
      if (ch >= "1" && ch <= "8") {
        row.push(...Array(Number(ch)).fill(""));
      } else {
        row.push(ch);
      }
    }
    assert.equal(row.length, 8);
    // row is a→h; board packing wants h→a
    for (let i = 7; i >= 0; i--) squares.push(pieceToNibble.get(row[i]!) ?? 0);
  }

  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    const low = squares[i * 2]!;
    const high = squares[i * 2 + 1]!;
    bytes[i] = (high << 4) | low;
  }
  return bytes;
}

describe("decodeBoardBytes", () => {
  it("decodes empty board", () => {
    assert.equal(decodeBoardBytes(new Uint8Array(32)), "8/8/8/8/8/8/8/8");
  });

  it("round-trips starting position", () => {
    const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
    const bytes = encodePlacement(start);
    assert.equal(decodeBoardBytes(bytes), start);
  });

  it("decodes fen notification with header", () => {
    const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
    const packet = new Uint8Array(36);
    packet[0] = 0x01;
    packet[1] = 0x24;
    packet.set(encodePlacement(start), 2);
    assert.equal(decodeFenNotification(packet), start);
  });
});

describe("LEDs", () => {
  it("encodes e2 and e4", () => {
    const payload = encodeLedPayload(["e2", "e4"]);
    // rank 8 → index 0; rank 1 → index 7; e file bit = 8
    assert.equal(payload[6], 8); // rank 2
    assert.equal(payload[4], 8); // rank 4
  });

  it("builds ble led command", () => {
    const cmd = buildLedCommand(["a1"]);
    assert.equal(cmd[0], 0x0a);
    assert.equal(cmd[1], 0x08);
    assert.equal(cmd.length, 10);
    assert.equal(cmd[9], 128); // a-file on rank 1
  });
});

describe("parseBatteryPayload", () => {
  it("parses percent and charging bit", () => {
    assert.deepEqual(parseBatteryPayload(Uint8Array.of(0x55)), {
      percent: 0x55,
      charging: false,
    });
    assert.deepEqual(parseBatteryPayload(Uint8Array.of(0x80 | 42)), {
      percent: 42,
      charging: true,
    });
  });
});
