import type { Match, MatchStage, Player, Tournament } from '../src/domain/types';
import { DEFAULT_ELO_SETTINGS, DEFAULT_PLAY_SETTINGS } from '../src/domain/types';
import type { BracketMatchDraft } from '../src/domain/pairing/elimination';
import type { PlannedMatch } from '../src/domain/pairing/utils';

let idCounter = 0;
export function resetIds(): void {
  idCounter = 0;
}
export function nextId(prefix = 'id'): string {
  idCounter += 1;
  return `${prefix}${idCounter}`;
}

export function makePlayer(id: string, elo = 1000, overrides: Partial<Player> = {}): Player {
  return {
    id,
    tournamentId: 't1',
    name: id.toUpperCase(),
    baseElo: elo,
    elo,
    createdAt: 0,
    active: true,
    inTournament: true,
    origin: null,
    ...overrides,
  };
}

export function makePlayers(count: number, elo = 1000): Player[] {
  return Array.from({ length: count }, (_, i) => makePlayer(`p${i + 1}`, elo));
}

let sequence = 0;
export function resetSequence(): void {
  sequence = 0;
}

export function makeMatch(overrides: Partial<Match> = {}): Match {
  sequence += 1;
  return {
    id: overrides.id ?? nextId('m'),
    tournamentId: 't1',
    stage: 'casual',
    round: 1,
    order: 0,
    teamA: [],
    teamB: [],
    scoreA: null,
    scoreB: null,
    status: 'scheduled',
    bye: false,
    createdAt: sequence,
    playedAt: null,
    sequence,
    feedsWinnerTo: null,
    feedsLoserTo: null,
    labelA: null,
    labelB: null,
    ...overrides,
  };
}

export function playedMatch(
  teamA: string[],
  teamB: string[],
  scoreA: number,
  scoreB: number,
  overrides: Partial<Match> = {},
): Match {
  return makeMatch({
    teamA,
    teamB,
    scoreA,
    scoreB,
    status: 'done',
    playedAt: Date.now(),
    ...overrides,
  });
}

export function plannedToMatch(planned: PlannedMatch, stage: MatchStage): Match {
  return makeMatch({
    stage,
    round: planned.round,
    order: planned.order,
    teamA: planned.teamA,
    teamB: planned.teamB,
    bye: planned.bye,
    status: planned.bye ? 'done' : 'scheduled',
  });
}

export function draftToMatch(draft: BracketMatchDraft): Match {
  sequence += 1;
  return {
    id: draft.id,
    tournamentId: 't1',
    stage: draft.stage,
    round: draft.round,
    order: draft.order,
    teamA: draft.teamA,
    teamB: draft.teamB,
    scoreA: draft.scoreA,
    scoreB: draft.scoreB,
    status: draft.status,
    bye: draft.bye,
    createdAt: sequence,
    playedAt: null,
    sequence,
    feedsWinnerTo: draft.feedsWinnerTo,
    feedsLoserTo: draft.feedsLoserTo,
    labelA: draft.labelA,
    labelB: draft.labelB,
  };
}

export function makeTournament(overrides: Partial<Tournament> = {}): Tournament {
  return {
    id: 't1',
    name: 'Test',
    note: '',
    createdAt: 0,
    updatedAt: 0,
    phase: 'casual',
    status: 'open',
    matchFormat: '2v2',
    format: null,
    elo: { ...DEFAULT_ELO_SETTINGS },
    play: { ...DEFAULT_PLAY_SETTINGS },
    bracket: null,
    clonedFrom: null,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

/** Records a result on a bracket match; the caller re-resolves afterwards. */
export function recordResult(
  matches: Match[],
  matchId: string,
  scoreA: number,
  scoreB: number,
): Match[] {
  return matches.map((match) =>
    match.id === matchId
      ? { ...match, scoreA, scoreB, status: 'done' as const, playedAt: Date.now() }
      : match,
  );
}
