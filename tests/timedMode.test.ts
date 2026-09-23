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
});
