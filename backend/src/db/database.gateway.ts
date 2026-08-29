import { Inject, Injectable, Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';
import { DATA_SOURCE } from './database.provider';

/**
 * Every database read and write goes through here.
 *
 * Serverless Postgres (Neon and friends) suspends its compute after a few
 * minutes idle, which quietly kills the pooled connection. A station touches
 * its database rarely — a settings change here, a library edit there — so it is
 * almost always coming back from exactly that state. Without a retry the first
 * action after a quiet spell fails, and because our writes are fire-and-forget
 * it would fail *silently*.
 *
 * So a failed operation is retried once against a freshly initialized
 * connection. If it still fails, the caller gets `null` and carries on with
 * whatever it seeded from env — the broadcast never depends on this.
 */
@Injectable()
export class DatabaseGateway {
  private readonly logger = new Logger(DatabaseGateway.name);
  private reconnecting: Promise<boolean> | null = null;

  constructor(@Inject(DATA_SOURCE) private ds: DataSource | null) {}

  /** Whether there is a database at all. */
  get available(): boolean {
    return this.ds !== null;
  }

  /**
   * Run `work` against the database, reconnecting once if the connection has
   * gone away. Returns `null` when there is no database or the work failed —
   * callers treat that as "carry on without persistence".
   */
  async run<T>(work: (ds: DataSource) => Promise<T>): Promise<T | null> {
    if (!this.ds) return null;
    try {
      return await work(this.ds);
    } catch (err) {
      if (!this.looksLikeConnectionLoss(err)) {
        this.logger.warn(`query failed: ${describe(err)}`);
        return null;
      }
      this.logger.log('Connection lost (idle suspend?) — reconnecting');
      if (!(await this.reconnect())) return null;
      try {
        return await work(this.ds);
      } catch (retryErr) {
        this.logger.warn(`query failed after reconnect: ${describe(retryErr)}`);
        return null;
      }
    }
  }

  /**
   * A dropped or suspended server, as opposed to a genuine query error — only
   * the former is worth retrying.
   */
  private looksLikeConnectionLoss(err: unknown): boolean {
    const message = describe(err).toLowerCase();
    return [
      'connection terminated',
      'connection closed',
      'econnreset',
      'epipe',
      'etimedout',
      'econnrefused',
      'server closed the connection',
      'terminating connection',
      'client has been closed',
      'driver not connected',
    ].some((hint) => message.includes(hint));
  }

  /** Re-establish the connection, coalescing concurrent attempts into one. */
  private reconnect(): Promise<boolean> {
    this.reconnecting ??= (async () => {
      try {
        if (this.ds?.isInitialized)
          await this.ds.destroy().catch(() => undefined);
        await this.ds?.initialize();
        this.logger.log('Reconnected');
        return true;
      } catch (err) {
        this.logger.warn(`reconnect failed: ${(err as Error).message}`);
        return false;
      } finally {
        this.reconnecting = null;
      }
    })();
    return this.reconnecting;
  }
}

/**
 * A usable description of a database error. A socket dropped underneath us
 * often arrives with an empty message, which makes for a useless log line — so
 * fall back to whatever identifying detail the driver did set.
 */
function describe(err: unknown): string {
  const e = err as { message?: string; code?: string; name?: string };
  return e?.message || e?.code || e?.name || 'unknown error';
}
