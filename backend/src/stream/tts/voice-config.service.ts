import { Injectable, Logger } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { loadStreamConfig } from '../stream.config';
import { discoverVoices, type VoiceInfo } from './voices';

/**
 * Which DJ voice is on air. Seeded from env, switchable live via the admin API,
 * and persisted so the choice survives a restart.
 *
 * Deliberately a plain class as well as a Nest provider: build-time tooling
 * constructs it directly to pre-generate clips for every installed voice.
 */
@Injectable()
export class VoiceConfigService {
  private readonly logger = new Logger(VoiceConfigService.name);
  private readonly stateFile =
    process.env.DJ_VOICE_STATE_FILE ?? '/tmp/radio-voice.json';
  private readonly voices: VoiceInfo[];
  private selectedId?: string;

  constructor() {
    const { dj } = loadStreamConfig();
    this.voices = discoverVoices(dj.voicesDir);
    this.selectedId =
      this.loadPersisted() ??
      // Seed from the configured model path, so DJ_VOICE_MODEL still works.
      this.voices.find((v) => v.modelPath === dj.voiceModelPath)?.id ??
      this.voices.find((v) => v.id === basename(dj.voiceModelPath, '.onnx'))
        ?.id;

    if (this.voices.length === 0) {
      this.logger.warn(`No Piper voices found in ${dj.voicesDir}`);
    } else {
      this.logger.log(
        `Voices: ${this.voices.map((v) => v.id).join(', ')} — on air: ${this.current?.id ?? 'none'}`,
      );
    }
  }

  /** Every installed voice, for the admin UI. */
  list(): VoiceInfo[] {
    return [...this.voices];
  }

  /** The voice on air; falls back to the first installed one. */
  get current(): VoiceInfo | undefined {
    return this.voices.find((v) => v.id === this.selectedId) ?? this.voices[0];
  }

  /**
   * Path the engine should synthesize with. Falls back to the configured model
   * even when discovery found nothing, so a hand-set DJ_VOICE_MODEL still works.
   */
  get modelPath(): string {
    return this.current?.modelPath ?? loadStreamConfig().dj.voiceModelPath;
  }

  /** Switch voices. Throws if the id isn't installed. */
  select(id: string): VoiceInfo {
    const voice = this.voices.find((v) => v.id === id);
    if (!voice) {
      throw new Error(
        `Unknown voice "${id}". Installed: ${this.voices.map((v) => v.id).join(', ') || 'none'}`,
      );
    }
    this.selectedId = voice.id;
    this.persist();
    this.logger.log(`DJ voice switched to ${voice.id}`);
    return voice;
  }

  private loadPersisted(): string | undefined {
    try {
      if (!existsSync(this.stateFile)) return undefined;
      const raw = JSON.parse(readFileSync(this.stateFile, 'utf8')) as {
        voiceId?: unknown;
      };
      return typeof raw.voiceId === 'string' ? raw.voiceId : undefined;
    } catch {
      return undefined;
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.stateFile), { recursive: true });
      writeFileSync(
        this.stateFile,
        JSON.stringify({ voiceId: this.selectedId }, null, 2),
      );
    } catch (err) {
      this.logger.warn(
        `Could not persist voice choice: ${(err as Error).message}`,
      );
    }
  }
}
