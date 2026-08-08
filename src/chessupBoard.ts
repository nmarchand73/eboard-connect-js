import { ChessUpBleTransport } from "./chessupBleTransport.js";
import type {
  ChessUpAssistanceColour,
  ChessUpBoardState,
  ChessUpMove,
} from "./chessupProtocol.js";
import { TinyEmitter } from "./emitter.js";
import type { BatteryStatus } from "./types.js";

export type ChessUpMoveEvent = ChessUpMove;
export type ChessUpBoardStateEvent = ChessUpBoardState;
export type ChessUpTouchEvent = { square: string; piece: string | null };
export type ChessUpPromotionEvent = { piece: string | null };
export type ChessUpProbeEvent = { hex: string; summary: string };

export type ChessUpBoardEvents = {
  boardState: (event: ChessUpBoardStateEvent) => void;
  /** Placement-only convenience (same as boardState.placement). */
  position: (event: { placement: string }) => void;
  move: (event: ChessUpMoveEvent) => void;
  touch: (event: ChessUpTouchEvent) => void;
  promotion: (event: ChessUpPromotionEvent) => void;
  /** Raw BLE notify dump for the probe / debugging. */
  probe: (event: ChessUpProbeEvent) => void;
  disconnect: () => void;
  error: (error: Error) => void;
};

export type ChessUpEventName = keyof ChessUpBoardEvents;

export type ChessUpConnectOptions = {
  /** Reuse a previously permitted device (no chooser). */
  reconnect?: boolean;
  /** Emit raw notify `probe` events (hex + parse summary). */
  probe?: boolean;
  /**
   * Allow pushing moves / FEN onto the ChessUp (can desync physical pieces).
   * Default false — host listens and ACKs only.
   */
  allowMutatingCommands?: boolean;
  /**
   * Allow unofficial CMD_ASSISTANCE lights (legal-move hint colours).
   * Implied by `allowMutatingCommands`. Default false.
   */
  allowAssistanceLights?: boolean;
};

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join(" ");
}

/**
 * High-level ChessUp board facade (Web Bluetooth / Nordic UART).
 * The board resolves moves onboard — prefer the `move` event over placement inference.
 *
 * By default this is listen-only (get state + ACK). Opt into
 * `allowAssistanceLights` for hint colours, or `allowMutatingCommands` for
 * sendMove / setBoardState.
 */
export class ChessUpBoard {
  private readonly emitter = new TinyEmitter<ChessUpBoardEvents>();
  private transport: ChessUpBleTransport | null = null;
  private connecting = false;
  private lastState: ChessUpBoardState | null = null;
  private allowMutatingCommands = false;
  private allowAssistanceLights = false;

  get connected(): boolean {
    return this.transport !== null;
  }

  get lastBoardState(): ChessUpBoardState | null {
    return this.lastState;
  }

  get mutatingCommandsEnabled(): boolean {
    return this.allowMutatingCommands;
  }

  get assistanceLightsEnabled(): boolean {
    return this.allowAssistanceLights;
  }

  on<K extends ChessUpEventName>(event: K, handler: ChessUpBoardEvents[K]): () => void {
    return this.emitter.on(event, handler);
  }

  off<K extends ChessUpEventName>(event: K, handler: ChessUpBoardEvents[K]): void {
    this.emitter.off(event, handler);
  }

  async connect(options: ChessUpConnectOptions = {}): Promise<void> {
    if (this.connecting) {
      throw new Error("ChessUpBoard connection already in progress");
    }
    this.connecting = true;
    try {
      await this.disconnect();
      this.allowMutatingCommands = options.allowMutatingCommands === true;
      this.allowAssistanceLights =
        options.allowAssistanceLights === true || this.allowMutatingCommands;
      const transport = new ChessUpBleTransport({
        allowMutatingCommands: this.allowMutatingCommands,
        allowAssistanceLights: this.allowAssistanceLights,
      });
      transport.onBoardState((state) => {
        this.lastState = state;
        this.emitter.emit("boardState", state);
        this.emitter.emit("position", { placement: state.placement });
      });
      transport.onMove((move) => {
        this.emitter.emit("move", move);
      });
      transport.onTouch((square, piece) => {
        this.emitter.emit("touch", { square, piece });
      });
      transport.onPromotion((piece) => {
        this.emitter.emit("promotion", { piece });
      });
      transport.onDisconnect(() => {
        this.transport = null;
        this.lastState = null;
        this.emitter.emit("disconnect");
      });
      transport.onError((error) => {
        this.emitter.emit("error", error);
      });
      if (options.probe) {
        transport.onProbe((bytes, messages) => {
          const summary =
            messages.length === 0
              ? "(framing)"
              : messages.map((m) => m.kind).join(",");
          this.emitter.emit("probe", { hex: bytesToHex(bytes), summary });
        });
      }
      await transport.connect({ reconnect: options.reconnect === true });
      this.transport = transport;
    } finally {
      this.connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    const transport = this.transport;
    this.transport = null;
    this.lastState = null;
    this.allowMutatingCommands = false;
    this.allowAssistanceLights = false;
    if (transport) {
      await transport.disconnect();
    }
  }

  async requestBoardState(): Promise<void> {
    if (!this.transport) throw new Error("ChessUpBoard is not connected");
    await this.transport.requestBoardState();
  }

  async sendMove(from: string, to: string): Promise<void> {
    if (!this.transport) throw new Error("ChessUpBoard is not connected");
    await this.transport.sendMove(from, to);
  }

  /**
   * Unofficial legal-move assistance lights (red/blue/green). Requires
   * `allowAssistanceLights` or `allowMutatingCommands` on connect.
   * Pass `[]` to clear when the firmware accepts an empty vector.
   */
  async sendAssistance(colours: readonly ChessUpAssistanceColour[]): Promise<void> {
    if (!this.transport) throw new Error("ChessUpBoard is not connected");
    await this.transport.sendAssistance(colours);
  }

  /**
   * Dangerous: loads a FEN into the ChessUp. Requires `allowMutatingCommands`
   * on connect.
   */
  async setBoardState(fen: string): Promise<void> {
    if (!this.transport) throw new Error("ChessUpBoard is not connected");
    await this.transport.setBoardState(fen);
  }

  async getBattery(): Promise<BatteryStatus> {
    if (!this.transport) throw new Error("ChessUpBoard is not connected");
    return this.transport.getBattery();
  }
}
