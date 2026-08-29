import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { SettingsService } from '../../db/settings.service';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { loadStreamConfig } from '../stream.config';
import { discoverVoices, ESPEAK_VOICE, type VoiceInfo } from './voices';

/**
 * Which DJ voice is on air — robotic or neural. Seeded from env, switchable
 * live via the admin API, and persisted so the choice survives a restart.
 *
 * Deliberately a plain class as well as a Nest provider: build-time tooling
 * constructs it directly to pre-generate clips for every installed voice.
 */
@Injectable()
export class VoiceConfigService implements OnModuleInit {
  private readonly logger = new Logger(VoiceConfigService.name);
  private static readonly SETTING_KEY = 'voice';
  private readonly stateFile =
    process.env.DJ_VOICE_STATE_FILE ?? '/tmp/radio-voice.json';
  private readonly voices: VoiceInfo[];
  private selectedId?: string;

  constructor(private readonly settings?: SettingsService) {
    const { dj } = loadStreamConfig();
    this.voices = discoverVoices(dj.voicesDir);
    this.selectedId = this.loadPersisted() ?? this.seedFromEnv(dj);
    this.logger.log(
      `Voices: ${this.voices.map((v) => v.id).join(', ')} — on air: ${this.current.id}`,
    );
  }

  /**
   * Starting voice when nothing has been chosen yet. `DJ_TTS_ENGINE=espeak`
   * means the robotic voice; otherwise match the configured Piper model.
   */
  private seedFromEnv(dj: { ttsEngine: string; voiceModelPath: string }) {
    if (dj.ttsEngine === 'espeak') return ESPEAK_VOICE.id;
    const wanted = basename(dj.voiceModelPath, '.onnx');
    return this.voices.find((v) => v.id === wanted)?.id;
  }

  /**
   * Adopt the stored voice once the database is up. The constructor already
   * seeded from env, so the DJ has a voice from the first break regardless.
   */
  async onModuleInit(): Promise<void> {
    const saved = await this.settings?.get<{ voiceId: string }>(
      VoiceConfigService.SETTING_KEY,
    );
    const id = saved?.voiceId;
    if (id && this.voices.some((v) => v.id === id)) {
      this.selectedId = id;
      this.logger.log(`Voice restored from database: ${id}`);
    }
  }

  /** Every installed voice, for the admin UI. */
  list(): VoiceInfo[] {
    return [...this.voices];
  }

  /**
   * The voice on air. Falls back to the first neural voice, then to the robotic
   * one — which is always present, so this never returns undefined.
   */
  get current(): VoiceInfo {
    return (
      this.voices.find((v) => v.id === this.selectedId) ??
      this.voices.find((v) => v.engine === 'piper') ??
      ESPEAK_VOICE
    );
  }

  /** Model path for the current voice (Piper only; '' for espeak). */
  get modelPath(): string {
    return this.current.modelPath ?? '';
  }

  /** Switch voices. Throws if the id isn't installed. */
  select(id: string): VoiceInfo {
    const voice = this.voices.find((v) => v.id === id);
    if (!voice) {
      throw new Error(
        `Unknown voice "${id}". Installed: ${this.voices.map((v) => v.id).join(', ')}`,
      );
    }
    this.selectedId = voice.id;
    this.persist();
    void this.settings?.set(VoiceConfigService.SETTING_KEY, {
      voiceId: voice.id,
    });
    this.logger.log(`DJ voice switched to ${voice.id} (${voice.engine})`);
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
