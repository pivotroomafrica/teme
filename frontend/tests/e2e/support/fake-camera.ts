import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import QRCode from "qrcode";

const WIDTH = 640;
const HEIGHT = 480;
const FRAMES = 5;

/**
 * Writes a short video (Y4M, which Chromium can play as a fake camera) that shows one QR code, so a real browser
 * "scans" a real picture through its real camera pipeline. Pass the file to Chromium with
 * `--use-file-for-fake-video-capture=<path>`.
 */
export function writeQrVideo(text: string): string {
  const { size, data } = QRCode.create(text, { errorCorrectionLevel: "M" }).modules;
  const quiet = 4;
  const scale = Math.floor(Math.min(WIDTH, HEIGHT) / (size + quiet * 2));
  const side = (size + quiet * 2) * scale;
  const left = Math.floor((WIDTH - side) / 2);
  const top = Math.floor((HEIGHT - side) / 2);

  const luma = new Uint8Array(WIDTH * HEIGHT).fill(255);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!data[y * size + x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          luma[(top + (y + quiet) * scale + dy) * WIDTH + left + (x + quiet) * scale + dx] = 0;
        }
      }
    }
  }
  const chroma = new Uint8Array((WIDTH / 2) * (HEIGHT / 2)).fill(128);
  const frame = Buffer.concat([Buffer.from("FRAME\n"), luma, chroma, chroma]);
  const header = Buffer.from(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F10:1 Ip A1:1 C420jpeg\n`);
  const file = join(mkdtempSync(join(tmpdir(), "tc-fake-camera-")), "qr.y4m");
  writeFileSync(file, Buffer.concat([header, ...Array.from({ length: FRAMES }, () => frame)]));
  return file;
}

/** Chromium switches that make `getUserMedia` return the given video instead of a real camera. */
export const fakeCameraArgs = (videoFile: string) => [
  "--use-fake-device-for-media-stream",
  "--use-fake-ui-for-media-stream",
  `--use-file-for-fake-video-capture=${videoFile}`,
];
