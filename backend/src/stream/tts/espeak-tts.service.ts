import { spawn } from 'node:child_process';
import { BaseTtsService } from './base-tts.service';

/**
 * espeak-ng engine — free, offline, tiny (`apt install espeak-ng`). Robotic
 * voice, guaranteed to fit constrained hosts. The default DJ engine.
 */
export class EspeakTtsService extends BaseTtsService {
  private readonly binPath: string;

  constructor(cacheDir: string, binPath = process.env.ESPEAK_PATH ?? 'espeak-ng') {
    super('espeak', 'default', 'wav', cacheDir);
    this.binPath = binPath;
  }

  protected render(text: string, outPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.binPath, ['-w', outPath, text], {
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      proc.stderr.on('data', (d: Buffer) => (stderr += d.toString()));
      proc.on('error', reject);
      proc.on('close', (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`espeak-ng exited ${code}: ${stderr.trim()}`)),
      );
    });
  }
}
