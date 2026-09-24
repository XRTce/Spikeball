import { describe, expect, it } from 'vitest';
import { formatCountdown } from '../src/state/timedMode';

describe('formatCountdown', () => {
  it('rounds a started second up, so 0:00 means the time is up', () => {
    expect(formatCountdown(45 * 60_000)).toEqual({ expired: false, label: '45:00' });
    expect(formatCountdown(59_001)).toEqual({ expired: false, label: '1:00' });
    expect(formatCountdown(1)).toEqual({ expired: false, label: '0:01' });
    expect(formatCountdown(0)).toEqual({ expired: true, label: '0:00' });
  });

  it('never goes below 0:00 once expired', () => {
    expect(formatCountdown(-90_000)).toEqual({ expired: true, label: '0:00' });
  });

  it('switches to h:mm:ss once an hour or more remains, so a 60-minute timer never shows a bare "60:00"', () => {
    expect(formatCountdown(60 * 60_000)).toEqual({ expired: false, label: '1:00:00' });
  });

  it('formats a partial hour with padded minutes and seconds', () => {
    expect(formatCountdown((90 * 60 + 5) * 1000)).toEqual({ expired: false, label: '1:30:05' });
  });

  it('formats the longest allowed free-play duration (12 hours)', () => {
    expect(formatCountdown(12 * 60 * 60_000)).toEqual({ expired: false, label: '12:00:00' });
  });

  it('drops back to mm:ss just under the hour mark', () => {
    expect(formatCountdown(59 * 60_000 + 59_000)).toEqual({ expired: false, label: '59:59' });
  });
});
