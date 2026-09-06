import { useEffect, useMemo, useState } from 'react';
import {
  Avatar,
  AvatarStack,
  Badge,
  Button,
  EloDelta,
  Icon,
  NumberStepper,
  Sheet,
} from '../ui';
import { cx } from '../lib/cx';
import { usePlayerColors } from '../state/playerColors';
import { strings, formatRelative } from '../i18n';
import { matchWinProbability } from '../domain/elo';
import { matchCode } from '../domain/pairing/elimination';
import type { Match, Player, PlaySettings } from '../domain/types';
import css from './MatchCard.module.css';

const s = strings;

export function teamLabel(ids: string[], playerById: Map<string, Player>): string {
  return ids.map((id) => playerById.get(id)?.name ?? '?').join(' & ');
}

function stageLabel(match: Match): string {
  if (match.stage === 'casual') return s.stages.casual;
  if (match.stage === 'round_robin' || match.stage === 'swiss') {
    return `${s.common.round} ${match.round}`;
  }
  if (match.stage === 'winners' || match.stage === 'losers') {
    return `${s.stages[match.stage]} · ${matchCode(match.stage, match.round, match.order)}`;
  }
  return s.stages[match.stage];
}

interface SideProps {
  ids: string[];
  label: string | null;
  score: number | null;
  isWinner: boolean;
  decided: boolean;
  playerById: Map<string, Player>;
  deltas?: Record<string, number> | undefined;
}

function Side({ ids, label, score, isWinner, decided, playerById, deltas }: SideProps) {
  const colors = usePlayerColors();
  return (
    <div className={cx(css.side, isWinner && css.winnerSide)}>
      {ids.length > 0 ? (
        <AvatarStack
          people={ids.map((id) => ({
            id,
            name: playerById.get(id)?.name ?? '?',
            color: colors.varOf(id),
          }))}
        />
      ) : (
        <Avatar name="?" seed={label ?? 'tbd'} size={30} color="var(--surface-3)" />
      )}
      <div className={css.names}>
        {ids.length > 0 ? (
          <span className={css.name}>{teamLabel(ids, playerById)}</span>
        ) : (
          <span className={css.placeholder}>{label ?? 'Noch offen'}</span>
        )}
        {deltas && ids.length > 0 && (
          <span className={css.deltas}>
            {ids.map((id) => (
              <EloDelta key={id} value={deltas[id] ?? 0} />
            ))}
          </span>
        )}
      </div>
      <span className={cx(css.score, (isWinner || !decided) && css.scoreWin)}>
        {score ?? '–'}
      </span>
    </div>
  );
}

export interface MatchCardProps {
  match: Match;
  playerById: Map<string, Player>;
  /** Rating changes this match produced, from the Elo replay. */
  deltas?: Record<string, number>;
  ratings?: Readonly<Record<string, number>>;
  baseElo?: number;
  onEnterResult?: (match: Match) => void;
  onOpenActions?: (match: Match) => void;
  showProbability?: boolean;
}

export function MatchCard({
  match,
  playerById,
  deltas,
  ratings,
  baseElo = 1000,
  onEnterResult,
  onOpenActions,
  showProbability,
}: MatchCardProps) {
  const colors = usePlayerColors();
  const decided = match.status === 'done' && match.scoreA !== null && match.scoreB !== null;
  const aWon = decided && (match.scoreA ?? 0) > (match.scoreB ?? 0);
  const playable = match.teamA.length > 0 && match.teamB.length > 0;

  if (match.bye) {
    const resting = match.teamA.length > 0 ? match.teamA : match.teamB;
    return (
      <div className={css.card}>
        <div className={css.byeBody}>
          <AvatarStack
            people={resting.map((id) => ({
              id,
              name: playerById.get(id)?.name ?? '?',
              color: colors.varOf(id),
            }))}
          />
          <span className={css.byeText}>{teamLabel(resting, playerById)}</span>
          <Badge tone="neutral" icon="clock">
            {s.common.bye}
          </Badge>
        </div>
      </div>
    );
  }

  const probability =
    showProbability && ratings && playable && !decided
      ? matchWinProbability(match.teamA, match.teamB, ratings, baseElo)
      : null;

  return (
    <div className={css.card}>
      <div className={css.head}>
        <span className={css.stage}>{stageLabel(match)}</span>
        {decided ? (
          <Badge tone="win" icon="check">
            {s.play.winner}
          </Badge>
        ) : probability !== null ? (
          <Badge tone={Math.abs(probability - 0.5) < 0.06 ? 'accent' : 'neutral'}>
            {Math.abs(probability - 0.5) < 0.06
              ? s.play.even
              : s.play.favourite(Math.round(Math.max(probability, 1 - probability) * 100))}
          </Badge>
        ) : null}
      </div>

      <div className={css.body}>
        <Side
          ids={match.teamA}
          label={match.labelA}
          score={match.scoreA}
          isWinner={aWon}
          decided={decided}
          playerById={playerById}
          deltas={decided ? deltas : undefined}
        />
        <Side
          ids={match.teamB}
          label={match.labelB}
          score={match.scoreB}
          isWinner={decided && !aWon}
          decided={decided}
          playerById={playerById}
          deltas={decided ? deltas : undefined}
        />
      </div>

      <div className={css.foot}>
        <span className={css.footMeta}>
          {decided && match.playedAt ? formatRelative(match.playedAt) : ''}
        </span>
        {!decided && playable && onEnterResult && (
          <Button size="sm" variant="primary" icon="flag" onClick={() => onEnterResult(match)}>
            {s.play.enterResult}
          </Button>
        )}
        {decided && onEnterResult && (
          <Button size="sm" variant="ghost" icon="pencil" onClick={() => onEnterResult(match)}>
            {s.common.edit}
          </Button>
        )}
        {onOpenActions && (
          <Button
            size="sm"
            variant="ghost"
            icon="more"
            aria-label="Weitere Aktionen"
            onClick={() => onOpenActions(match)}
          />
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Result entry                                                              */
/* ------------------------------------------------------------------------ */

export interface ResultSheetProps {
  match: Match | null;
  playerById: Map<string, Player>;
  play: PlaySettings;
  onClose: () => void;
  onSubmit: (matchId: string, scoreA: number, scoreB: number) => void;
  onClear?: (matchId: string) => void;
  onDelete?: (matchId: string) => void;
}

/**
 * Score entry, built for one-handed use between rallies: both scores start at
 * the target score and zero, so a 21:14 is five taps.
 */
export function ResultSheet({
  match,
  playerById,
  play,
  onClose,
  onSubmit,
  onClear,
  onDelete,
}: ResultSheetProps) {
  const colors = usePlayerColors();
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);

  useEffect(() => {
    if (!match) return;
    setScoreA(match.scoreA ?? play.pointsToWin);
    setScoreB(match.scoreB ?? 0);
  }, [match, play.pointsToWin]);

  const problem = useMemo(() => {
    if (scoreA === scoreB) return 'Unentschieden gibt es beim Roundnet nicht.';
    return null;
  }, [scoreA, scoreB]);

  if (!match) return null;

  const nameA = teamLabel(match.teamA, playerById);
  const nameB = teamLabel(match.teamB, playerById);

  const applyPreset = (winner: 'A' | 'B', loserScore: number) => {
    if (winner === 'A') {
      setScoreA(play.pointsToWin);
      setScoreB(loserScore);
    } else {
      setScoreB(play.pointsToWin);
      setScoreA(loserScore);
    }
  };

  return (
    <Sheet
      open
      onClose={onClose}
      title={s.play.result}
      subtitle={`${nameA} ${s.common.vs} ${nameB}`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {s.common.cancel}
          </Button>
          <Button
            variant="primary"
            icon="check"
            disabled={problem !== null}
            onClick={() => onSubmit(match.id, scoreA, scoreB)}
          >
            {s.common.save}
          </Button>
        </>
      }
    >
      <div className={css.entry}>
        <div className={cx(css.entryTeam, scoreA > scoreB && css.entryLeading)}>
          <div className={css.entryHead}>
            <AvatarStack
              people={match.teamA.map((id) => ({
                id,
                name: playerById.get(id)?.name ?? '?',
                color: colors.varOf(id),
              }))}
              size={26}
            />
            <span className={css.entryNames}>{nameA}</span>
          </div>
          <NumberStepper value={scoreA} onChange={setScoreA} max={99} ariaLabel={`Punkte ${nameA}`} />
        </div>

        <div className={cx(css.entryTeam, scoreB > scoreA && css.entryLeading)}>
          <div className={css.entryHead}>
            <AvatarStack
              people={match.teamB.map((id) => ({
                id,
                name: playerById.get(id)?.name ?? '?',
                color: colors.varOf(id),
              }))}
              size={26}
            />
            <span className={css.entryNames}>{nameB}</span>
          </div>
          <NumberStepper value={scoreB} onChange={setScoreB} max={99} ariaLabel={`Punkte ${nameB}`} />
        </div>

        <div className={css.presets}>
          <Button size="sm" variant="tinted" onClick={() => applyPreset('A', 0)}>
            {play.pointsToWin}:0
          </Button>
          <Button size="sm" variant="tinted" onClick={() => applyPreset('A', play.pointsToWin - 2)}>
            {play.pointsToWin}:{play.pointsToWin - 2}
          </Button>
          <Button size="sm" variant="tinted" onClick={() => applyPreset('B', play.pointsToWin - 2)}>
            {play.pointsToWin - 2}:{play.pointsToWin}
          </Button>
          <Button size="sm" variant="tinted" onClick={() => applyPreset('B', 0)}>
            0:{play.pointsToWin}
          </Button>
        </div>

        <div className={cx(css.hintRow, problem && css.warn)}>
          {problem ?? (
            <>
              <Icon name="trophy" size={14} />
              {scoreA > scoreB ? nameA : nameB}
            </>
          )}
        </div>

        {(onClear || onDelete) && match.status === 'done' && (
          <div className={css.sheetActions}>
            {onClear && (
              <Button size="sm" variant="ghost" icon="undo" onClick={() => onClear(match.id)}>
                {s.play.reopen}
              </Button>
            )}
            {onDelete && match.stage === 'casual' && (
              <Button
                size="sm"
                variant="dangerGhost"
                icon="trash"
                onClick={() => onDelete(match.id)}
              >
                {s.play.deleteMatch}
              </Button>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
