import { useEffect, useState } from 'react';
import type { TimedModeSettings } from '../domain/types';

export interface Countdown {
  expired: boolean;
  /**
   * mm:ss, or h:mm:ss once an hour or more remains (free-play can run up to
   * 12 hours), rounded up to the next full second and never below 0:00, so
   * it reads 0:00 only once the time is actually up.
   */
  label: string;
}

export function formatCountdown(remainingMs: number): Countdown {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const label =
    hours > 0
      ? `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
      : `${minutes}:${seconds.toString().padStart(2, '0')}`;
  return { expired: remainingMs <= 0, label };
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
    // `now` is as old as the last tick (or the mount), which is before a
    // timer that was just started; without this the first second would show
    // more time than the configured duration.
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  if (!startedAt || !timedMode) return null;
  return formatCountdown(startedAt + timedMode.freePlayMinutes * 60_000 - now);
}
