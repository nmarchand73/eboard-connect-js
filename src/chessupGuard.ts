/**
 * Serializes ChessUp BLE writes so ACKs / polls cannot overlap and flood the board.
 */
export class ChessUpWriteQueue {
  private chain: Promise<void> = Promise.resolve();
  private closed = false;

  enqueue(task: () => Promise<void>): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error("ChessUp write queue is closed"));
    }
    const run = this.chain.then(task, task);
    // Keep the chain alive even if a write fails.
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  close(): void {
    this.closed = true;
  }

  get isClosed(): boolean {
    return this.closed;
  }
}

export type ChessUpWriteKind = "safe" | "mutating";

/** Commands that rewrite game state or push moves onto the ChessUp. */
export function assertMutatingAllowed(
  kind: ChessUpWriteKind,
  allowMutatingCommands: boolean,
  action: string,
): void {
  if (kind === "mutating" && !allowMutatingCommands) {
    throw new Error(
      `ChessUp ${action} blocked — enable allowMutatingCommands only when you intentionally control the board game state`,
    );
  }
}

/** Drop duplicate board moves within a short window (firmware often re-notifies). */
export class ChessUpMoveDedupe {
  private lastKey = "";
  private lastAt = 0;

  constructor(private readonly windowMs = 400) {}

  /** @returns true if this move should be handled (ACK + emit). */
  accept(from: string, to: string, now = Date.now()): boolean {
    const key = `${from}${to}`;
    if (key === this.lastKey && now - this.lastAt < this.windowMs) {
      return false;
    }
    this.lastKey = key;
    this.lastAt = now;
    return true;
  }

  reset(): void {
    this.lastKey = "";
    this.lastAt = 0;
  }
}
