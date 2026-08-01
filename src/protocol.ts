/** Official Chessnut classic BLE profile (Air / Air+ / Go / Pro). */

export const FEN_SERVICE_UUID = "1b7e8261-2877-41c3-b46e-cf057c562023";
export const FEN_CHARACTERISTIC_UUID = "1b7e8262-2877-41c3-b46e-cf057c562023";

export const OPS_SERVICE_UUID = "1b7e8271-2877-41c3-b46e-cf057c562023";
export const OPS_WRITE_CHARACTERISTIC_UUID = "1b7e8272-2877-41c3-b46e-cf057c562023";
export const OPS_NOTIFY_CHARACTERISTIC_UUID = "1b7e8273-2877-41c3-b46e-cf057c562023";

/** Enable realtime board position reports. */
export const CMD_ENABLE_REALTIME = Uint8Array.of(0x21, 0x01, 0x00);

/** Query battery level. */
export const CMD_GET_BATTERY = Uint8Array.of(0x29, 0x01, 0x00);

export const LED_CMD_PREFIX = Uint8Array.of(0x0a, 0x08);

/** Chessnut USB vendor ID. */
export const HID_VENDOR_ID = 0x2d80;

/**
 * Known product IDs (Air / Pro / Air+ / …). Prefer filtering by vendor alone
 * when requesting devices so newer boards still appear.
 */
export const HID_PRODUCT_IDS = [0x8001, 0x8002, 0x8100, 0x8200, 0x8300, 0x8500] as const;

/** WebHID report id used for realtime enable / LED writes. */
export const HID_REPORT_REALTIME = 0x21;
export const HID_REPORT_LED = 0x0a;
export const HID_INPUT_REPORT_ID = 0x01;

/**
 * Piece nibble map from Chessnut docs.
 * 0 empty; black lowercase; white uppercase.
 */
export const PIECE_NIBBLES = [
  "",
  "q",
  "k",
  "b",
  "p",
  "n",
  "R",
  "P",
  "r",
  "B",
  "N",
  "Q",
  "K",
] as const;

import type { BatteryStatus } from "./types.js";

/**
 * Decode 32 board-data bytes (h8→a1 packing) into a FEN placement string.
 */
export function decodeBoardBytes(boardBytes: Uint8Array): string {
  if (boardBytes.length < 32) {
    throw new Error(`Chessnut board packet too short: ${boardBytes.length} bytes`);
  }

  let fen = "";
  let empty = 0;

  for (let row = 0; row < 8; row++) {
    for (let col = 7; col >= 0; col--) {
      const index = Math.floor((row * 8 + col) / 2);
      const pieceVal =
        col % 2 === 0 ? boardBytes[index]! & 0x0f : boardBytes[index]! >> 4;
      const piece = PIECE_NIBBLES[pieceVal] ?? "";
      if (piece === "") {
        empty++;
      } else {
        if (empty > 0) fen += String(empty);
        fen += piece;
        empty = 0;
      }
    }
    if (empty > 0) fen += String(empty);
    if (row < 7) fen += "/";
    empty = 0;
  }

  return fen;
}

/**
 * Decode a full 36-byte FEN notification (header + 32 board bytes + trailing).
 * Accepts shorter buffers that still contain the 32 board bytes at offset 2.
 */
export function decodeFenNotification(data: Uint8Array): string {
  if (data.length < 34) {
    throw new Error(`Chessnut FEN notification too short: ${data.length} bytes`);
  }
  return decodeBoardBytes(data.subarray(2, 34));
}

const FILE_BITS: Record<string, number> = {
  a: 128,
  b: 64,
  c: 32,
  d: 16,
  e: 8,
  f: 4,
  g: 2,
  h: 1,
};

const RANK_INDEX: Record<string, number> = {
  "1": 7,
  "2": 6,
  "3": 5,
  "4": 4,
  "5": 3,
  "6": 2,
  "7": 1,
  "8": 0,
};

/** Encode squares like `e2` into the 8-byte LED payload (ranks 8→1). */
export function encodeLedPayload(squares: readonly string[]): Uint8Array {
  const payload = new Uint8Array(8);
  for (const square of squares) {
    const normalized = square.trim().toLowerCase();
    if (normalized.length !== 2) {
      throw new Error(`Invalid square "${square}"`);
    }
    const file = FILE_BITS[normalized[0]!];
    const rank = RANK_INDEX[normalized[1]!];
    if (file === undefined || rank === undefined) {
      throw new Error(`Invalid square "${square}"`);
    }
    payload[rank]! |= file;
  }
  return payload;
}

/** Full LED write command for BLE ops characteristic. */
export function buildLedCommand(squares: readonly string[]): Uint8Array {
  const payload = encodeLedPayload(squares);
  const cmd = new Uint8Array(LED_CMD_PREFIX.length + payload.length);
  cmd.set(LED_CMD_PREFIX, 0);
  cmd.set(payload, LED_CMD_PREFIX.length);
  return cmd;
}

/** Parse battery notify payload after header `0x2a 0x02`. */
export function parseBatteryPayload(payload: Uint8Array): BatteryStatus {
  if (payload.length < 1) {
    throw new Error("Empty battery payload");
  }
  const raw = payload[0]!;
  return {
    percent: raw & 0x7f,
    charging: (raw & 0x80) !== 0,
  };
}

/** True when buffer looks like a board FEN notify (`0x01 0x24` header). */
export function isBoardDataPacket(data: Uint8Array): boolean {
  return data.length >= 34 && data[0] === 0x01 && data[1] === 0x24;
}

/** True when buffer is a battery response (`0x2a 0x02`). */
export function isBatteryPacket(data: Uint8Array): boolean {
  return data.length >= 3 && data[0] === 0x2a && data[1] === 0x02;
}
