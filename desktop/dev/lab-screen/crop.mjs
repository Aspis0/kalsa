// Zoom crops for the second pass (one responsibility: pixels). The window is cut
// from the NATIVE capture and enlarged 2x, so the second pass spends the same
// image-token budget as the first and sees each element at twice the scale.
import { execFileSync } from "node:child_process";

export function cropZoom(nativePath, win, outPath) {
  const cropped = `${outPath}.crop.png`;
  execFileSync("sips", ["-c", String(win.ch), String(win.cw), "--cropOffset", String(win.y0), String(win.x0), nativePath, "--out", cropped], { stdio: "ignore" });
  execFileSync("sips", ["-z", String(win.ch * 2), String(win.cw * 2), cropped, "--out", outPath], { stdio: "ignore" });
  return outPath;
}
