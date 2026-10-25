// Frame geometry for the screen-guide lab (one responsibility: coordinates).
// Points and boxes are fractions of the frame, 0..1, from the top-left corner.
export const TOL = 0.02; // tolerant hit: 2% of the frame each way

const ROWS = ["top", "middle", "bottom"];
const COLS = ["left", "center", "right"];

export function normBox([x0, y0, x1, y1], [w, h]) {
  return [x0 / w, y0 / h, x1 / w, y1 / h];
}

export function cellOf(x, y) {
  const col = COLS[Math.min(2, Math.floor(x * 3))];
  const row = ROWS[Math.min(2, Math.floor(y * 3))];
  return `${row}-${col}`;
}

export function cellCenter(grid) {
  const [row, col] = grid.split("-");
  return [(COLS.indexOf(col) + 0.5) / 3, (ROWS.indexOf(row) + 0.5) / 3];
}

export function boxCenter([x0, y0, x1, y1]) {
  return [(x0 + x1) / 2, (y0 + y1) / 2];
}

export function inside([x, y], [x0, y0, x1, y1], tol = 0) {
  return x >= x0 - tol && x <= x1 + tol && y >= y0 - tol && y <= y1 + tol;
}

// The zoom window is half the frame each way, centred on the point and clamped.
export function zoomWindow([x, y], [w, h]) {
  const cw = Math.floor(w / 2);
  const ch = Math.floor(h / 2);
  const px = Math.round(x * w);
  const py = Math.round(y * h);
  const x0 = Math.min(Math.max(Math.round(px - cw / 2), 0), w - cw);
  const y0 = Math.min(Math.max(Math.round(py - ch / 2), 0), h - ch);
  return { x0, y0, cw, ch };
}

// A point answered in zoom coordinates (0..1 of the window) back to the frame.
export function unzoom([zx, zy], win, [w, h]) {
  return [(win.x0 + zx * win.cw) / w, (win.y0 + zy * win.ch) / h];
}
