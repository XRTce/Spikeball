/**
 * Captain's draft for the timed tournament mode: the best half of a fixed
 * player pool picks partners from the worse half, strongest captain first, to
 * build fixed 2-player teams for a single-elimination bracket.
 */
export interface DraftState {
  /** Best half, strongest first - the order captains take their turn in. */
  captains: string[];
  /** Captains still left to pick, in turn order. */
  order: string[];
  /** Worse half, still pickable. */
  pool: string[];
  /** Teams formed so far, in the order they were picked. */
  teams: { captain: string; partner: string }[];
}

function rank(
  playerIds: readonly string[],
  ratings: Readonly<Record<string, number>>,
  fallbackRating: number,
): string[] {
  const rating = (id: string) => ratings[id] ?? fallbackRating;
  return [...playerIds].sort((a, b) => rating(b) - rating(a) || a.localeCompare(b, 'de'));
}

/**
 * Ranks the pool by rating and splits it into captains (best half) and pool
 * (worse half). An odd pool drops its weakest player, the same way an odd
 * elimination field leaves a player unassigned in `buildBracketTeams`.
 */
export function startDraft(
  playerIds: readonly string[],
  ratings: Readonly<Record<string, number>>,
  fallbackRating: number,
): DraftState {
  const ranked = rank(playerIds, ratings, fallbackRating);
  const evenCount = ranked.length - (ranked.length % 2);
  const active = ranked.slice(0, evenCount);
  const half = active.length / 2;
  const captains = active.slice(0, half);
  const pool = active.slice(half);

  return { captains, order: [...captains], pool, teams: [] };
}

/**
 * The next captain in turn picks `partnerId` from the pool. A no-op if there
 * is no captain left to pick or `partnerId` is not (or no longer) available.
 */
export function pickPartner(state: DraftState, partnerId: string): DraftState {
  const captain = state.order[0];
  if (!captain || !state.pool.includes(partnerId)) return state;

  return {
    ...state,
    order: state.order.slice(1),
    pool: state.pool.filter((id) => id !== partnerId),
    teams: [...state.teams, { captain, partner: partnerId }],
  };
}

export function isDraftComplete(state: DraftState): boolean {
  return state.order.length === 0;
}
