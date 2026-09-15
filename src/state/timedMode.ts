import { useEffect, useState } from 'react';
import type { TimedModeSettings } from '../domain/types';

export interface Countdown {
  expired: boolean;
  /** mm:ss, floored at zero. */
  label: string;
}

function format(remainingMs: number): Countdown {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return { expired: remainingMs <= 0, label: `${minutes}:${seconds.toString().padStart(2, '0')}` };
}

/**
 * Ticks once a second while a timed tournament's countdown is running.
 * `null` while the timer has not been started yet - shared between the
 * PlayScreen and MoreScreen displays so the ticking logic exists only once.
 */
export function useTimedModeCountdown(timedMode: TimedModeSettings | null): Countdown | null {
  const startedAt = timedMode?.timerStartedAt ?? null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  if (!startedAt || !timedMode) return null;
  return format(startedAt + timedMode.freePlayMinutes * 60_000 - now);
}
