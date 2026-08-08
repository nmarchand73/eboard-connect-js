import {
  assertMutatingAllowed,
  ChessUpMoveDedupe,
  ChessUpWriteQueue,
} from "./chessupGuard.js";
import {
  CHESSUP_NOTIFY_UUID,
  CHESSUP_SERVICE_UUID,
  CHESSUP_WRITE_UUID,
  encodeAssistance,
  encodeGetState,
  encodeMoveAck,
  encodePromotionAck,
  encodeSendMove,
  encodeSetState,
  feedChessUpBuffer,
  type ChessUpAssistanceColour,
  type ChessUpBoardState,
  type ChessUpMove,
  type ChessUpParsedMessage,
} from "./chessupProtocol.js";
import { isBleSupported } from "./support.js";
import type { BatteryStatus } from "./types.js";

function isChessUpDevice(device: BluetoothDevice): boolean {
  const name = (device.name || "").toLowerCase();
  return name.includes("chessup");
}

async function waitForAdvertisement(
  device: BluetoothDevice,
  timeoutMs: number,
): Promise<void> {
  const watchable = device as BluetoothDevice & {
    watchAdvertisements?: () => Promise<void>;
  };
  if (typeof watchable.watchAdvertisements !== "function") {
    return;
  }

  await watchable.watchAdvertisements();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for ChessUp BLE advertisement"));
    }, timeoutMs);

    const onAdv = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timer);
      device.removeEventListener("advertisementreceived", onAdv);
    };
    device.addEventListener("advertisementreceived", onAdv);
  });
}

async function connectGatt(
  device: BluetoothDevice,
  timeoutMs = 15000,
  reconnect = false,
): Promise<BluetoothRemoteGATTServer> {
  if (!device.gatt) {
    throw new Error("Bluetooth device has no GATT server");
  }
  if (device.gatt.connected) {
    return device.gatt;
  }

  if (reconnect) {
    try {
      await waitForAdvertisement(device, Math.min(timeoutMs, 10000));
    } catch {
      // still attempt direct connect
    }
  }

  try {
    return await device.gatt.connect();
  } catch (firstErr) {
    try {
      await waitForAdvertisement(device, timeoutMs);
      return await device.gatt.connect();
    } catch {
      throw firstErr instanceof Error ? firstErr : new Error(String(firstErr));
    }
  }
}

function toBufferSource(bytes: Uint8Array): BufferSource {
  return bytes.slice().buffer;
}

export type ChessUpBleTransportOptions = {
  /**
   * Allow CMD_SEND_MOVE / CMD_SET_STATE (can rewrite the ChessUp game).
   * Default false — listen + ACK + getState only.
   */
  allowMutatingCommands?: boolean;
  /**
   * Allow CMD_ASSISTANCE (0x10) to paint legal-move hint colours.
   * Also implied when `allowMutatingCommands` is true.
   */
  allowAssistanceLights?: boolean;
};

/**
 * ChessUp Web Bluetooth transport over Nordic UART Service.
 * Default mode is listen-only: ACKs moves, polls state, never pushes moves/FEN
 * unless `allowMutatingCommands` is set.
 */
export class ChessUpBleTransport {
  private device: BluetoothDevice | null = null;
  private writeChar: BluetoothRemoteGATTCharacteristic | null = null;
  private notifyChar: BluetoothRemoteGATTCharacteristic | null = null;
  private batteryChar: BluetoothRemoteGATTCharacteristic | null = null;
  private rxBuffer = new Uint8Array(0);
  private writeQueue = new ChessUpWriteQueue();
  private readonly moveDedupe = new ChessUpMoveDedupe();
  private readonly allowMutatingCommands: boolean;
  private readonly allowAssistanceLights: boolean;

  private boardStateHandler: ((state: ChessUpBoardState) => void) | null = null;
  private moveHandler: ((move: ChessUpMove) => void) | null = null;
  private touchHandler: ((square: string, piece: string | null) => void) | null = null;
  private promotionHandler: ((piece: string | null) => void) | null = null;
  private disconnectHandler: (() => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private probeHandler: ((bytes: Uint8Array, messages: ChessUpParsedMessage[]) => void) | null =
    null;

  constructor(options: ChessUpBleTransportOptions = {}) {
    this.allowMutatingCommands = options.allowMutatingCommands === true;
    this.allowAssistanceLights =
      options.allowAssistanceLights === true || this.allowMutatingCommands;
  }

  private readonly onGattDisconnected = () => {
    this.cleanupConnection();
    this.disconnectHandler?.();
  };

  private readonly onNotifyValue = (event: Event) => {
    try {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;
      const chunk = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      const { buffer, messages } = feedChessUpBuffer(this.rxBuffer, chunk);
      this.rxBuffer = new Uint8Array(buffer);
      this.probeHandler?.(chunk, messages);

      for (const msg of messages) {
        switch (msg.kind) {
          case "boardState":
            this.boardStateHandler?.(msg.state);
            break;
          case "move": {
            if (!this.moveDedupe.accept(msg.move.from, msg.move.to)) {
              break;
            }
            // ACK promptly so the ChessUp does not stall waiting for the host.
            void this.writeSafe(encodeMoveAck()).catch((err) => {
              this.errorHandler?.(err instanceof Error ? err : new Error(String(err)));
            });
            this.moveHandler?.(msg.move);
            break;
          }
          case "promotion":
            void this.writeSafe(encodePromotionAck()).catch((err) => {
              this.errorHandler?.(err instanceof Error ? err : new Error(String(err)));
            });
            this.promotionHandler?.(msg.piece);
            break;
          case "touch":
            this.touchHandler?.(msg.square, msg.piece);
            break;
          case "ack":
          case "unknown":
            break;
          default: {
            const _exhaustive: never = msg;
            void _exhaustive;
          }
        }
      }
    } catch (err) {
      this.errorHandler?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  onBoardState(handler: (state: ChessUpBoardState) => void): void {
    this.boardStateHandler = handler;
  }

  onMove(handler: (move: ChessUpMove) => void): void {
    this.moveHandler = handler;
  }

  onTouch(handler: (square: string, piece: string | null) => void): void {
    this.touchHandler = handler;
  }

  onPromotion(handler: (piece: string | null) => void): void {
    this.promotionHandler = handler;
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandler = handler;
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  /** Optional raw notify probe hook (hex dumps / debugging). */
  onProbe(handler: (bytes: Uint8Array, messages: ChessUpParsedMessage[]) => void): void {
    this.probeHandler = handler;
  }

  async connect(options?: { reconnect?: boolean }): Promise<void> {
    if (!isBleSupported()) {
      throw new Error("Web Bluetooth is not available in this browser");
    }

    await this.disconnect();
    this.writeQueue = new ChessUpWriteQueue();
    this.moveDedupe.reset();

    const device = options?.reconnect
      ? await this.pickRememberedDevice()
      : await this.requestNewDevice();

    this.device = device;
    device.addEventListener("gattserverdisconnected", this.onGattDisconnected);

    const server = await connectGatt(device, 15000, options?.reconnect === true);
    await this.bindServices(server);
    await this.requestBoardState();
  }

  private async requestNewDevice(): Promise<BluetoothDevice> {
    return navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "ChessUp" }, { services: [CHESSUP_SERVICE_UUID] }],
      optionalServices: [CHESSUP_SERVICE_UUID, "battery_service"],
    });
  }

  private async pickRememberedDevice(): Promise<BluetoothDevice> {
    if (typeof navigator.bluetooth.getDevices !== "function") {
      throw new Error("Bluetooth getDevices() is not supported in this browser");
    }
    const devices = await navigator.bluetooth.getDevices();
    const chessup = devices.find((d) => isChessUpDevice(d));
    const device = chessup ?? (devices.length === 1 ? devices[0] : undefined);
    if (!device) {
      throw new Error(
        devices.length
          ? "Granted BLE device is not a ChessUp — connect once with the chooser"
          : "No previously paired ChessUp BLE device — connect once with the chooser",
      );
    }
    return device;
  }

  private async bindServices(server: BluetoothRemoteGATTServer): Promise<void> {
    const uart = await server.getPrimaryService(CHESSUP_SERVICE_UUID);
    this.writeChar = await uart.getCharacteristic(CHESSUP_WRITE_UUID);
    this.notifyChar = await uart.getCharacteristic(CHESSUP_NOTIFY_UUID);
    this.notifyChar.addEventListener("characteristicvaluechanged", this.onNotifyValue);
    await this.notifyChar.startNotifications();

    try {
      const batteryService = await server.getPrimaryService("battery_service");
      this.batteryChar = await batteryService.getCharacteristic("battery_level");
    } catch {
      this.batteryChar = null;
    }
  }

  private async writeSafe(bytes: Uint8Array): Promise<void> {
    assertMutatingAllowed("safe", this.allowMutatingCommands, "write");
    if (!this.writeChar) throw new Error("ChessUp BLE board is not connected");
    const char = this.writeChar;
    await this.writeQueue.enqueue(async () => {
      if (!this.writeChar) throw new Error("ChessUp BLE board is not connected");
      await char.writeValueWithResponse(toBufferSource(bytes));
    });
  }

  private async writeMutating(action: string, bytes: Uint8Array): Promise<void> {
    assertMutatingAllowed("mutating", this.allowMutatingCommands, action);
    if (!this.writeChar) throw new Error("ChessUp BLE board is not connected");
    const char = this.writeChar;
    await this.writeQueue.enqueue(async () => {
      if (!this.writeChar) throw new Error("ChessUp BLE board is not connected");
      await char.writeValueWithResponse(toBufferSource(bytes));
    });
  }

  async requestBoardState(): Promise<void> {
    await this.writeSafe(encodeGetState());
  }

  async sendMove(from: string, to: string): Promise<void> {
    await this.writeMutating("sendMove", encodeSendMove(from, to));
  }

  /**
   * Unofficial: paint assistance colours for sorted legal moves (CMD 0x10).
   * Requires `allowAssistanceLights` or `allowMutatingCommands`.
   */
  async sendAssistance(colours: readonly ChessUpAssistanceColour[]): Promise<void> {
    if (!this.allowAssistanceLights) {
      throw new Error(
        "ChessUp sendAssistance blocked — enable allowAssistanceLights (or allowMutatingCommands)",
      );
    }
    if (!this.writeChar) throw new Error("ChessUp BLE board is not connected");
    const char = this.writeChar;
    const bytes = encodeAssistance(colours);
    await this.writeQueue.enqueue(async () => {
      if (!this.writeChar) throw new Error("ChessUp BLE board is not connected");
      await char.writeValueWithResponse(toBufferSource(bytes));
    });
  }

  /**
   * Dangerous: loads a FEN into the ChessUp computer. Requires
   * `allowMutatingCommands` at construction.
   */
  async setBoardState(fen: string): Promise<void> {
    await this.writeMutating("setBoardState", encodeSetState(fen));
  }

  async getBattery(): Promise<BatteryStatus> {
    if (!this.batteryChar) {
      throw new Error("ChessUp battery characteristic is not available");
    }
    const value = await this.batteryChar.readValue();
    const percent = value.getUint8(0);
    return { percent, charging: false };
  }

  async disconnect(): Promise<void> {
    const device = this.device;
    this.cleanupConnection();
    if (device?.gatt?.connected) {
      device.gatt.disconnect();
    }
  }

  private cleanupConnection(): void {
    this.writeQueue.close();
    this.moveDedupe.reset();
    try {
      this.notifyChar?.removeEventListener("characteristicvaluechanged", this.onNotifyValue);
    } catch {
      // ignore
    }
    this.device?.removeEventListener("gattserverdisconnected", this.onGattDisconnected);
    this.device = null;
    this.writeChar = null;
    this.notifyChar = null;
    this.batteryChar = null;
    this.rxBuffer = new Uint8Array(0);
  }
}
