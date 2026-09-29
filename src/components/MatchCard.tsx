import { useEffect, useMemo, useState } from 'react';
import {
  Avatar,
  AvatarStack,
  Badge,
  Button,
  EloDelta,
  Icon,
  NumberStepper,
  Segmented,
  Sheet,
} from '../ui';
import { cx } from '../lib/cx';
import { usePlayerColors } from '../state/playerColors';
import { strings, formatRelative } from '../i18n';
import { matchCode } from '../domain/pairing/elimination';
import { useSyncStatus } from '../sync';
import { MAX_GAMES, defaultGameIndex, gamesWon, isSeriesDecided } from '../domain/bestOf';
import type { Match, Player, PlaySettings } from '../domain/types';
import css from './MatchCard.module.css';

const s = strings;

export function teamLabel(ids: string[], playerById: Map<string, Player>): string {
  return ids.map((id) => playerById.get(id)?.name ?? '?').join(' & ');
}

function stageLabel(match: Match): string {
  if (match.stage === 'casual') return s.stages.casual;
  if (match.stage === 'winners') {
    return `${s.stages.winners} · ${matchCode(match.stage, match.round, match.order)}`;
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
          <span className={css.placeholder}>{label ?? s.play.teamPending}</span>
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
  onEnterResult?: (match: Match) => void;
  onOpenActions?: (match: Match) => void;
}

export function MatchCard({
  match,
  playerById,
  deltas,
  onEnterResult,
  onOpenActions,
}: MatchCardProps) {
  const colors = usePlayerColors();
  const decided = match.status === 'done' && match.scoreA !== null && match.scoreB !== null;
  const aWon = decided && (match.scoreA ?? 0) > (match.scoreB ?? 0);
  const playable = match.teamA.length > 0 && match.teamB.length > 0;
  const isBo3 = match.format === 'bo3';
  // A running series shows its games-won tally where a result would go.
  const tally = isBo3 && !decided && match.games.length > 0 ? gamesWon(match.games) : null;

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

  return (
    <div className={css.card}>
      <div className={css.head}>
        <span className={css.headMain}>
          <span className={css.stage}>{stageLabel(match)}</span>
          {/* Only where it was a choice: bo1 is the casual default, and a
              bracket match is always bo3 - there the badge would only push
              the match code ("WB1.2") out of the header on a phone. */}
          {isBo3 && match.stage === 'casual' && <Badge tone="neutral">{s.play.bo3}</Badge>}
        </span>
        {decided ? (
          <Badge tone="win" icon="check">
            {s.play.matchFinished}
          </Badge>
        ) : playable ? (
          <Badge tone="warn" icon="play">
            {s.play.matchRunning}
          </Badge>
        ) : null}
      </div>

      <div className={css.body}>
        <Side
          ids={match.teamA}
          label={match.labelA}
          score={tally ? tally.a : match.scoreA}
          isWinner={aWon}
          decided={decided}
          playerById={playerById}
          deltas={decided ? deltas : undefined}
        />
        <Side
          ids={match.teamB}
          label={match.labelB}
          score={tally ? tally.b : match.scoreB}
          isWinner={decided && !aWon}
          decided={decided}
          playerById={playerById}
          deltas={decided ? deltas : undefined}
        />
      </div>

      {isBo3 && match.games.length > 0 && (
        <div className={css.gameBreakdown}>
          {match.games.map((game) => s.play.gameScore(game.scoreA, game.scoreB)).join(' · ')}
        </div>
      )}

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
            aria-label={s.play.matchActions}
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
  /** `gameIndex` is the game of the series the score is for - see `recordGame`. */
  onSubmit: (matchId: string, scoreA: number, scoreB: number, gameIndex: number) => void;
  onClear?: (matchId: string) => void;
  onDelete?: (matchId: string) => void;
}

/**
 * Score entry, built for one-handed use between rallies: both scores start at
 * the target score and zero, so a 21:14 is five taps.
 *
 * A bo3 is entered one game at a time. Once it has a game, the sheet lists
 * the games so far; picking one corrects it, and an open series also offers
 * the next game, which is where the sheet starts.
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
  const status = useSyncStatus(match?.tournamentId);
  const locked = status.isProtected && !status.unlocked;
  const [gameIndex, setGameIndex] = useState(0);
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);

  const loadGame = (source: Match, index: number) => {
    const game = source.games[index];
    setGameIndex(index);
    setScoreA(game ? game.scoreA : play.pointsToWin);
    setScoreB(game ? game.scoreB : 0);
  };

  // Back to the default game whenever the series itself changes - a game was
  // saved here or arrived by sync - but not on every live-query refresh of
  // the match list, which would wipe a half-entered score.
  const seriesKey = match
    ? `${match.id}|${match.status}|${match.games.map((g) => `${g.scoreA}:${g.scoreB}`).join(',')}`
    : null;
  useEffect(() => {
    if (match) loadGame(match, defaultGameIndex(match));
  }, [seriesKey, play.pointsToWin]);

  const problem = useMemo(() => {
    if (scoreA === scoreB) return s.play.noDraws;
    return null;
  }, [scoreA, scoreB]);

  if (!match) return null;

  const nameA = teamLabel(match.teamA, playerById);
  const nameB = teamLabel(match.teamB, playerById);
  const isBo3 = match.format === 'bo3';
  const wins = gamesWon(match.games);
  const correcting = gameIndex < match.games.length;
  // Every game so far, plus the next one while the series is still open.
  const gameSlots = match.games.length + (isSeriesDecided(match.format, match.games) ? 0 : 1);
  const title = !isBo3
    ? s.play.result
    : correcting
      ? s.play.correctGame(gameIndex + 1)
      : s.play.gameOf(gameIndex + 1, MAX_GAMES.bo3);

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
      title={title}
      subtitle={
        isBo3 && match.games.length > 0
          ? `${nameA} ${s.common.vs} ${nameB} · ${s.play.seriesScore(wins.a, wins.b)}`
          : `${nameA} ${s.common.vs} ${nameB}`
      }
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {s.common.cancel}
          </Button>
          <Button
            variant="primary"
            icon="check"
            disabled={problem !== null}
            onClick={() => onSubmit(match.id, scoreA, scoreB, gameIndex)}
          >
            {s.common.save}
          </Button>
        </>
      }
    >
      <div className={css.entry}>
        {isBo3 && match.games.length > 0 && (
          <Segmented
            ariaLabel={s.play.games}
            value={String(gameIndex)}
            onChange={(value) => loadGame(match, Number(value))}
            options={Array.from({ length: gameSlots }, (_, index) => {
              const game = match.games[index];
              return {
                value: String(index),
                label: (
                  <span className={css.gameOption}>
                    <span>{s.play.gameLabel(index + 1)}</span>
                    <span className={css.gameOptionScore}>
                      {game ? s.play.gameScore(game.scoreA, game.scoreB) : s.play.gameNew}
                    </span>
                  </span>
                ),
              };
            })}
          />
        )}

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
          <NumberStepper value={scoreA} onChange={setScoreA} max={99} ariaLabel={s.play.pointsFor(nameA)} />
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
          <NumberStepper value={scoreB} onChange={setScoreB} max={99} ariaLabel={s.play.pointsFor(nameB)} />
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

        {(onClear || onDelete) && (match.status === 'done' || match.games.length > 0) && (
          <div className={css.sheetActions}>
            {onClear && (
              <Button
                size="sm"
                variant="ghost"
                icon="undo"
                iconAfter={locked ? 'lock' : undefined}
                onClick={() => onClear(match.id)}
              >
                {s.play.reopen}
              </Button>
            )}
            {onDelete && match.stage === 'casual' && (
              <Button
                size="sm"
                variant="dangerGhost"
                icon="trash"
                iconAfter={locked ? 'lock' : undefined}
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
