/**
 * Browser IIFE entry — board + transport only (no chess.js peer).
 * Move inference stays in the host app (or import inferMoveFromPlacements from the ESM build).
 */
export { ChessnutBoard } from "./board.js";
export { ChessUpBoard } from "./chessupBoard.js";
export type {
  ChessUpBoardEvents,
  ChessUpConnectOptions,
  ChessUpMoveEvent,
} from "./chessupBoard.js";
export {
  assistanceColoursForHighlight,
  sortedLegalMovePairs,
} from "./chessupProtocol.js";
export type {
  ChessUpAssistanceColour,
  ChessUpMove,
  ChessUpMoveSquares,
} from "./chessupProtocol.js";
export { isBleSupported, isHidSupported } from "./support.js";
export type {
  BatteryStatus,
  ChessnutBoardEvents,
  ConnectOptions,
  PositionEvent,
  TransportKind,
} from "./types.js";
