import { describe, expect, it } from 'vitest';
import { isDraftComplete, pickPartner, startDraft } from '../src/domain/pairing/draft';

const ids = (count: number) => Array.from({ length: count }, (_, i) => `p${i + 1}`);
const ratingsFor = (count: number, base = 1000, step = 10) =>
  Object.fromEntries(ids(count).map((id, i) => [id, base + (count - i) * step])) as Record<
    string,
    number
  >;

describe('startDraft', () => {
  it('splits an even field into a best half of captains and a worse-half pool', () => {
    const ratings = ratingsFor(8);
    const state = startDraft(ids(8), ratings, 1000);

    expect(state.captains).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(state.pool).toEqual(['p5', 'p6', 'p7', 'p8']);
    expect(state.order).toEqual(state.captains);
    expect(state.teams).toHaveLength(0);
  });

  it('drops the weakest player to keep the field even', () => {
    const ratings = ratingsFor(9);
    const state = startDraft(ids(9), ratings, 1000);

    expect(state.captains).toHaveLength(4);
    expect(state.pool).toHaveLength(4);
    expect([...state.captains, ...state.pool]).not.toContain('p9');
  });

  it('breaks rating ties deterministically by name', () => {
    const ratings = { b: 1000, a: 1000, d: 1000, c: 1000 };
    const state = startDraft(['b', 'a', 'd', 'c'], ratings, 1000);

    expect(state.captains).toEqual(['a', 'b']);
    expect(state.pool).toEqual(['c', 'd']);
  });
});

describe('pickPartner / isDraftComplete', () => {
  it('lets captains pick in turn order until the pool is exhausted', () => {
    const ratings = ratingsFor(8);
    let state = startDraft(ids(8), ratings, 1000);

    expect(isDraftComplete(state)).toBe(false);
    state = pickPartner(state, 'p8'); // p1 (first captain) picks the weakest
    expect(state.teams).toEqual([{ captain: 'p1', partner: 'p8' }]);
    expect(state.pool).toEqual(['p5', 'p6', 'p7']);
    expect(state.order).toEqual(['p2', 'p3', 'p4']);

    state = pickPartner(state, 'p6');
    state = pickPartner(state, 'p7');
    state = pickPartner(state, 'p5');

    expect(isDraftComplete(state)).toBe(true);
    expect(state.pool).toHaveLength(0);
    expect(state.teams).toHaveLength(4);

    const captainsUsed = new Set(state.teams.map((team) => team.captain));
    const partnersUsed = new Set(state.teams.map((team) => team.partner));
    expect(captainsUsed.size).toBe(4);
    expect(partnersUsed.size).toBe(4);
  });

  it('ignores a pick once the draft is already complete', () => {
    let state = startDraft(ids(4), ratingsFor(4), 1000);
    state = pickPartner(state, 'p3');
    state = pickPartner(state, 'p4');
    expect(isDraftComplete(state)).toBe(true);

    const finished = pickPartner(state, 'p3');
    expect(finished).toBe(state);
  });

  it('ignores a partner id that is not (or no longer) in the pool', () => {
    let state = startDraft(ids(4), ratingsFor(4), 1000);
    const before = state;
    state = pickPartner(state, 'p1'); // p1 is a captain, not in the pool
    expect(state).toBe(before);

    state = pickPartner(state, 'p3');
    const afterFirstPick = state;
    state = pickPartner(state, 'p3'); // already taken
    expect(state).toBe(afterFirstPick);
  });
});
