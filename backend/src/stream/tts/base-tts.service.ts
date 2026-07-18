import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { TtsService } from './tts.interface';

/**
 * Shared TTS plumbing: a content-addressed clip cache and an in-flight guard, so
 * an identical phrase is synthesized at most once and concurrent requests for it
 * share a single synth. Engines implement only {@link render}.
 */
export abstract class BaseTtsService implements TtsService {
  private readonly logger: Logger;
  private readonly inFlight = new Map<string, Promise<string>>();

  /**
   * @param engine    short engine id, part of the cache key (e.g. 'espeak')
   * @param variant   engine variant (e.g. voice name) so a voice change re-synths
   * @param extension output file extension (e.g. 'wav')
   * @param cacheDir  directory for cached clips (created if missing)
   */
  constructor(
    private readonly engine: string,
    private readonly variant: string,
    private readonly extension: string,
    protected readonly cacheDir: string,
  ) {
    this.logger = new Logger(`Tts:${engine}`);
    mkdirSync(cacheDir, { recursive: true });
  }

  /** Engine-specific synthesis: write `text` as audio to `outPath`. */
  protected abstract render(text: string, outPath: string): Promise<void>;

  async synthesize(text: string): Promise<string> {
    const key = createHash('sha1')
      .update(`${this.engine}:${this.variant}:${text}`)
      .digest('hex')
      .slice(0, 16);
    const outPath = join(this.cacheDir, `${this.engine}-${key}.${this.extension}`);

    if (existsSync(outPath)) return outPath;

    const pending = this.inFlight.get(outPath);
    if (pending) return pending;

    const startedAt = Date.now();
    const task = this.render(text, outPath)
      .then(() => {
        if (!existsSync(outPath)) {
          throw new Error('TTS produced no output file');
        }
        this.logger.log(`synthesized "${text}" in ${Date.now() - startedAt}ms`);
        return outPath;
      })
      .finally(() => this.inFlight.delete(outPath));

    this.inFlight.set(outPath, task);
    return task;
  }
}
