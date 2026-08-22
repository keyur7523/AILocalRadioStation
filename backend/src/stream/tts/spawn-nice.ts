import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from 'node:child_process';

/**
 * Spawn a process at the lowest CPU priority the OS will give it.
 *
 * Speech synthesis and the broadcast share one machine, and the broadcast is
 * the thing that must never stutter: a late DJ clip is a missed line, a starved
 * encoder is dead air for every listener. Running the synthesizer niced lets the
 * scheduler hand CPU to ffmpeg and the event loop first, so a slow voice costs
 * us a skipped announcement instead of the stream itself.
 *
 * Falls back to a normal spawn where `nice` isn't available (e.g. Windows).
 */
export function spawnLowPriority(
  command: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcess {
  if (process.platform === 'win32') {
    return spawn(command, args, options);
  }
  return spawn('nice', ['-n', '19', command, ...args], options);
}
