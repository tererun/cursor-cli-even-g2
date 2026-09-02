export interface ScreenSnapshot {
  cols: number;
  rows: number;
  cursor: { x: number; y: number };
  lines: string[];
  text: string;
}

const UPGRADE_LIMIT = 1900;
const CURSOR_GLYPH = "█";

export function padLine(line: string, cols: number): string {
  const cells = Array.from(line ?? "");
  if (cells.length > cols) return cells.slice(0, cols).join("");
  return cells.join("").padEnd(cols, " ");
}

export function applyCursor(lines: string[], cursor: { x: number; y: number }, cols: number): string[] {
  return lines.map((line, row) => {
    const padded = padLine(line, cols);
    if (row !== cursor.y) return padded;
    const cells = Array.from(padded);
    const x = Math.max(0, Math.min(cols - 1, cursor.x));
    cells[x] = CURSOR_GLYPH;
    return cells.join("");
  });
}

export function formatScreen(
  rawLines: string[],
  cursor: { x: number; y: number },
  cols: number,
  rows: number,
): ScreenSnapshot {
  const safeCols = Math.max(2, cols);
  const safeRows = Math.max(1, rows);
  const lines = Array.from({ length: safeRows }, (_, index) => padLine(rawLines[index] ?? "", safeCols));
  const withCursor = applyCursor(lines, cursor, safeCols);
  let text = withCursor.join("\n");
  if (text.length > UPGRADE_LIMIT) text = text.slice(0, UPGRADE_LIMIT);
  return {
    cols: safeCols,
    rows: safeRows,
    cursor: {
      x: Math.max(0, Math.min(safeCols - 1, cursor.x)),
      y: Math.max(0, Math.min(safeRows - 1, cursor.y)),
    },
    lines,
    text,
  };
}
