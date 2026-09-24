import { cx } from '../lib/cx';
import { strings } from '../i18n';
import type { Countdown } from '../state/timedMode';
import css from './CountdownCard.module.css';

const s = strings;

/**
 * Big, glanceable free-play timer tile - the countdown a player needs to
 * read at a glance mid-game, not a small status pill. Shared by the "Spiele"
 * tab's casual games overview and the "Mehr" tab so both show the exact same
 * data with the exact same look, across all three states: not started yet,
 * running, and expired.
 *
 * `countdown` is `null` before the timer has been started (see
 * `useTimedModeCountdown`), in which case `notStartedLabel` is shown instead
 * of a number.
 */
export function CountdownCard({
  countdown,
  notStartedLabel,
}: {
  countdown: Countdown | null;
  notStartedLabel: string;
}) {
  if (!countdown) {
    return (
      <div className={css.timerCard}>
        <span className={css.timerNotStarted}>{notStartedLabel}</span>
      </div>
    );
  }

  return (
    <div className={cx(css.timerCard, countdown.expired && css.timerCardExpired)}>
      <span className={css.timerValue}>{countdown.expired ? s.more.timerExpired : countdown.label}</span>
      {!countdown.expired && <span className={css.timerCaption}>{s.more.timerRemaining}</span>}
    </div>
  );
}
