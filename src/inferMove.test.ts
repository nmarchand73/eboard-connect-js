import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inferMoveFromPlacements } from "./inferMove.js";

describe("inferMoveFromPlacements", () => {
  it("detects e2e4", () => {
    const before = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
    const after = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR";
    assert.equal(inferMoveFromPlacements(before, after, "w"), "e4");
  });

  it("returns null when unchanged", () => {
    const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
    assert.equal(inferMoveFromPlacements(fen, fen, "w"), null);
  });

  it("returns null for incomplete transit position", () => {
    const before = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
    // Piece lifted from e2 but not placed — missing a white pawn
    const after = "rnbqkbnr/pppppppp/8/8/8/8/PPPP1PPP/RNBQKBNR";
    assert.equal(inferMoveFromPlacements(before, after, "w"), null);
  });
});
