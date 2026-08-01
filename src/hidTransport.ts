import {
  HID_INPUT_REPORT_ID,
  HID_REPORT_LED,
  HID_REPORT_REALTIME,
  HID_VENDOR_ID,
  CMD_ENABLE_REALTIME,
  encodeLedPayload,
  decodeBoardBytes,
} from "./protocol.js";
import { isHidSupported } from "./support.js";
import type { BatteryStatus, BoardTransport } from "./types.js";

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export class HidTransport implements BoardTransport {
  readonly kind = "hid" as const;

  private device: HIDDevice | null = null;
  private lastBoardBytes: Uint8Array | null = null;
  private positionHandler: ((placement: string) => void) | null = null;
  private disconnectHandler: (() => void) | null = null;
  private errorHandler: ((error: Error) => void) | null = null;

  private readonly onInputReport = (event: HIDInputReportEvent) => {
    try {
      if (event.reportId !== HID_INPUT_REPORT_ID) return;
      const raw = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
      // WebHID: board bytes typically occupy indices 1..32 (32 bytes).
      // Some firmwares include a leading status byte then 32 board bytes.
      let boardBytes: Uint8Array;
      if (raw.length >= 33) {
        boardBytes = raw.subarray(1, 33);
      } else if (raw.length >= 32) {
        boardBytes = raw.subarray(0, 32);
      } else {
        return;
      }
      if (this.lastBoardBytes && bytesEqual(this.lastBoardBytes, boardBytes)) return;
      this.lastBoardBytes = boardBytes.slice();
      this.positionHandler?.(decodeBoardBytes(boardBytes));
    } catch (err) {
      this.errorHandler?.(err instanceof Error ? err : new Error(String(err)));
    }
  };

  private readonly onDisconnected = (event: Event) => {
    const disconnected = (event as HIDConnectionEvent).device;
    if (this.device && disconnected !== this.device) return;
    this.cleanupConnection();
    this.disconnectHandler?.();
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

  async connect(): Promise<void> {
    if (!isHidSupported()) {
      throw new Error("WebHID is not available in this browser");
    }

    await this.disconnect();

    const devices = await navigator.hid.requestDevice({
      filters: [{ vendorId: HID_VENDOR_ID }],
    });
    const device = devices[0];
    if (!device) {
      throw new Error("No Chessnut HID device selected");
    }

    await device.open();
    this.device = device;
    device.addEventListener("inputreport", this.onInputReport);
    navigator.hid.addEventListener("disconnect", this.onDisconnected);

    // Realtime enable: reportId 0x21, payload [0x01, 0x00]
    const realtimePayload = CMD_ENABLE_REALTIME.slice(1);
    await device.sendReport(HID_REPORT_REALTIME, realtimePayload);
  }

  async disconnect(): Promise<void> {
    const device = this.device;
    this.cleanupConnection();
    if (device?.opened) {
      await device.close();
    }
  }

  async setLeds(squares: readonly string[]): Promise<void> {
    if (!this.device?.opened) throw new Error("Chessnut HID board is not connected");
    const ledBytes = encodeLedPayload(squares);
    const payload = new Uint8Array(1 + ledBytes.length);
    payload[0] = 0x08;
    payload.set(ledBytes, 1);
    await this.device.sendReport(HID_REPORT_LED, payload);
  }

  async getBattery(): Promise<BatteryStatus> {
    // USB HID path does not expose a documented battery query in the browser API.
    throw new Error("Battery status is only available over Bluetooth");
  }

  private cleanupConnection(): void {
    try {
      this.device?.removeEventListener("inputreport", this.onInputReport);
      navigator.hid?.removeEventListener("disconnect", this.onDisconnected);
    } catch {
      // ignore
    }
    this.device = null;
    this.lastBoardBytes = null;
  }
}
