import { Chess, type Color } from "chess.js";

/**
 * Infer a unique legal SAN move that transforms `beforePlacement` into `afterPlacement`.
 * Returns `null` when zero or multiple legal moves match (e.g. piece in transit).
 *
 * Requires peer dependency `chess.js`.
 */
export function inferMoveFromPlacements(
  beforePlacement: string,
  afterPlacement: string,
  turn: Color = "w",
): string | null {
  if (beforePlacement === afterPlacement) return null;

  const beforeFen = `${beforePlacement} ${turn} - - 0 1`;
  let chess: Chess;
  try {
    chess = new Chess(beforeFen);
  } catch {
    return null;
  }

  const matches: string[] = [];
  for (const move of chess.moves({ verbose: true })) {
    const probe = new Chess(beforeFen);
    probe.move(move);
    if (probe.board() && placementOf(probe) === afterPlacement) {
      matches.push(move.san);
    }
  }

  return matches.length === 1 ? matches[0]! : null;
}

function placementOf(chess: Chess): string {
  return chess.fen().split(" ")[0]!;
}
