export type TransportKind = "ble" | "hid";

export type PositionEvent = {
  /** FEN piece placement only (no side-to-move / castling / clocks). */
  placement: string;
};

export type BatteryStatus = {
  percent: number;
  charging: boolean;
};

export type ChessnutBoardEvents = {
  position: (event: PositionEvent) => void;
  disconnect: () => void;
  error: (error: Error) => void;
  button: (buttonId: number) => void;
};

export type ChessnutEventName = keyof ChessnutBoardEvents;

export type ConnectOptions = {
  transport: TransportKind;
};

export interface BoardTransport {
  readonly kind: TransportKind;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  setLeds(squares: readonly string[]): Promise<void>;
  getBattery(): Promise<BatteryStatus>;
  onPosition(handler: (placement: string) => void): void;
  onDisconnect(handler: () => void): void;
  onError(handler: (error: Error) => void): void;
  onButton?(handler: (buttonId: number) => void): void;
}
