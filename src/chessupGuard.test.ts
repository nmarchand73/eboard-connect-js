import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertMutatingAllowed,
  ChessUpMoveDedupe,
  ChessUpWriteQueue,
} from "./chessupGuard.js";

describe("assertMutatingAllowed", () => {
  it("allows safe writes always", () => {
    assert.doesNotThrow(() => assertMutatingAllowed("safe", false, "getState"));
  });

  it("blocks mutating writes without the opt-in", () => {
    assert.throws(
      () => assertMutatingAllowed("mutating", false, "setBoardState"),
      /allowMutatingCommands/,
    );
  });

  it("allows mutating writes with the opt-in", () => {
    assert.doesNotThrow(() => assertMutatingAllowed("mutating", true, "sendMove"));
  });
});

describe("ChessUpMoveDedupe", () => {
  it("accepts the first move and drops a duplicate inside the window", () => {
    const dedupe = new ChessUpMoveDedupe(400);
    assert.equal(dedupe.accept("e2", "e4", 1000), true);
    assert.equal(dedupe.accept("e2", "e4", 1200), false);
    assert.equal(dedupe.accept("e2", "e4", 1500), true);
  });

  it("accepts a different move immediately", () => {
    const dedupe = new ChessUpMoveDedupe(400);
    assert.equal(dedupe.accept("e2", "e4", 1000), true);
    assert.equal(dedupe.accept("d2", "d4", 1050), true);
  });
});

describe("ChessUpWriteQueue", () => {
  it("runs writes in order", async () => {
    const queue = new ChessUpWriteQueue();
    const order: number[] = [];
    const a = queue.enqueue(async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
    });
    const b = queue.enqueue(async () => {
      order.push(2);
    });
    await Promise.all([a, b]);
    assert.deepEqual(order, [1, 2]);
  });

  it("rejects after close", async () => {
    const queue = new ChessUpWriteQueue();
    queue.close();
    await assert.rejects(() => queue.enqueue(async () => undefined), /closed/);
  });
});
