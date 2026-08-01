/**
 * Browser IIFE entry — board + transport only (no chess.js peer).
 * Move inference stays in the host app (or import inferMoveFromPlacements from the ESM build).
 */
export { ChessnutBoard } from "./board.js";
export { isBleSupported, isHidSupported } from "./support.js";
export type {
  BatteryStatus,
  ChessnutBoardEvents,
  ConnectOptions,
  PositionEvent,
  TransportKind,
} from "./types.js";
