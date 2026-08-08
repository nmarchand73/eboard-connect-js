import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CHESSUP_SQUARES,
  assistanceColoursForHighlight,
  decodeBoardState,
  decodeMove,
  encodeAssistance,
  encodeGetState,
  encodeMoveAck,
  encodeSendMove,
  encodeSetState,
  feedChessUpBuffer,
  placementFromPieceBytes,
  sortedLegalMovePairs,
  tryParseMessage,
} from "./chessupProtocol.js";

function startingPieceBytes(): Uint8Array {
  // a1→h8: white back rank, white pawns, empty, black pawns, black back rank
  const bytes = new Uint8Array(64);
  bytes.fill(0x40);
  const back = [0x01, 0x02, 0x03, 0x04, 0x05, 0x03, 0x02, 0x01]; // RNBQKBNR
  const blackBack = [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0b, 0x0a, 0x09];
  for (let i = 0; i < 8; i++) {
    bytes[i] = back[i]!;
    bytes[8 + i] = 0x00; // white pawns
    bytes[48 + i] = 0x08; // black pawns
    bytes[56 + i] = blackBack[i]!;
  }
  return bytes;
}

describe("CHESSUP_SQUARES", () => {
  it("maps a1 and h8", () => {
    assert.equal(CHESSUP_SQUARES[0], "a1");
    assert.equal(CHESSUP_SQUARES[63], "h8");
  });
});

describe("placementFromPieceBytes", () => {
  it("decodes the starting position", () => {
    assert.equal(
      placementFromPieceBytes(startingPieceBytes()),
      "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR",
    );
  });
});

describe("decodeBoardState", () => {
  it("builds a full FEN", () => {
    const data = new Uint8Array(73);
    data[0] = 0x67;
    data.set(startingPieceBytes(), 1);
    data[65] = 0; // white
    data[66] = 1;
    data[67] = 1;
    data[68] = 1;
    data[69] = 1;
    data[70] = 0xff; // no ep
    data[71] = 0;
    data[72] = 1;
    const state = decodeBoardState(data);
    assert.equal(state.placement, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR");
    assert.equal(state.turn, "w");
    assert.equal(state.castling, "KQkq");
    assert.equal(state.enPassant, "-");
    assert.equal(state.fen, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  });
});

describe("decodeMove / encodeSendMove", () => {
  it("round-trips e2e4 indices on send", () => {
    const encoded = encodeSendMove("e2", "e4");
    assert.deepEqual([...encoded], [0x99, CHESSUP_SQUARES.indexOf("e2"), CHESSUP_SQUARES.indexOf("e4")]);
  });

  it("decodes a board move e2-e4", () => {
    // from file=4 rank=1 → e2; to file=4 rank=3 → e4
    const data = new Uint8Array([0xa3, 0x35, 4, 1, 4, 3]);
    assert.deepEqual(decodeMove(data), { from: "e2", to: "e4" });
  });
});

describe("command encoders", () => {
  it("encodes get-state and move-ack", () => {
    assert.deepEqual([...encodeGetState()], [0x67, 0x00]);
    assert.deepEqual([...encodeMoveAck()], [0x21]);
  });

  it("encodes set-state with length prefix", () => {
    const bytes = encodeSetState("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    assert.equal(bytes[0], 0x66);
    assert.equal(bytes[1], bytes.length - 2);
  });
});

describe("encodeAssistance / sortedLegalMovePairs", () => {
  it("encodes an empty assistance clear", () => {
    assert.deepEqual([...encodeAssistance([])], [0x10, 0x00]);
  });

  it("packs red/blue/green in bluecheese bit order", () => {
    // i=0 → bits 6-7 of first data byte after count
    const bytes = encodeAssistance(["green", "blue", "red", "green"]);
    assert.equal(bytes[0], 0x10);
    assert.equal(bytes[1], 4);
    // colour0 green → bit7; colour1 blue → bit4; colour2 red → 0; colour3 green → bit1
    // bits: 7=1,6=0, 5=0,4=1, 3=0,2=0, 1=1,0=0 → 0b1001_0010 = 0x92
    assert.equal(bytes[2], 0x92);
  });

  it("sorts legal moves like bluecheese", () => {
    const sorted = sortedLegalMovePairs([
      { from: "e2", to: "e4" },
      { from: "a2", to: "a3" },
      { from: "a2", to: "a4" },
      { from: "e2", to: "e3" },
    ]);
    assert.deepEqual(sorted.map((m) => `${m.from}${m.to}`), [
      "a2a3",
      "a2a4",
      "e2e3",
      "e2e4",
    ]);
  });

  it("highlights one move in green", () => {
    const colours = assistanceColoursForHighlight(
      [
        { from: "e2", to: "e4" },
        { from: "d2", to: "d4" },
      ],
      { from: "e2", to: "e4" },
    );
    assert.deepEqual(colours, ["red", "green"]); // d2d4 before e2e4 in sort
  });
});

describe("tryParseMessage / feedChessUpBuffer", () => {
  it("parses a move and ACKs framing across chunks", () => {
    const move = new Uint8Array([0xa3, 0x35, 4, 1, 4, 3]);
    const first = feedChessUpBuffer(new Uint8Array(0), move.subarray(0, 3));
    assert.equal(first.messages.length, 0);
    const second = feedChessUpBuffer(first.buffer, move.subarray(3));
    assert.equal(second.messages.length, 1);
    assert.equal(second.messages[0]!.kind, "move");
    if (second.messages[0]!.kind === "move") {
      assert.deepEqual(second.messages[0].move, { from: "e2", to: "e4" });
    }
  });

  it("returns null when board state is incomplete", () => {
    assert.equal(tryParseMessage(new Uint8Array([0x67, 0x00])), null);
  });
});
