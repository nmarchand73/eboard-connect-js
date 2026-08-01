import {
  CMD_ENABLE_REALTIME,
  CMD_GET_BATTERY,
  FEN_CHARACTERISTIC_UUID,
  FEN_SERVICE_UUID,
  OPS_NOTIFY_CHARACTERISTIC_UUID,
  OPS_SERVICE_UUID,
  OPS_WRITE_CHARACTERISTIC_UUID,
  buildLedCommand,
  decodeFenNotification,
  isBatteryPacket,
  isBoardDataPacket,
  parseBatteryPayload,
} from "./protocol.js";
import { isBleSupported } from "./support.js";
import type { BatteryStatus, BoardTransport } from "./types.js";

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export class BleTransport implements BoardTransport {
  readonly kind = "ble" as const;

  private device: BluetoothDevice | null = null;
  private writeChar: BluetoothRemoteGATTCharacteristic | null = null;
  private fenChar: BluetoothRemoteGATTCharacteristic | null = null;
  private notifyChar: BluetoothRemoteGATTCharacteristic | null = null;
  private lastBoardBytes: Uint8Array | null = null;
  private positionHandler: ((placement: string) => void) | null = null;
  private disconnectHandler: (() => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;
  private buttonHandler: ((buttonId: number) => void) | null = null;
  private batteryWaiters: Array<{
    resolve: (status: BatteryStatus) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }> = [];

  private readonly onGattDisconnected = () => {
    this.cleanupConnection();
    this.disconnectHandler?.();
  };

  private readonly onFenValue = (event: Event) => {
    try {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;
      const data = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      if (!isBoardDataPacket(data) && data.length < 34) return;
      const boardBytes = data.subarray(2, 34);
      if (this.lastBoardBytes && bytesEqual(this.lastBoardBytes, boardBytes)) return;
      this.lastBoardBytes = boardBytes.slice();
      const placement = decodeFenNotification(data);
      this.positionHandler?.(placement);
    } catch (err) {
      this.errorHandler?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  private readonly onNotifyValue = (event: Event) => {
    try {
      const value = (event.target as BluetoothRemoteGATTCharacteristic).value;
      if (!value) return;
      const data = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      if (isBatteryPacket(data)) {
        const status = parseBatteryPayload(data.subarray(2));
        for (const waiter of this.batteryWaiters.splice(0)) {
          clearTimeout(waiter.timer);
          waiter.resolve(status);
        }
        return;
      }
      if (data.length >= 3 && data[0] === 0x0f && data[1] === 0x01) {
        this.buttonHandler?.(data[2]!);
      }
    } catch (err) {
      this.errorHandler?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  onPosition(handler: (placement: string) => void): void {
    this.positionHandler = handler;
  }

  onDisconnect(handler: () => void): void {
    this.disconnectHandler = handler;
  }

  onError(handler: (error: Error) => void): void {
    this.errorHandler = handler;
  }

  onButton(handler: (buttonId: number) => void): void {
    this.buttonHandler = handler;
  }

  async connect(): Promise<void> {
    if (!isBleSupported()) {
      throw new Error("Web Bluetooth is not available in this browser");
    }

    await this.disconnect();

    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: "Chessnut" },
        { services: [FEN_SERVICE_UUID] },
      ],
      optionalServices: [FEN_SERVICE_UUID, OPS_SERVICE_UUID],
    });

    this.device = device;
    device.addEventListener("gattserverdisconnected", this.onGattDisconnected);

    const server = await device.gatt!.connect();

    const fenService = await server.getPrimaryService(FEN_SERVICE_UUID);
    const opsService = await server.getPrimaryService(OPS_SERVICE_UUID);

    this.fenChar = await fenService.getCharacteristic(FEN_CHARACTERISTIC_UUID);
    this.writeChar = await opsService.getCharacteristic(OPS_WRITE_CHARACTERISTIC_UUID);
    this.notifyChar = await opsService.getCharacteristic(OPS_NOTIFY_CHARACTERISTIC_UUID);

    this.fenChar.addEventListener("characteristicvaluechanged", this.onFenValue);
    this.notifyChar.addEventListener("characteristicvaluechanged", this.onNotifyValue);

    await this.fenChar.startNotifications();
    await this.notifyChar.startNotifications();
    await this.writeChar.writeValueWithoutResponse(toBufferSource(CMD_ENABLE_REALTIME));
  }

  async disconnect(): Promise<void> {
    this.rejectBatteryWaiters(new Error("Disconnected"));
    const device = this.device;
    this.cleanupConnection();
    if (device?.gatt?.connected) {
      device.gatt.disconnect();
    }
  }

  async setLeds(squares: readonly string[]): Promise<void> {
    if (!this.writeChar) throw new Error("Chessnut BLE board is not connected");
    await this.writeChar.writeValueWithoutResponse(toBufferSource(buildLedCommand(squares)));
  }

  async getBattery(): Promise<BatteryStatus> {
    if (!this.writeChar) throw new Error("Chessnut BLE board is not connected");

    return new Promise<BatteryStatus>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.batteryWaiters.findIndex((w) => w.timer === timer);
        if (idx >= 0) this.batteryWaiters.splice(idx, 1);
        reject(new Error("Battery query timed out"));
      }, 2000);

      this.batteryWaiters.push({ resolve, reject, timer });
      this.writeChar!.writeValueWithoutResponse(toBufferSource(CMD_GET_BATTERY)).catch((err) => {
        clearTimeout(timer);
        const idx = this.batteryWaiters.findIndex((w) => w.timer === timer);
        if (idx >= 0) this.batteryWaiters.splice(idx, 1);
        reject(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }

  private rejectBatteryWaiters(error: Error): void {
    for (const waiter of this.batteryWaiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  private cleanupConnection(): void {
    this.rejectBatteryWaiters(new Error("Disconnected"));
    try {
      this.fenChar?.removeEventListener("characteristicvaluechanged", this.onFenValue);
      this.notifyChar?.removeEventListener("characteristicvaluechanged", this.onNotifyValue);
    } catch {
      // ignore
    }
    this.device?.removeEventListener("gattserverdisconnected", this.onGattDisconnected);
    this.device = null;
    this.writeChar = null;
    this.fenChar = null;
    this.notifyChar = null;
    this.lastBoardBytes = null;
  }
}

function toBufferSource(bytes: Uint8Array): BufferSource {
  return bytes.slice().buffer;
}
