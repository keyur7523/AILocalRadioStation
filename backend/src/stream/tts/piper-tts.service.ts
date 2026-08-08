import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { BaseTtsService } from './base-tts.service';

/**
 * Piper engine — free, offline, neural (natural voice). Needs the `piper` binary
 * and a `.onnx` voice model provisioned in the image. Reads text on stdin and
 * writes a WAV to `-f`. Enable with DJ_TTS_ENGINE=piper.
 */
export class PiperTtsService extends BaseTtsService {
  private readonly binPath: string;
  private readonly modelPath: string;

  constructor(
    cacheDir: string,
    modelPath: string,
    binPath = process.env.PIPER_PATH ?? 'piper',
  ) {
    super('piper', basename(modelPath), 'wav', cacheDir);
    this.modelPath = modelPath;
    this.binPath = binPath;
  }

  protected render(text: string, outPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.binPath, ['-m', this.modelPath, '-f', outPath], {
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      let stderr = '';
      proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      proc.on('error', reject);
      proc.on('close', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`piper exited ${code}: ${stderr.trim()}`)),
      );
      proc.stdin.write(text);
      proc.stdin.end();
    });
  }
}
