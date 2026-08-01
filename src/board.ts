import { BleTransport } from "./bleTransport.js";
import { TinyEmitter } from "./emitter.js";
import { HidTransport } from "./hidTransport.js";
import type {
  BatteryStatus,
  BoardTransport,
  ChessnutBoardEvents,
  ChessnutEventName,
  ConnectOptions,
  TransportKind,
} from "./types.js";

function createTransport(kind: TransportKind): BoardTransport {
  switch (kind) {
    case "ble":
      return new BleTransport();
    case "hid":
      return new HidTransport();
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unknown transport: ${String(_exhaustive)}`);
    }
  }
}

/**
 * High-level Chessnut board facade for browser apps.
 * Transport: Web Bluetooth (`ble`) or WebHID (`hid`).
 */
export class ChessnutBoard {
  private readonly emitter = new TinyEmitter<ChessnutBoardEvents>();
  private transport: BoardTransport | null = null;
  private connecting = false;

  get connected(): boolean {
    return this.transport !== null;
  }

  get transportKind(): TransportKind | null {
    return this.transport?.kind ?? null;
  }

  on<K extends ChessnutEventName>(event: K, handler: ChessnutBoardEvents[K]): () => void {
    return this.emitter.on(event, handler);
  }

  off<K extends ChessnutEventName>(event: K, handler: ChessnutBoardEvents[K]): void {
    this.emitter.off(event, handler);
  }

  async connect(options: ConnectOptions): Promise<void> {
    if (this.connecting) {
      throw new Error("ChessnutBoard connection already in progress");
    }
    this.connecting = true;
    try {
      await this.disconnect();
      const transport = createTransport(options.transport);
      transport.onPosition((placement) => {
        this.emitter.emit("position", { placement });
      });
      transport.onDisconnect(() => {
        this.transport = null;
        this.emitter.emit("disconnect");
      });
      transport.onError((error) => {
        this.emitter.emit("error", error);
      });
      transport.onButton?.((buttonId) => {
        this.emitter.emit("button", buttonId);
      });
      await transport.connect({ reconnect: options.reconnect === true });
      this.transport = transport;
    } finally {
      this.connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    const transport = this.transport;
    this.transport = null;
    if (transport) {
      await transport.disconnect();
    }
  }

  async setLeds(squares: readonly string[]): Promise<void> {
    if (!this.transport) throw new Error("ChessnutBoard is not connected");
    await this.transport.setLeds(squares);
  }

  async getBattery(): Promise<BatteryStatus> {
    if (!this.transport) throw new Error("ChessnutBoard is not connected");
    return this.transport.getBattery();
  }
}
