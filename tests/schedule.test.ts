import { describe, expect, it } from 'vitest';
import { matchCompletesTournament, scheduleProgress } from '../src/domain/schedule';
import { buildSingleElimination, resolveBracket } from '../src/domain/pairing/elimination';
import type { BracketTeam, Tournament } from '../src/domain/types';
import {
  draftToMatch,
  makeMatch,
  makeTournament,
  nextId,
  recordResult,
  resetIds,
  resetSequence,
} from './helpers';

function makeTeams(count: number): BracketTeam[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `team${i + 1}`,
    playerIds: [`p${i * 2 + 1}`, `p${i * 2 + 2}`],
    seed: i + 1,
    name: `Team ${i + 1}`,
  }));
}

/** A running single-elimination tournament plus its freshly resolved bracket. */
function buildBracketTournament(teamCount: number, thirdPlace = false) {
  resetIds();
  resetSequence();
  const teams = makeTeams(teamCount);
  const plan = buildSingleElimination(teams, {
    thirdPlaceMatch: thirdPlace,
    makeId: () => nextId('bm'),
  });
  const matches = resolveBracket(plan.matches.map(draftToMatch));
  const tournament = makeTournament({
    phase: 'tournament',
    status: 'running',
    format: 'single_elim',
    bracket: { format: 'single_elim', size: plan.size, teams, createdAt: 0 },
    play: { pointsToWin: 21, thirdPlaceMatch: thirdPlace },
  });
  return { teams, matches, tournament };
}

describe('matchCompletesTournament', () => {
  it('is false while other matches are still unplayed', () => {
    const { matches, tournament } = buildBracketTournament(4);
    const semiA = matches.find((m) => m.round === 1 && m.order === 0)!;
    expect(matchCompletesTournament(tournament, matches, semiA.id, 21, 15)).toBe(false);
  });

  it('is true for the submission that plays out the last remaining match', () => {
    const { matches, tournament } = buildBracketTournament(4);
    const semiA = matches.find((m) => m.round === 1 && m.order === 0)!;
    const semiB = matches.find((m) => m.round === 1 && m.order === 1)!;
    let state = resolveBracket(recordResult(matches, semiA.id, 21, 15));
    state = resolveBracket(recordResult(state, semiB.id, 21, 15));
    const final = state.find((m) => m.round === 2)!;

    expect(matchCompletesTournament(tournament, state, final.id, 21, 18)).toBe(true);
    // Sanity check against the same progress count the screen renders from.
    const resolved = resolveBracket(recordResult(state, final.id, 21, 18));
    const progress = scheduleProgress(resolved, 3);
    expect(progress.played).toBe(progress.total);
  });

  it('is true for the third-place decider when it is the last match left', () => {
    const { matches, tournament } = buildBracketTournament(4, true);
    const semiA = matches.find((m) => m.round === 1 && m.order === 0)!;
    const semiB = matches.find((m) => m.round === 1 && m.order === 1)!;
    let state = resolveBracket(recordResult(matches, semiA.id, 21, 15));
    state = resolveBracket(recordResult(state, semiB.id, 21, 15));
    const final = state.find((m) => m.round === 2 && m.stage === 'winners')!;
    state = resolveBracket(recordResult(state, final.id, 21, 18));
    const third = state.find((m) => m.stage === 'third_place')!;

    expect(matchCompletesTournament(tournament, state, third.id, 21, 19)).toBe(true);
  });

  it('is false once the tournament is already finished', () => {
    const { matches, tournament } = buildBracketTournament(4);
    const semiA = matches.find((m) => m.round === 1 && m.order === 0)!;
    const semiB = matches.find((m) => m.round === 1 && m.order === 1)!;
    let state = resolveBracket(recordResult(matches, semiA.id, 21, 15));
    state = resolveBracket(recordResult(state, semiB.id, 21, 15));
    const final = state.find((m) => m.round === 2)!;
    const finished: Tournament = { ...tournament, status: 'finished' };

    expect(matchCompletesTournament(finished, state, final.id, 21, 18)).toBe(false);
  });

  it('never triggers for a tournament still in casual (free-play) phase', () => {
    const casual = makeTournament({ phase: 'casual', status: 'open' });
    const match = makeMatch({ stage: 'casual', teamA: ['p1', 'p2'], teamB: ['p3', 'p4'] });
    expect(matchCompletesTournament(casual, [match], match.id, 21, 10)).toBe(false);
  });

  it('never triggers for a casual-stage match, even inside a running tournament', () => {
    const { tournament } = buildBracketTournament(4);
    const casualMatch = makeMatch({ stage: 'casual', teamA: ['p1', 'p2'], teamB: ['p3', 'p4'] });
    expect(matchCompletesTournament(tournament, [casualMatch], casualMatch.id, 21, 10)).toBe(
      false,
    );
  });

  it('is false for an unknown match id', () => {
    const { matches, tournament } = buildBracketTournament(4);
    expect(matchCompletesTournament(tournament, matches, 'does-not-exist', 21, 10)).toBe(false);
  });

  it('is false for a drawn score (never a valid roundnet result)', () => {
    const { matches, tournament } = buildBracketTournament(4);
    const semiA = matches.find((m) => m.round === 1 && m.order === 0)!;
    expect(matchCompletesTournament(tournament, matches, semiA.id, 15, 15)).toBe(false);
  });
});
