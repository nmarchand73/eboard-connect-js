/**
 * ChessUp BLE message codec (Nordic UART).
 * Re-implemented from the MIT chessupdriver message layout; cross-checked with bluecheese.
 */

/** Nordic UART Service (NUS). */
export const CHESSUP_SERVICE_UUID = "6e400001-b5a3-f393-e0a9-e50e24dcca9e";
/** Host → board (NUS RX). */
export const CHESSUP_WRITE_UUID = "6e400002-b5a3-f393-e0a9-e50e24dcca9e";
/** Board → host notify (NUS TX). */
export const CHESSUP_NOTIFY_UUID = "6e400003-b5a3-f393-e0a9-e50e24dcca9e";

/** Unofficial: paint AI-assistance colours on legal-move destinations (bluecheese). */
export const CMD_ASSISTANCE = 0x10;
export const CMD_MOVE_ACK = 0x21;
export const CMD_PROMOTION_ACK = 0x23;
export const CMD_SET_STATE = 0x66;
export const CMD_GET_STATE = 0x67;
export const CMD_SEND_MOVE = 0x99;
export const CMD_ENABLE_RAW_STREAM = 0x50;

/** 2-bit assistance colours (purple is board-side for the lifted piece). */
export type ChessUpAssistanceColour = "red" | "blue" | "green";

export type ChessUpMoveSquares = { from: string; to: string };

export const RESP_MOVE_OK = 0x22;
export const RESP_OK = 0x24;
export const RESP_BOARD_STATE = 0x67;
export const RESP_PROMOTION = 0x97;
export const RESP_MOVE = 0xa3;
export const RESP_TOUCH = 0xb8;

/** Piece byte → FEN letter (null = empty). */
export const CHESSUP_PIECES: ReadonlyMap<number, string | null> = new Map([
  [0x00, "P"],
  [0x01, "R"],
  [0x02, "N"],
  [0x03, "B"],
  [0x04, "Q"],
  [0x05, "K"],
  [0x08, "p"],
  [0x09, "r"],
  [0x0a, "n"],
  [0x0b, "b"],
  [0x0c, "q"],
  [0x0d, "k"],
  [0x40, null],
]);

const FEN_TO_BYTE: ReadonlyMap<string, number> = new Map([
  ["P", 0x00],
  ["R", 0x01],
  ["N", 0x02],
  ["B", 0x03],
  ["Q", 0x04],
  ["K", 0x05],
  ["p", 0x08],
  ["r", 0x09],
  ["n", 0x0a],
  ["b", 0x0b],
  ["q", 0x0c],
  ["k", 0x0d],
]);

/** Squares a1…h8 (index = file + rank * 8). */
export const CHESSUP_SQUARES: readonly string[] = (() => {
  const files = "abcdefgh";
  const out: string[] = [];
  for (let rank = 1; rank <= 8; rank++) {
    for (let file = 0; file < 8; file++) {
      out.push(`${files[file]}${rank}`);
    }
  }
  return out;
})();

export type ChessUpBoardState = {
  /** FEN piece placement only. */
  placement: string;
  /** Full FEN (placement + side + castling + ep + clocks). */
  fen: string;
  turn: "w" | "b";
  castling: string;
  enPassant: string;
  halfMove: number;
  fullMove: number;
};

export type ChessUpMove = {
  from: string;
  to: string;
};

export type ChessUpParsedMessage =
  | { kind: "boardState"; state: ChessUpBoardState; length: number }
  | { kind: "move"; move: ChessUpMove; length: number }
  | { kind: "promotion"; piece: string | null; length: number }
  | { kind: "touch"; square: string; piece: string | null; length: number }
  | { kind: "ack"; code: number; length: number }
  | { kind: "unknown"; opcode: number; length: number };

function squareIndex(square: string): number {
  const idx = CHESSUP_SQUARES.indexOf(square.toLowerCase());
  if (idx < 0) throw new Error(`Invalid square: ${square}`);
  return idx;
}

function pieceLetter(byte: number): string | null {
  return CHESSUP_PIECES.has(byte) ? (CHESSUP_PIECES.get(byte) ?? null) : null;
}

/** Build FEN placement from 64 piece bytes in a1→h8 order. */
export function placementFromPieceBytes(bytes: Uint8Array): string {
  if (bytes.length < 64) {
    throw new Error(`Board state needs 64 piece bytes, got ${bytes.length}`);
  }
  const ranks: string[] = [];
  for (let rank = 7; rank >= 0; rank--) {
    let empty = 0;
    let part = "";
    for (let file = 0; file < 8; file++) {
      const letter = pieceLetter(bytes[rank * 8 + file]!);
      if (!letter) {
        empty++;
      } else {
        if (empty > 0) {
          part += String(empty);
          empty = 0;
        }
        part += letter;
      }
    }
    if (empty > 0) part += String(empty);
    ranks.push(part);
  }
  return ranks.join("/");
}

function castlingString(
  whiteK: boolean,
  whiteQ: boolean,
  blackK: boolean,
  blackQ: boolean,
): string {
  let s = "";
  if (whiteK) s += "K";
  if (whiteQ) s += "Q";
  if (blackK) s += "k";
  if (blackQ) s += "q";
  return s || "-";
}

function enPassantSquare(byte: number): string {
  if (byte >= 0 && byte < 64) return CHESSUP_SQUARES[byte]!;
  return "-";
}

/** Decode RESP_BOARD_STATE (0x67) payload including the opcode byte. */
export function decodeBoardState(data: Uint8Array): ChessUpBoardState {
  // Opcode + 64 pieces + turn + 4 castling + ep + half + full = 73 bytes (bluecheese).
  if (data.length < 73) {
    throw new Error(`Board state message too short (${data.length})`);
  }
  const pieces = data.subarray(1, 65);
  const placement = placementFromPieceBytes(pieces);
  const turn: "w" | "b" = data[65] === 0 ? "w" : "b";
  const castling = castlingString(
    data[66] === 1,
    data[67] === 1,
    data[68] === 1,
    data[69] === 1,
  );
  const enPassant = enPassantSquare(data[70]!);
  const halfMove = data[71]!;
  const fullMove = data[72]!;
  const fen = `${placement} ${turn} ${castling} ${enPassant} ${halfMove} ${fullMove}`;
  return { placement, fen, turn, castling, enPassant, halfMove, fullMove };
}

/** Decode RESP_MOVE (0xA3 …) — file/rank pairs → algebraic. */
export function decodeMove(data: Uint8Array): ChessUpMove {
  if (data.length < 6 || data[0] !== RESP_MOVE) {
    throw new Error("Not a ChessUp move message");
  }
  const from = CHESSUP_SQUARES[data[2]! + data[3]! * 8];
  const to = CHESSUP_SQUARES[data[4]! + data[5]! * 8];
  if (!from || !to) throw new Error("Invalid move square indices");
  return { from, to };
}

export function encodeGetState(): Uint8Array {
  return new Uint8Array([CMD_GET_STATE, 0x00]);
}

export function encodeMoveAck(): Uint8Array {
  return new Uint8Array([CMD_MOVE_ACK]);
}

export function encodePromotionAck(): Uint8Array {
  return new Uint8Array([CMD_PROMOTION_ACK]);
}

export function encodeSendMove(from: string, to: string): Uint8Array {
  return new Uint8Array([CMD_SEND_MOVE, squareIndex(from), squareIndex(to)]);
}

export function encodeEnableRawStream(): Uint8Array {
  return new Uint8Array([CMD_ENABLE_RAW_STREAM]);
}

/**
 * CMD_ASSISTANCE (0x10) — one colour per sorted legal move (bluecheese layout).
 * Frame: `[0x10, count, packedBits…]`.
 * Packing: 4 colours/byte, 2 bits each, high pair first; red=00, blue=01, green=10.
 */
export function encodeAssistance(colours: readonly ChessUpAssistanceColour[]): Uint8Array {
  const n = colours.length;
  if (n > 255) throw new Error("Too many assistance colours");
  const dataBytes = Math.ceil((2 * n) / 8);
  const payload = new Uint8Array(1 + dataBytes);
  payload[0] = n;
  for (let i = 0; i < n; i++) {
    const bit = Math.floor(i / 4) * 8 + (3 - (i % 4)) * 2;
    const byteIndex = 1 + Math.floor(bit / 8);
    const bitInByte = bit % 8;
    const colour = colours[i]!;
    if (colour === "blue") {
      payload[byteIndex]! |= 1 << bitInByte;
    } else if (colour === "green") {
      payload[byteIndex]! |= 1 << (bitInByte + 1);
    }
  }
  const framed = new Uint8Array(1 + payload.length);
  framed[0] = CMD_ASSISTANCE;
  framed.set(payload, 1);
  return framed;
}

/** Algebraic square → bluecheese row/col (rank1→row0, file a→col0). */
export function squareToRowCol(square: string): { row: number; col: number } {
  const s = square.toLowerCase();
  const col = s.charCodeAt(0) - 97;
  const row = Number(s[1]) - 1;
  if (col < 0 || col > 7 || row < 0 || row > 7 || Number.isNaN(row)) {
    throw new Error(`Invalid square: ${square}`);
  }
  return { row, col };
}

/**
 * Unique from→to pairs in bluecheese `sortedLegalMoves` order.
 * Pass verbose chess.js moves (promotions collapsed to one from/to).
 */
export function sortedLegalMovePairs(
  moves: readonly ChessUpMoveSquares[],
): ChessUpMoveSquares[] {
  const seen = new Set<string>();
  const unique: ChessUpMoveSquares[] = [];
  for (const m of moves) {
    const from = m.from.toLowerCase();
    const to = m.to.toLowerCase();
    const key = `${from}${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push({ from, to });
  }
  unique.sort((a, b) => {
    const af = squareToRowCol(a.from);
    const bf = squareToRowCol(b.from);
    if (af.row !== bf.row) return af.row - bf.row;
    if (af.col !== bf.col) return af.col - bf.col;
    const at = squareToRowCol(a.to);
    const bt = squareToRowCol(b.to);
    if (at.row !== bt.row) return at.row - bt.row;
    return at.col - bt.col;
  });
  return unique;
}

/**
 * Build an assistance colour vector highlighting one from→to in green, others red.
 * `legalMoves` should be chess.js verbose moves (or any from/to list) for the position.
 */
export function assistanceColoursForHighlight(
  legalMoves: readonly ChessUpMoveSquares[],
  highlight: ChessUpMoveSquares | null,
): ChessUpAssistanceColour[] {
  const sorted = sortedLegalMovePairs(legalMoves);
  if (!highlight) {
    return sorted.map(() => "red");
  }
  const hf = highlight.from.toLowerCase();
  const ht = highlight.to.toLowerCase();
  return sorted.map((m) => (m.from === hf && m.to === ht ? "green" : "red"));
}

/**
 * CMD_SET_STATE / load FEN — length-prefixed ASCII FEN fields + binary clocks
 * (bluecheese layout).
 */
export function encodeSetState(fen: string): Uint8Array {
  const parts = fen.trim().split(/\s+/);
  if (parts.length < 4) {
    throw new Error("FEN must include at least placement, turn, castling, ep");
  }
  const halfMove = parts.length >= 5 ? Number(parts[4]) : 0;
  const fullMove = parts.length >= 6 ? Number(parts[5]) : 1;
  if (!Number.isFinite(halfMove) || !Number.isFinite(fullMove)) {
    throw new Error("Invalid FEN clocks");
  }
  const head = `${parts[0]} ${parts[1]} ${parts[2]} ${parts[3]} `;
  const encoder = new TextEncoder();
  const headBytes = encoder.encode(head);
  const clocks = new Uint8Array([
    halfMove & 0xff,
    (fullMove >> 8) & 0xff,
    fullMove & 0xff,
  ]);
  const body = new Uint8Array(headBytes.length + clocks.length);
  body.set(headBytes, 0);
  body.set(clocks, headBytes.length);
  if (body.length > 0xff) throw new Error("FEN payload too long for ChessUp");
  const out = new Uint8Array(2 + body.length);
  out[0] = CMD_SET_STATE;
  out[1] = body.length;
  out.set(body, 2);
  return out;
}

/** Try to parse one framed message from the start of a buffer. */
export function tryParseMessage(data: Uint8Array): ChessUpParsedMessage | null {
  if (data.length === 0) return null;
  const opcode = data[0]!;

  switch (opcode) {
    case RESP_BOARD_STATE: {
      if (data.length < 73) return null;
      return { kind: "boardState", state: decodeBoardState(data.subarray(0, 73)), length: 73 };
    }
    case RESP_MOVE: {
      if (data.length < 6) return null;
      return { kind: "move", move: decodeMove(data.subarray(0, 6)), length: 6 };
    }
    case RESP_PROMOTION: {
      if (data.length < 2) return null;
      return {
        kind: "promotion",
        piece: pieceLetter(data[1]!),
        length: 2,
      };
    }
    case RESP_TOUCH: {
      if (data.length < 3) return null;
      const square = CHESSUP_SQUARES[data[1]!];
      if (!square) {
        return { kind: "unknown", opcode, length: 3 };
      }
      return {
        kind: "touch",
        square,
        piece: pieceLetter(data[2]!),
        length: 3,
      };
    }
    case RESP_MOVE_OK:
    case RESP_OK:
    case CMD_MOVE_ACK:
    case CMD_PROMOTION_ACK:
      return { kind: "ack", code: opcode, length: 1 };
    default:
      // Skip one byte of unknown stream noise so the framer can resync.
      return { kind: "unknown", opcode, length: 1 };
  }
}

/** Consume a BLE chunk into a growing buffer; return fully parsed messages. */
export function feedChessUpBuffer(
  buffer: Uint8Array,
  chunk: Uint8Array,
): { buffer: Uint8Array; messages: ChessUpParsedMessage[] } {
  const merged = new Uint8Array(buffer.length + chunk.length);
  merged.set(buffer, 0);
  merged.set(chunk, buffer.length);

  const messages: ChessUpParsedMessage[] = [];
  let offset = 0;
  while (offset < merged.length) {
    const slice = merged.subarray(offset);
    const parsed = tryParseMessage(slice);
    if (!parsed) break;
    if (parsed.kind !== "unknown" || parsed.length > 1 || slice.length === 1) {
      messages.push(parsed);
    }
    offset += parsed.length;
  }
  return { buffer: merged.subarray(offset), messages };
}

export function fenLetterToByte(letter: string | null | undefined): number {
  if (!letter) return 0x40;
  return FEN_TO_BYTE.get(letter) ?? 0x40;
}
