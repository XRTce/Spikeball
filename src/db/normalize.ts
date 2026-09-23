import {
  DEFAULT_ELO_SETTINGS,
  DEFAULT_PLAY_SETTINGS,
  type Match,
  type MatchStage,
  type Player,
  type Tournament,
  type TournamentFormat,
} from '../domain/types';

/**
 * Shape normalisation shared by the Dexie v3 upgrade (db.ts) and backup
 * import (backup.ts), so a tournament created before the single-elim-only
 * refactor (docs/ARCHITECTURE.md, "Migrating pre-single-elim data") becomes
 * valid current data however it re-enters the app: from a device's own
 * IndexedDB or from a `.json` file exported long ago.
 *
 * Inputs are read as loose records on purpose: they may lack fields the
 * current interfaces require, or still carry fields those interfaces lost.
 * Rows are copied and only the known-dead fields are stripped, rather than
 * rebuilt field by field, so that importing a *current* backup through the
 * same path can never silently drop a field this file does not know about.
 *
 * Every function is idempotent: current-shape data passes through unchanged.
 */

type Row = Record<string, unknown>;

const CURRENT_FORMATS: ReadonlySet<string> = new Set<TournamentFormat>(['single_elim']);
const CURRENT_STAGES: ReadonlySet<string> = new Set<MatchStage>([
  'casual',
  'winners',
  'third_place',
]);

/** Tournament fields the refactor removed. */
const DEAD_TOURNAMENT_FIELDS = ['matchFormat'];
/**
 * `participantLimit` was never read by anything and is being removed from
 * the type as well; stripping it here works whether or not the type still
 * declares it, because `play` is assembled loosely and cast at the end.
 */
const DEAD_PLAY_FIELDS = ['swissRounds', 'grandFinalReset', 'participantLimit'];

export interface NormalizedTournament {
  tournament: Tournament;
  /**
   * The stored format no longer exists, so the tournament was sent back to
   * the casual queue. Its matches and players need the same treatment - see
   * `normalizeMatch` and `normalizePlayer`.
   */
  reverted: boolean;
}

/**
 * A tournament on a removed format cannot keep running it - no code is left
 * that understands a round-robin, Swiss or double-elim schedule, and the UI
 * would show `undefined` where the format name goes - so it goes back to
 * the open casual queue, the state `backToCasual()` in repo.ts leaves a
 * tournament in. That applies to finished ones too: casual + finished is a
 * state the app never produces, and the results survive either way as
 * casual history (see `normalizeMatch`).
 */
export function normalizeTournament(raw: Row): NormalizedTournament {
  const format = raw.format as string | null | undefined;
  const reverted = typeof format === 'string' && !CURRENT_FORMATS.has(format);

  const next: Row = { ...raw };
  for (const key of DEAD_TOURNAMENT_FIELDS) delete next[key];

  const play: Row = { ...DEFAULT_PLAY_SETTINGS, ...((raw.play as Row | undefined) ?? {}) };
  for (const key of DEAD_PLAY_FIELDS) delete play[key];
  next.play = play;
  next.elo = { ...DEFAULT_ELO_SETTINGS, ...((raw.elo as Row | undefined) ?? {}) };

  // Added by the refactor; a tournament from before it never ran timed mode.
  next.timedMode = raw.timedMode ?? null;
  // Added by the v2 upgrade; a backup exported before sync has none.
  next.visibility = raw.visibility ?? 'local';
  next.format = format ?? null;
  next.bracket = raw.bracket ?? null;
  next.clonedFrom = raw.clonedFrom ?? null;
  next.note = raw.note ?? '';

  if (reverted) {
    Object.assign(next, {
      phase: 'casual',
      status: 'open',
      format: null,
      bracket: null,
      startedAt: null,
      finishedAt: null,
    });
  }

  return { tournament: next as unknown as Tournament, reverted };
}

export interface NormalizeRowOptions {
  /** Its tournament was reverted - see `normalizeTournament`. */
  tournamentReverted: boolean;
}

/**
 * Returns the match in the current shape, or `null` when it should not be
 * kept at all.
 *
 * Every match of a reverted tournament, and any match on a removed stage
 * (`round_robin`, `swiss`, `losers`, `grand_final`, `grand_final_reset`),
 * becomes `casual`. Casual is the only stage that is safe for a match with
 * no bracket around it: `groupRounds`, `scheduleProgress` and the tournament
 * tab all skip casual matches, while a `winners` match outside a running
 * bracket would be drawn as a knockout round, and `MatchCard` has no label
 * for a removed stage. Ratings and standings are unaffected by the remap -
 * `replayElo` and `buildStandings` (unfiltered) never look at `stage` - so a
 * played match keeps counting exactly as before. Feed pointers go, since
 * they only meant something inside the bracket that no longer exists.
 *
 * The one thing dropped is an unplayed placeholder with an empty side (an
 * undecided losers-bracket or grand-final slot): with its feeds gone nothing
 * can ever fill it, so it would sit in the casual list as a card that can be
 * neither played nor, for lack of teams, meaningfully edited. It holds no
 * result. A scheduled match with both teams assigned is kept as a casual
 * game - it may well be the one on court while the app updates.
 *
 * Matches of a tournament that keeps its format and already sit on a
 * current stage are left alone, feeds included, so a live single-elim
 * bracket survives the upgrade untouched.
 */
export function normalizeMatch(raw: Row, options: NormalizeRowOptions): Match | null {
  const next: Row = { ...raw };
  next.feedsWinnerTo = raw.feedsWinnerTo ?? null;
  next.feedsLoserTo = raw.feedsLoserTo ?? null;
  next.labelA = raw.labelA ?? null;
  next.labelB = raw.labelB ?? null;

  const flatten = options.tournamentReverted || !CURRENT_STAGES.has(raw.stage as string);
  if (!flatten) return next as unknown as Match;

  const teamA = (raw.teamA as string[] | undefined) ?? [];
  const teamB = (raw.teamB as string[] | undefined) ?? [];
  if (raw.status !== 'done' && (teamA.length === 0 || teamB.length === 0)) return null;

  return {
    ...next,
    stage: 'casual',
    feedsWinnerTo: null,
    feedsLoserTo: null,
    // Placeholder text ("Verlierer WB1.1") names a bracket slot; there is no
    // bracket any more.
    labelA: null,
    labelB: null,
  } as unknown as Match;
}

/**
 * `inTournament` marks selection into the running schedule; a reverted
 * tournament has none, and a stale flag would keep the "Turnier" badge on
 * the player list. `backToCasual()` clears it for the same reason.
 */
export function normalizePlayer(raw: Row, options: NormalizeRowOptions): Player {
  const next: Row = { ...raw };
  if (options.tournamentReverted) next.inTournament = false;
  return next as unknown as Player;
}
