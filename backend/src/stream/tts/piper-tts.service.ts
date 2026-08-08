import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { BaseTtsService } from './base-tts.service';

/**
 * Piper engine — free, offline, neural (natural voice). Needs the `piper` binary
 * and a `.onnx` voice model provisioned in the image. Reads text on stdin and
 * writes a WAV to `-f`. Enable with DJ_TTS_ENGINE=piper.
 *
 * The model is resolved per call rather than fixed at construction, so the voice
 * can be switched live. Because the cache key includes the voice, each voice
 * keeps its own clips and switching back is instant.
 */
export class PiperTtsService extends BaseTtsService {
  private readonly binPath: string;
  private readonly resolveModel: () => string;

  /**
   * @param resolveModel path to the `.onnx` model, or a function returning it
   *                     (use the function form to allow live switching)
   */
  constructor(
    cacheDir: string,
    resolveModel: string | (() => string),
    binPath = process.env.PIPER_PATH ?? 'piper',
  ) {
    super('piper', 'wav', cacheDir);
    this.resolveModel =
      typeof resolveModel === 'string' ? () => resolveModel : resolveModel;
    this.binPath = binPath;
  }

  protected get variant(): string {
    return basename(this.resolveModel(), '.onnx');
  }

  protected render(text: string, outPath: string): Promise<void> {
    const modelPath = this.resolveModel();
    return new Promise((resolve, reject) => {
      const proc = spawn(this.binPath, ['-m', modelPath, '-f', outPath], {
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
