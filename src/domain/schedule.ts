import { bracketOrder, eliminationSize, isBracketStage, resolveBracket } from './pairing/elimination';
import type { BracketMeta, Match, MatchStage, PlaySettings, TournamentPhase, TournamentStatus } from './types';

export interface RoundGroup {
  key: string;
  label: string;
  shortLabel: string;
  matches: Match[];
  /** Matches that can actually be played (both teams known, not a bye). */
  playable: number;
  played: number;
  complete: boolean;
}

const KNOCKOUT_NAMES: Record<number, string> = {
  0: 'Finale',
  1: 'Halbfinale',
  2: 'Viertelfinale',
  3: 'Achtelfinale',
};

const KNOCKOUT_SHORT: Record<number, string> = {
  0: 'Finale',
  1: 'HF',
  2: 'VF',
  3: 'AF',
};

function knockoutName(round: number, totalRounds: number, short: boolean): string {
  const remaining = totalRounds - round;
  const table = short ? KNOCKOUT_SHORT : KNOCKOUT_NAMES;
  return table[remaining] ?? (short ? `R${round}` : `Runde ${round}`);
}

/**
 * Groups a schedule into the rounds the UI shows as tabs.
 *
 * Brackets are presented as rounds rather than as a drawn tree: on a phone a
 * round list is readable without pinch-zooming, and each undecided slot names
 * its source match ("Sieger WB1.2"), so where a team comes from stays explicit.
 */
export function groupRounds(matches: Match[]): RoundGroup[] {
  const relevant = matches.filter((match) => match.stage !== 'casual');
  if (relevant.length === 0) return [];

  const winnersRounds = new Set(
    relevant.filter((m) => m.stage === 'winners').map((m) => m.round),
  ).size;

  const buckets = new Map<string, Match[]>();
  for (const match of relevant) {
    const key = bucketKey(match);
    const list = buckets.get(key) ?? [];
    list.push(match);
    buckets.set(key, list);
  }

  const groups: RoundGroup[] = [];
  for (const [key, list] of buckets) {
    const first = list[0]!;
    const sorted = [...list].sort((a, b) =>
      isBracketStage(a.stage) ? bracketOrder(a, b) : a.order - b.order,
    );
    const playable = sorted.filter(
      (match) => !match.bye && match.teamA.length > 0 && match.teamB.length > 0,
    );
    const played = playable.filter((match) => match.status === 'done').length;

    groups.push({
      key,
      label: roundLabel(first, winnersRounds, false),
      shortLabel: roundLabel(first, winnersRounds, true),
      matches: sorted,
      playable: playable.length,
      played,
      // A round with nothing playable yet is not "complete", it is just waiting.
      complete: playable.length > 0 && played === playable.length,
    });
  }

  return groups.sort((a, b) => sortRank(a.matches[0]!) - sortRank(b.matches[0]!));
}

function bucketKey(match: Match): string {
  if (match.stage === 'third_place') return 'third_place';
  return `${match.stage}:${match.round}`;
}

const STAGE_ORDER: Record<MatchStage, number> = {
  casual: 0,
  winners: 2,
  third_place: 8,
};

function sortRank(match: Match): number {
  const stage = STAGE_ORDER[match.stage] ?? 5;
  if (stage >= 8) return 10_000 + stage;
  return stage * 1000 + match.round;
}

function roundLabel(match: Match, winnersRounds: number, short: boolean): string {
  switch (match.stage) {
    case 'third_place':
      return short ? 'Platz 3' : 'Spiel um Platz 3';
    case 'winners':
      return knockoutName(match.round, winnersRounds, short);
    default:
      return short ? `R${match.round}` : `Runde ${match.round}`;
  }
}

/** Matches waiting to be played right now, in the order they should be called. */
export function openMatches(matches: Match[]): Match[] {
  return matches
    .filter(
      (match) =>
        match.status === 'scheduled' && match.teamA.length > 0 && match.teamB.length > 0,
    )
    .sort((a, b) => a.round - b.round || a.order - b.order || a.createdAt - b.createdAt);
}

export interface ScheduleProgress {
  played: number;
  total: number;
  /** Undecided slots are not counted; a bracket grows as results come in. */
  ratio: number;
}

/**
 * @param expectedTotal Known match count for the format. Elimination brackets
 * are generated at full power-of-two size and only discover which slots are
 * walkovers as results come in, so counting live matches would make the
 * denominator shrink during the tournament. The formula is stable, and it is
 * the same number the setup screen previewed.
 */
export function scheduleProgress(matches: Match[], expectedTotal?: number): ScheduleProgress {
  const relevant = matches.filter((match) => match.stage !== 'casual' && !match.bye);
  const decided = relevant.filter((match) => match.status === 'done').length;
  const total = Math.max(expectedTotal ?? relevant.length, decided);
  return { played: decided, total, ratio: total === 0 ? 0 : decided / total };
}

/**
 * Whether *submitting* this result is the one that finishes the tournament -
 * every stage match decided, and the tournament not finished already.
 *
 * Pure and side-effect free: it simulates the same bracket resolution and
 * progress count `recalculate()` (src/db/repo.ts) applies after the write
 * actually lands, so a screen can react the instant a submit is confirmed
 * rather than waiting for the next live-query render. `resolveBracket` is a
 * no-op for a schedule with no bracket-stage matches, so this reads the same
 * for every tournament format, not just single-elimination.
 */
export function matchCompletesTournament(
  tournament: {
    phase: TournamentPhase;
    status: TournamentStatus;
    bracket: BracketMeta | null;
    play: PlaySettings;
  },
  matches: Match[],
  matchId: string,
  scoreA: number,
  scoreB: number,
): boolean {
  if (tournament.phase !== 'tournament' || tournament.status === 'finished') return false;
  if (scoreA === scoreB) return false; // no draws in roundnet - never a valid result

  const target = matches.find((match) => match.id === matchId);
  if (!target || target.stage === 'casual') return false;

  const updated = matches.map((match) =>
    match.id === matchId ? { ...match, scoreA, scoreB, status: 'done' as const } : match,
  );
  const resolved = resolveBracket(updated);

  const expected = tournament.bracket
    ? eliminationSize(tournament.bracket.teams.length, tournament.play.thirdPlaceMatch).matches
    : undefined;

  const progress = scheduleProgress(resolved, expected);
  return progress.total > 0 && progress.played === progress.total;
}
