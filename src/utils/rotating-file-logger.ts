import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "fs";
import { join } from "path";

export interface RotatingFileLoggerOptions {
  /** Directory to store log files. Default 'logs' */
  dirname?: string;
  /** Base filename for logs. Default 'gateway.log' */
  filename?: string;
  /** Max size in bytes before rotating. Default 5MB */
  maxSize?: number;
  /** Max number of rotated log files to keep. Default 5 */
  maxFiles?: number;
}

export function createRotatingFileLogger(
  options: RotatingFileLoggerOptions = {},
) {
  const dir = options.dirname || "logs";
  const base = options.filename || "gateway.log";
  const maxSize = options.maxSize ?? 5 * 1024 * 1024; // 5MB
  const maxFiles = options.maxFiles ?? 5;

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let filePath = join(dir, base);
  let stream = createWriteStream(filePath, { flags: "a" });
  let currentSize = existsSync(filePath) ? statSync(filePath).size : 0;

  function rotate() {
    stream.end();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const rotatedPath = join(dir, `${base}.${timestamp}`);
    renameSync(filePath, rotatedPath);
    // Remove old rotated files if exceeding maxFiles
    const files = readdirSync(dir)
      .filter((f) => f.startsWith(base + "."))
      .sort();
    while (files.length >= maxFiles) {
      const old = files.shift();
      if (old) {
        unlinkSync(join(dir, old));
      }
    }
    stream = createWriteStream(filePath, { flags: "a" });
    currentSize = 0;
  }

  return (message: string) => {
    try {
      const bytes = Buffer.byteLength(message + "\n");
      stream.write(message + "\n");
      currentSize += bytes;
      if (currentSize >= maxSize) {
        rotate();
      }
    } catch (err) {
      console.error("Failed to write log file:", err);
    }
  };
}
