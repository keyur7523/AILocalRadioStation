import { spawn } from 'node:child_process';

/** Read a media file's title/artist tags via ffprobe. Never throws. */
export function readTags(
  ffprobePath: string,
  path: string,
): Promise<{ title?: string; artist?: string }> {
  return new Promise((resolve) => {
    const proc = spawn(
      ffprobePath,
      [
        '-v',
        'error',
        '-show_entries',
        'format_tags=title,artist',
        '-of',
        'json',
        path,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    proc.stdout.on('data', (d: Buffer) => (out += d.toString()));
    proc.on('error', () => resolve({}));
    proc.on('close', () => {
      try {
        const parsed = JSON.parse(out || '{}') as {
          format?: { tags?: { title?: string; artist?: string } };
        };
        resolve(parsed.format?.tags ?? {});
      } catch {
        resolve({});
      }
    });
  });
}
