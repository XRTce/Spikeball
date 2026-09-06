import type {
  BracketTeam,
  Match,
  MatchFeed,
  MatchStage,
  MatchStatus,
  Slot,
  TournamentFormat,
} from '../types';
import { teamRating } from '../elo';

export interface BracketMatchDraft {
  id: string;
  stage: MatchStage;
  round: number;
  order: number;
  teamA: string[];
  teamB: string[];
  scoreA: number | null;
  scoreB: number | null;
  status: MatchStatus;
  bye: boolean;
  feedsWinnerTo: MatchFeed | null;
  feedsLoserTo: MatchFeed | null;
  labelA: string | null;
  labelB: string | null;
}

export interface BracketPlan {
  format: TournamentFormat;
  size: number;
  teams: BracketTeam[];
  matches: BracketMatchDraft[];
}

export function nextPowerOfTwo(n: number): number {
  let size = 1;
  while (size < n) size *= 2;
  return Math.max(2, size);
}

/**
 * Standard tournament seeding order: 1 meets the lowest seed, 2 is placed in
 * the opposite half, and top seeds can only meet in the final. Built by
 * repeatedly mirroring the previous round's seed list.
 */
export function seedOrder(size: number): number[] {
  let seeds = [1, 2];
  while (seeds.length < size) {
    const total = seeds.length * 2 + 1;
    const next: number[] = [];
    for (const seed of seeds) next.push(seed, total - seed);
    seeds = next;
  }
  return seeds;
}

export interface BuildTeamsInput {
  playerIds: string[];
  ratings: Readonly<Record<string, number>>;
  fallbackRating: number;
  teamSize: number;
  nameOf: (playerId: string) => string;
  makeId: () => string;
}

/**
 * Turns the participant list into the fixed teams that contest an elimination
 * bracket. Doubles teams are built by snake pairing - highest rated with
 * lowest rated, and so on inwards - which is the standard way to produce
 * evenly matched pairs from a ranked pool. Teams are then seeded by their
 * combined rating.
 */
export function buildBracketTeams(input: BuildTeamsInput): {
  teams: BracketTeam[];
  unassigned: string[];
} {
  const rating = (id: string) => input.ratings[id] ?? input.fallbackRating;
  const ranked = [...input.playerIds].sort((a, b) => rating(b) - rating(a) || a.localeCompare(b));

  if (input.teamSize === 1) {
    return {
      teams: ranked.map((id, index) => ({
        id: input.makeId(),
        playerIds: [id],
        seed: index + 1,
        name: input.nameOf(id),
      })),
      unassigned: [],
    };
  }

  const pairCount = Math.floor(ranked.length / 2);
  const unassigned = ranked.slice(pairCount * 2);
  const pairs: string[][] = [];
  for (let i = 0; i < pairCount; i += 1) {
    pairs.push([ranked[i]!, ranked[ranked.length - 1 - unassigned.length - i]!]);
  }

  const teams = pairs
    .map((playerIds) => ({
      playerIds,
      strength: teamRating(playerIds.map(rating)),
    }))
    .sort((a, b) => b.strength - a.strength)
    .map((entry, index) => ({
      id: input.makeId(),
      playerIds: entry.playerIds,
      seed: index + 1,
      name: entry.playerIds.map(input.nameOf).join(' & '),
    }));

  return { teams, unassigned };
}

const STAGE_CODE: Partial<Record<MatchStage, string>> = {
  winners: 'WB',
  losers: 'LB',
  round_robin: 'R',
  swiss: 'R',
};

/** Short human-readable code for a match, used in placeholder labels. */
export function matchCode(stage: MatchStage, round: number, order: number): string {
  if (stage === 'grand_final') return 'Finale';
  if (stage === 'grand_final_reset') return 'Finale (2)';
  if (stage === 'third_place') return 'Spiel um Platz 3';
  const prefix = STAGE_CODE[stage] ?? 'M';
  return `${prefix}${round}.${order + 1}`;
}

interface DraftFactory {
  make: (stage: MatchStage, round: number, order: number) => BracketMatchDraft;
}

function draftFactory(makeId: () => string): DraftFactory {
  return {
    make: (stage, round, order) => ({
      id: makeId(),
      stage,
      round,
      order,
      teamA: [],
      teamB: [],
      scoreA: null,
      scoreB: null,
      status: 'scheduled',
      bye: false,
      feedsWinnerTo: null,
      feedsLoserTo: null,
      labelA: null,
      labelB: null,
    }),
  };
}

function link(
  source: BracketMatchDraft,
  kind: 'winner' | 'loser',
  target: BracketMatchDraft,
  slot: Slot,
): void {
  const feed: MatchFeed = { matchId: target.id, slot };
  if (kind === 'winner') source.feedsWinnerTo = feed;
  else source.feedsLoserTo = feed;

  const label = `${kind === 'winner' ? 'Sieger' : 'Verlierer'} ${matchCode(
    source.stage,
    source.round,
    source.order,
  )}`;
  if (slot === 'A') target.labelA = label;
  else target.labelB = label;
}

function buildWinnersBracket(
  teams: BracketTeam[],
  size: number,
  factory: DraftFactory,
  stage: MatchStage,
): BracketMatchDraft[][] {
  const order = seedOrder(size);
  const bySeed = new Map(teams.map((team) => [team.seed, team]));
  const slots = order.map((seed) => bySeed.get(seed) ?? null);

  const roundCount = Math.log2(size);
  const rounds: BracketMatchDraft[][] = [];

  for (let r = 0; r < roundCount; r += 1) {
    const count = size / 2 ** (r + 1);
    const round: BracketMatchDraft[] = [];
    for (let j = 0; j < count; j += 1) round.push(factory.make(stage, r + 1, j));
    rounds.push(round);
  }

  const first = rounds[0]!;
  for (let j = 0; j < first.length; j += 1) {
    const match = first[j]!;
    const a = slots[j * 2] ?? null;
    const b = slots[j * 2 + 1] ?? null;
    match.teamA = a ? [...a.playerIds] : [];
    match.teamB = b ? [...b.playerIds] : [];
    // A slot without an opponent is a walkover into round two.
    if (a && !b) {
      match.bye = true;
      match.status = 'done';
    } else if (!a && b) {
      match.bye = true;
      match.status = 'done';
    }
  }

  for (let r = 0; r < rounds.length - 1; r += 1) {
    const current = rounds[r]!;
    const next = rounds[r + 1]!;
    current.forEach((match, index) => {
      link(match, 'winner', next[Math.floor(index / 2)]!, index % 2 === 0 ? 'A' : 'B');
    });
  }

  return rounds;
}

export interface BracketOptions {
  thirdPlaceMatch: boolean;
  makeId: () => string;
}

export function buildSingleElimination(
  teams: BracketTeam[],
  options: BracketOptions,
): BracketPlan {
  const size = nextPowerOfTwo(teams.length);
  const factory = draftFactory(options.makeId);
  const rounds = buildWinnersBracket(teams, size, factory, 'winners');
  const matches = rounds.flat();

  const semis = rounds[rounds.length - 2];
  if (options.thirdPlaceMatch && semis && semis.length === 2) {
    const third = factory.make('third_place', rounds.length, 0);
    link(semis[0]!, 'loser', third, 'A');
    link(semis[1]!, 'loser', third, 'B');
    matches.push(third);
  }

  return { format: 'single_elim', size, teams, matches };
}

/**
 * Double elimination.
 *
 * The winners bracket is an ordinary seeded knockout. Losers drop into an
 * alternating losers bracket: a "minor" round in which survivors play each
 * other, then a "major" round in which they meet the fresh dropdowns from the
 * winners bracket. For a bracket of 2^k that produces 2k-2 losers rounds and a
 * single grand final. Dropdowns from odd winners rounds are reversed before
 * they are placed, the usual cross-seeding trick that delays rematches.
 */
export function buildDoubleElimination(
  teams: BracketTeam[],
  options: BracketOptions,
): BracketPlan {
  const size = nextPowerOfTwo(teams.length);
  const factory = draftFactory(options.makeId);
  const wb = buildWinnersBracket(teams, size, factory, 'winners');
  const k = Math.log2(size);
  const matches: BracketMatchDraft[] = wb.flat();

  const lb: BracketMatchDraft[][] = [];

  for (let i = 1; i <= k - 1; i += 1) {
    const count = size / 2 ** (i + 1);
    const previousMajor = lb[lb.length - 1];

    const minor: BracketMatchDraft[] = [];
    for (let j = 0; j < count; j += 1) minor.push(factory.make('losers', lb.length + 1, j));
    lb.push(minor);
    matches.push(...minor);

    if (i === 1) {
      const drops = [...wb[0]!].reverse();
      drops.forEach((match, index) => {
        link(match, 'loser', minor[Math.floor(index / 2)]!, index % 2 === 0 ? 'A' : 'B');
      });
    } else if (previousMajor) {
      previousMajor.forEach((match, index) => {
        link(match, 'winner', minor[Math.floor(index / 2)]!, index % 2 === 0 ? 'A' : 'B');
      });
    }

    const major: BracketMatchDraft[] = [];
    for (let j = 0; j < count; j += 1) major.push(factory.make('losers', lb.length + 1, j));
    lb.push(major);
    matches.push(...major);

    minor.forEach((match, index) => link(match, 'winner', major[index]!, 'A'));

    const wbRound = wb[i]!;
    const drops = i % 2 === 1 ? [...wbRound].reverse() : [...wbRound];
    drops.forEach((match, index) => link(match, 'loser', major[index]!, 'B'));
  }

  const grandFinal = factory.make('grand_final', k + 1, 0);
  matches.push(grandFinal);
  link(wb[wb.length - 1]![0]!, 'winner', grandFinal, 'A');
  const lastLosersRound = lb[lb.length - 1];
  if (lastLosersRound && lastLosersRound[0]) {
    link(lastLosersRound[0], 'winner', grandFinal, 'B');
  } else {
    // size 2: the losers bracket is empty, the WB final loser is the finalist.
    link(wb[wb.length - 1]![0]!, 'loser', grandFinal, 'B');
  }

  return { format: 'double_elim', size, teams, matches };
}

export function buildBracket(
  format: TournamentFormat,
  teams: BracketTeam[],
  options: BracketOptions,
): BracketPlan {
  if (format === 'double_elim') return buildDoubleElimination(teams, options);
  return buildSingleElimination(teams, options);
}

/* ------------------------------------------------------------------------ */
/* Resolution                                                                */
/* ------------------------------------------------------------------------ */

type SlotState = { kind: 'team'; players: string[] } | { kind: 'dead' } | { kind: 'pending' };

const PENDING: SlotState = { kind: 'pending' };
const DEAD: SlotState = { kind: 'dead' };

export function isBracketStage(stage: MatchStage): boolean {
  return (
    stage === 'winners' ||
    stage === 'losers' ||
    stage === 'grand_final' ||
    stage === 'grand_final_reset' ||
    stage === 'third_place'
  );
}

function slotKey(matchId: string, slot: Slot): string {
  return `${matchId}:${slot}`;
}

/**
 * Recomputes every bracket slot from the recorded results.
 *
 * Like the Elo replay this is a pure re-derivation rather than an incremental
 * update: teams are cleared from every fed slot and pushed forward again from
 * the completed matches. Correcting or deleting a result therefore repairs the
 * whole downstream bracket, and a result that no longer belongs to the teams
 * now standing in that match is discarded instead of silently mis-attributed.
 */
export function resolveBracket(matches: Match[]): Match[] {
  const working = matches.map((match) => ({
    ...match,
    teamA: [...match.teamA],
    teamB: [...match.teamB],
  }));
  const bracket = working.filter((match) => isBracketStage(match.stage));
  if (bracket.length === 0) return working;

  const original = new Map(
    bracket.map((match) => [match.id, { a: [...match.teamA], b: [...match.teamB] }]),
  );

  const fed = new Set<string>();
  for (const match of bracket) {
    if (match.feedsWinnerTo) fed.add(slotKey(match.feedsWinnerTo.matchId, match.feedsWinnerTo.slot));
    if (match.feedsLoserTo) fed.add(slotKey(match.feedsLoserTo.matchId, match.feedsLoserTo.slot));
  }

  for (const match of bracket) {
    if (fed.has(slotKey(match.id, 'A'))) match.teamA = [];
    if (fed.has(slotKey(match.id, 'B'))) match.teamB = [];
  }

  const slotStates = new Map<string, SlotState>();
  for (const match of bracket) {
    for (const slot of ['A', 'B'] as const) {
      const key = slotKey(match.id, slot);
      if (fed.has(key)) {
        slotStates.set(key, PENDING);
      } else {
        const players = slot === 'A' ? match.teamA : match.teamB;
        slotStates.set(key, players.length > 0 ? { kind: 'team', players } : DEAD);
      }
    }
  }

  for (const match of topologicalOrder(bracket)) {
    const stateA = slotStates.get(slotKey(match.id, 'A')) ?? PENDING;
    const stateB = slotStates.get(slotKey(match.id, 'B')) ?? PENDING;

    match.teamA = stateA.kind === 'team' ? stateA.players : [];
    match.teamB = stateB.kind === 'team' ? stateB.players : [];

    const before = original.get(match.id);
    const teamsChanged =
      before !== undefined &&
      (before.a.join(',') !== match.teamA.join(',') || before.b.join(',') !== match.teamB.join(','));

    if (teamsChanged && (match.scoreA !== null || match.scoreB !== null)) {
      // The recorded score belonged to a different pairing - drop it.
      match.scoreA = null;
      match.scoreB = null;
      match.playedAt = null;
    }

    let winner: SlotState = PENDING;
    let loser: SlotState = PENDING;

    if (stateA.kind === 'dead' && stateB.kind === 'dead') {
      match.bye = true;
      match.status = 'done';
      match.scoreA = null;
      match.scoreB = null;
      winner = DEAD;
      loser = DEAD;
    } else if (stateA.kind === 'dead' || stateB.kind === 'dead') {
      const live = stateA.kind === 'team' ? stateA : stateB.kind === 'team' ? stateB : null;
      if (live) {
        match.bye = true;
        match.status = 'done';
        match.scoreA = null;
        match.scoreB = null;
        winner = live;
        loser = DEAD;
      } else {
        match.bye = false;
        match.status = 'scheduled';
      }
    } else if (stateA.kind === 'team' && stateB.kind === 'team') {
      match.bye = false;
      if (match.scoreA !== null && match.scoreB !== null && match.scoreA !== match.scoreB) {
        match.status = 'done';
        const aWon = match.scoreA > match.scoreB;
        winner = { kind: 'team', players: aWon ? match.teamA : match.teamB };
        loser = { kind: 'team', players: aWon ? match.teamB : match.teamA };
      } else {
        match.status = 'scheduled';
      }
    } else {
      match.bye = false;
      match.status = 'scheduled';
    }

    if (match.feedsWinnerTo) {
      slotStates.set(
        slotKey(match.feedsWinnerTo.matchId, match.feedsWinnerTo.slot),
        winner,
      );
    }
    if (match.feedsLoserTo) {
      slotStates.set(slotKey(match.feedsLoserTo.matchId, match.feedsLoserTo.slot), loser);
    }
  }

  return working;
}

/** Kahn's algorithm over the feed graph, so upstream results are applied first. */
function topologicalOrder(matches: Match[]): Match[] {
  const byId = new Map(matches.map((match) => [match.id, match]));
  const indegree = new Map<string, number>(matches.map((match) => [match.id, 0]));
  const edges = new Map<string, string[]>();

  for (const match of matches) {
    const targets: string[] = [];
    for (const feed of [match.feedsWinnerTo, match.feedsLoserTo]) {
      if (feed && byId.has(feed.matchId)) targets.push(feed.matchId);
    }
    edges.set(match.id, targets);
    for (const target of targets) indegree.set(target, (indegree.get(target) ?? 0) + 1);
  }

  const queue = matches
    .filter((match) => (indegree.get(match.id) ?? 0) === 0)
    .sort(bracketOrder);
  const out: Match[] = [];
  const seen = new Set<string>();

  while (queue.length > 0) {
    const match = queue.shift()!;
    if (seen.has(match.id)) continue;
    seen.add(match.id);
    out.push(match);
    for (const target of edges.get(match.id) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1;
      indegree.set(target, next);
      if (next === 0) {
        const node = byId.get(target);
        if (node) queue.push(node);
      }
    }
    queue.sort(bracketOrder);
  }

  // A cycle should be impossible, but never drop matches if one ever appears.
  for (const match of matches) if (!seen.has(match.id)) out.push(match);
  return out;
}

const STAGE_RANK: Record<string, number> = {
  winners: 0,
  losers: 1,
  third_place: 2,
  grand_final: 3,
  grand_final_reset: 4,
};

export function bracketOrder(a: Match, b: Match): number {
  return (
    a.round - b.round ||
    (STAGE_RANK[a.stage] ?? 9) - (STAGE_RANK[b.stage] ?? 9) ||
    a.order - b.order
  );
}

/** Whether the double-elimination final needs a decider after the last result. */
export function grandFinalResetState(
  matches: Match[],
): 'needed' | 'not-needed' | 'not-applicable' {
  const grandFinal = matches.find((match) => match.stage === 'grand_final');
  if (!grandFinal) return 'not-applicable';
  if (grandFinal.status !== 'done' || grandFinal.scoreA === null || grandFinal.scoreB === null) {
    return 'not-applicable';
  }
  // Slot B holds the losers-bracket finalist; beating the winners-bracket team
  // once only levels the tie, so a decider is required.
  return grandFinal.scoreB > grandFinal.scoreA ? 'needed' : 'not-needed';
}

export interface BracketResult {
  championIds: string[] | null;
  runnerUpIds: string[] | null;
  thirdIds: string[] | null;
  complete: boolean;
}

export function bracketResult(matches: Match[], format: TournamentFormat): BracketResult {
  const bracket = matches.filter((match) => isBracketStage(match.stage));
  const playable = bracket.filter((match) => match.teamA.length > 0 || match.teamB.length > 0);
  const complete = playable.every((match) => match.status === 'done');

  const winnerOf = (match: Match | undefined): string[] | null => {
    if (!match || match.status !== 'done') return null;
    if (match.bye) return match.teamA.length > 0 ? match.teamA : match.teamB.length > 0 ? match.teamB : null;
    if (match.scoreA === null || match.scoreB === null) return null;
    return match.scoreA > match.scoreB ? match.teamA : match.teamB;
  };
  const loserOf = (match: Match | undefined): string[] | null => {
    if (!match || match.status !== 'done' || match.bye) return null;
    if (match.scoreA === null || match.scoreB === null) return null;
    return match.scoreA > match.scoreB ? match.teamB : match.teamA;
  };

  const thirdPlace = bracket.find((match) => match.stage === 'third_place');

  if (format === 'double_elim') {
    const reset = bracket.find((match) => match.stage === 'grand_final_reset');
    const decider = reset && reset.status === 'done' ? reset : bracket.find((m) => m.stage === 'grand_final');
    const losersRounds = bracket.filter((match) => match.stage === 'losers');
    const lastLosersRound = losersRounds.reduce((max, m) => Math.max(max, m.round), 0);
    const losersFinal = losersRounds.find(
      (match) => match.round === lastLosersRound && match.order === 0,
    );
    return {
      championIds: winnerOf(decider),
      runnerUpIds: loserOf(decider),
      thirdIds: loserOf(losersFinal),
      complete,
    };
  }

  const winnersRounds = bracket.filter((match) => match.stage === 'winners');
  const finalRound = winnersRounds.reduce((max, m) => Math.max(max, m.round), 0);
  const final = winnersRounds.find((match) => match.round === finalRound && match.order === 0);

  return {
    championIds: winnerOf(final),
    runnerUpIds: loserOf(final),
    thirdIds: winnerOf(thirdPlace),
    complete,
  };
}

/** Rounds and match count an elimination bracket will produce, for previews. */
export function eliminationSize(
  teamCount: number,
  format: TournamentFormat,
  thirdPlaceMatch: boolean,
): { rounds: number; matches: number } {
  if (teamCount < 2) return { rounds: 0, matches: 0 };
  const size = nextPowerOfTwo(teamCount);
  const k = Math.log2(size);
  if (format === 'double_elim') {
    return { rounds: 2 * k, matches: (teamCount - 1) * 2 };
  }
  return {
    rounds: k + (thirdPlaceMatch && k >= 2 ? 1 : 0),
    matches: teamCount - 1 + (thirdPlaceMatch && k >= 2 ? 1 : 0),
  };
}
