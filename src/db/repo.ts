import { db, makeId } from './db';
import {
  DEFAULT_ELO_SETTINGS,
  DEFAULT_PLAY_SETTINGS,
  type BracketTeam,
  type EloSettings,
  type Match,
  type MatchStage,
  type PlaySettings,
  type Player,
  type Tournament,
} from '../domain/types';
import { replayElo } from '../domain/elo';
import {
  bracketResult,
  buildSingleElimination,
  resolveBracket,
  seedTeams,
  type BracketMatchDraft,
} from '../domain/pairing/elimination';
// Every mutation below that can touch a public tournament is wrapped with
// command(): unchanged for a local tournament, queued and replayable for a
// public one (docs/SYNC.md, "Commands"). The wrapped function keeps the
// exported name and signature; screens are none the wiser.
import { command } from '../sync/commands';

async function matchTournamentId(matchId: string): Promise<string | null> {
  return (await db.matches.get(matchId))?.tournamentId ?? null;
}

async function playerTournamentId(playerId: string): Promise<string | null> {
  return (await db.players.get(playerId))?.tournamentId ?? null;
}

/* ------------------------------------------------------------------------ */
/* Reads                                                                      */
/* ------------------------------------------------------------------------ */

export function listTournaments(): Promise<Tournament[]> {
  return db.tournaments.orderBy('updatedAt').reverse().toArray();
}

export function getTournament(id: string): Promise<Tournament | undefined> {
  return db.tournaments.get(id);
}

export function listPlayers(tournamentId: string): Promise<Player[]> {
  return db.players.where('tournamentId').equals(tournamentId).toArray();
}

export function listMatches(tournamentId: string): Promise<Match[]> {
  return db.matches.where('tournamentId').equals(tournamentId).toArray();
}

/* ------------------------------------------------------------------------ */
/* Tournaments                                                                */
/* ------------------------------------------------------------------------ */

export interface CreateTournamentInput {
  name: string;
  note?: string;
  elo?: Partial<EloSettings>;
  play?: Partial<PlaySettings>;
  /** Copy the player list (and their ratings) out of an existing tournament. */
  cloneFrom?: { tournamentId: string; ratingSource: 'current' | 'base' };
  /** Time-boxed free play, ending in a draft and a single-elim bracket. */
  timedMode?: { freePlayMinutes: number; draftSize: number; maxPartnerRepeats?: number | null } | null;
}

export async function createTournament(input: CreateTournamentInput): Promise<string> {
  const now = Date.now();
  const id = makeId();

  const tournament: Tournament = {
    id,
    name: input.name.trim() || 'Turnier',
    note: input.note?.trim() ?? '',
    createdAt: now,
    updatedAt: now,
    phase: 'casual',
    status: 'open',
    format: null,
    elo: { ...DEFAULT_ELO_SETTINGS, ...input.elo },
    play: { ...DEFAULT_PLAY_SETTINGS, ...input.play },
    bracket: null,
    clonedFrom: null,
    startedAt: null,
    finishedAt: null,
    timedMode: input.timedMode
      ? {
          freePlayMinutes: input.timedMode.freePlayMinutes,
          draftSize: input.timedMode.draftSize,
          maxPartnerRepeats: input.timedMode.maxPartnerRepeats ?? null,
          timerStartedAt: null,
        }
      : null,
    // Every tournament starts on this device; publishTournament() in src/sync
    // is the one way to make it public, so a public tournament always has the
    // sync bookkeeping that goes with it.
    visibility: 'local',
  };

  await db.transaction('rw', db.tournaments, db.players, async () => {
    await db.tournaments.add(tournament);
    if (input.cloneFrom) {
      const source = await db.tournaments.get(input.cloneFrom.tournamentId);
      const copied = await copyPlayers(
        input.cloneFrom.tournamentId,
        id,
        input.cloneFrom.ratingSource,
      );
      if (source && copied > 0) {
        await db.tournaments.update(id, {
          clonedFrom: { tournamentId: source.id, name: source.name },
        });
      }
    }
  });

  return id;
}

async function updateTournamentImpl(
  id: string,
  patch: Partial<Omit<Tournament, 'id'>>,
): Promise<void> {
  await db.tournaments.update(id, { ...patch, updatedAt: Date.now() });
}
export const updateTournament = command('updateTournament', (id) => id, updateTournamentImpl);

/**
 * Removes this device's copy only ("remove from this device"). Stays
 * local-only even for a public tournament - deleting it for everyone is
 * deleteTournamentEverywhere() in src/sync. Its sync bookkeeping is removed
 * along with it, if any.
 */
export async function deleteTournament(id: string): Promise<void> {
  await db.transaction('rw', db.tournaments, db.players, db.matches, db.sync, async () => {
    await db.matches.where('tournamentId').equals(id).delete();
    await db.players.where('tournamentId').equals(id).delete();
    await db.tournaments.delete(id);
    await db.sync.delete(id);
  });
}

async function renameTournamentImpl(id: string, name: string): Promise<void> {
  await updateTournamentImpl(id, { name: name.trim() || 'Turnier' });
}
export const renameTournament = command('renameTournament', (id) => id, renameTournamentImpl);

/* ------------------------------------------------------------------------ */
/* Players                                                                    */
/* ------------------------------------------------------------------------ */

async function addPlayerImpl(
  tournamentId: string,
  name: string,
  baseElo?: number,
): Promise<string> {
  const tournament = await db.tournaments.get(tournamentId);
  if (!tournament) throw new Error('Turnier nicht gefunden');

  const id = makeId();
  const rating = Number.isFinite(baseElo) ? Math.round(baseElo!) : tournament.elo.baseElo;
  const player: Player = {
    id,
    tournamentId,
    name: name.trim(),
    baseElo: rating,
    elo: rating,
    createdAt: Date.now(),
    active: true,
    inTournament: false,
    origin: null,
  };
  await db.players.add(player);
  await recalculate(tournamentId);
  return id;
}
export const addPlayer = command('addPlayer', (tournamentId) => tournamentId, addPlayerImpl);

async function updatePlayerImpl(
  id: string,
  patch: Partial<Omit<Player, 'id' | 'tournamentId'>>,
): Promise<void> {
  const player = await db.players.get(id);
  if (!player) return;
  await db.players.update(id, patch);
  // Editing the base rating changes the starting point of the whole replay.
  await recalculate(player.tournamentId);
}
export const updatePlayer = command('updatePlayer', playerTournamentId, updatePlayerImpl);

async function deletePlayerImpl(id: string): Promise<void> {
  const player = await db.players.get(id);
  if (!player) return;
  await db.transaction('rw', db.players, db.matches, db.tournaments, async () => {
    await db.players.delete(id);
    // Any match the player took part in is no longer meaningful.
    const matches = await db.matches.where('tournamentId').equals(player.tournamentId).toArray();
    const affected = matches.filter(
      (match) => match.teamA.includes(id) || match.teamB.includes(id),
    );
    if (affected.length > 0) {
      await db.matches.bulkDelete(affected.map((match) => match.id));
    }
  });
  await recalculate(player.tournamentId);
}
export const deletePlayer = command('deletePlayer', playerTournamentId, deletePlayerImpl);

/** Copies a player list into another tournament, optionally carrying ratings. */
async function copyPlayers(
  sourceTournamentId: string,
  targetTournamentId: string,
  ratingSource: 'current' | 'base',
): Promise<number> {
  const source = await db.players.where('tournamentId').equals(sourceTournamentId).toArray();
  if (source.length === 0) return 0;

  const existing = await db.players.where('tournamentId').equals(targetTournamentId).toArray();
  const taken = new Set(existing.map((player) => player.name.toLowerCase()));

  const now = Date.now();
  const copies: Player[] = source
    .filter((player) => !taken.has(player.name.toLowerCase()))
    .map((player, index) => {
      const rating = ratingSource === 'current' ? player.elo : player.baseElo;
      return {
        id: makeId(),
        tournamentId: targetTournamentId,
        name: player.name,
        baseElo: rating,
        elo: rating,
        createdAt: now + index,
        active: true,
        inTournament: false,
        origin: { tournamentId: sourceTournamentId, playerId: player.id },
      };
    });

  if (copies.length > 0) await db.players.bulkAdd(copies);
  return copies.length;
}

/**
 * Clones players from another tournament into this one. Ratings are carried
 * over as the new base rating, so a series of evenings can build on each other
 * while every tournament still owns its own independent rating history.
 */
async function clonePlayersFromImpl(
  targetTournamentId: string,
  sourceTournamentId: string,
  ratingSource: 'current' | 'base',
): Promise<number> {
  const copied = await db.transaction('rw', db.players, db.tournaments, async () => {
    const count = await copyPlayers(sourceTournamentId, targetTournamentId, ratingSource);
    const source = await db.tournaments.get(sourceTournamentId);
    const target = await db.tournaments.get(targetTournamentId);
    if (source && target && !target.clonedFrom && count > 0) {
      await db.tournaments.update(targetTournamentId, {
        clonedFrom: { tournamentId: source.id, name: source.name },
      });
    }
    return count;
  });
  await recalculate(targetTournamentId);
  return copied;
}
export const clonePlayersFrom = command(
  'clonePlayersFrom',
  (targetTournamentId) => targetTournamentId,
  clonePlayersFromImpl,
);

/* ------------------------------------------------------------------------ */
/* Matches                                                                    */
/* ------------------------------------------------------------------------ */

function blankMatch(tournamentId: string, stage: MatchStage, overrides: Partial<Match>): Match {
  return {
    id: makeId(),
    tournamentId,
    stage,
    round: 1,
    order: 0,
    teamA: [],
    teamB: [],
    scoreA: null,
    scoreB: null,
    status: 'scheduled',
    bye: false,
    createdAt: Date.now(),
    playedAt: null,
    // 0 until a result is recorded; the replay only orders rated matches.
    sequence: 0,
    feedsWinnerTo: null,
    feedsLoserTo: null,
    labelA: null,
    labelB: null,
    ...overrides,
  };
}

function nextSequence(matches: Match[]): number {
  return matches.reduce((max, match) => Math.max(max, match.sequence), 0) + 1;
}

/** Puts a match on the pitch without a result yet. */
async function scheduleCasualMatchImpl(
  tournamentId: string,
  teamA: string[],
  teamB: string[],
): Promise<string> {
  const match = blankMatch(tournamentId, 'casual', { teamA, teamB });
  await db.matches.add(match);
  await touch(tournamentId);
  return match.id;
}
export const scheduleCasualMatch = command(
  'scheduleCasualMatch',
  (tournamentId) => tournamentId,
  scheduleCasualMatchImpl,
);

/** Records a finished ad-hoc match in one step. */
async function recordCasualResultImpl(
  tournamentId: string,
  teamA: string[],
  teamB: string[],
  scoreA: number,
  scoreB: number,
): Promise<string> {
  const id = await db.transaction('rw', db.matches, async () => {
    const existing = await db.matches.where('tournamentId').equals(tournamentId).toArray();
    const match = blankMatch(tournamentId, 'casual', {
      teamA,
      teamB,
      scoreA,
      scoreB,
      status: 'done',
      playedAt: Date.now(),
      sequence: nextSequence(existing),
    });
    await db.matches.add(match);
    return match.id;
  });
  await recalculate(tournamentId);
  return id;
}
export const recordCasualResult = command(
  'recordCasualResult',
  (tournamentId) => tournamentId,
  recordCasualResultImpl,
);

async function setMatchResultImpl(matchId: string, scoreA: number, scoreB: number): Promise<void> {
  const match = await db.matches.get(matchId);
  if (!match) return;

  await db.transaction('rw', db.matches, async () => {
    const siblings = await db.matches.where('tournamentId').equals(match.tournamentId).toArray();
    // A result keeps the position it first got, so correcting a score never
    // reshuffles the rating history of everything played afterwards.
    const sequence = match.sequence > 0 ? match.sequence : nextSequence(siblings);
    await db.matches.update(matchId, {
      scoreA,
      scoreB,
      status: 'done',
      playedAt: match.playedAt ?? Date.now(),
      sequence,
    });
  });

  await recalculate(match.tournamentId);
}
export const setMatchResult = command('setMatchResult', matchTournamentId, setMatchResultImpl);

async function clearMatchResultImpl(matchId: string): Promise<void> {
  const match = await db.matches.get(matchId);
  if (!match) return;
  await db.matches.update(matchId, {
    scoreA: null,
    scoreB: null,
    status: 'scheduled',
    playedAt: null,
    sequence: 0,
  });
  await recalculate(match.tournamentId);
}
export const clearMatchResult = command('clearMatchResult', matchTournamentId, clearMatchResultImpl);

async function deleteMatchImpl(matchId: string): Promise<void> {
  const match = await db.matches.get(matchId);
  if (!match) return;
  await db.matches.delete(matchId);
  await recalculate(match.tournamentId);
}
export const deleteMatch = command('deleteMatch', matchTournamentId, deleteMatchImpl);

async function swapMatchPlayersImpl(matchId: string, teamA: string[], teamB: string[]): Promise<void> {
  const match = await db.matches.get(matchId);
  if (!match) return;
  await db.matches.update(matchId, { teamA, teamB });
  await recalculate(match.tournamentId);
}
export const swapMatchPlayers = command('swapMatchPlayers', matchTournamentId, swapMatchPlayersImpl);

/* ------------------------------------------------------------------------ */
/* Tournament mode                                                            */
/* ------------------------------------------------------------------------ */

export interface StartTournamentResult {
  matches: number;
  rounds: number;
  /** Players that could not be placed in a team (odd field in an elimination). */
  unassigned: string[];
}

/** Turns a bracket plan's match drafts into storable matches. */
function matchesFromDrafts(tournamentId: string, drafts: BracketMatchDraft[]): Match[] {
  return drafts.map((draft) =>
    blankMatch(tournamentId, draft.stage, {
      id: draft.id,
      round: draft.round,
      order: draft.order,
      teamA: draft.teamA,
      teamB: draft.teamB,
      status: draft.status,
      bye: draft.bye,
      feedsWinnerTo: draft.feedsWinnerTo,
      feedsLoserTo: draft.feedsLoserTo,
      labelA: draft.labelA,
      labelB: draft.labelB,
    }),
  );
}

/** Builds the single-elimination bracket plan for an already-decided set of teams. */
function planEliminationBracket(
  teams: BracketTeam[],
  thirdPlaceMatch: boolean,
): { drafts: BracketMatchDraft[]; bracket: NonNullable<Tournament['bracket']> } {
  if (teams.length < 2) throw new Error('Zu wenige Teams fuer ein K.o.-Turnier');
  const plan = buildSingleElimination(teams, { thirdPlaceMatch, makeId });
  return {
    drafts: plan.matches,
    bracket: { format: 'single_elim', size: plan.size, teams, createdAt: Date.now() },
  };
}

/** Starts the countdown for a timed tournament's free-play phase. */
async function startFreePlayTimerImpl(tournamentId: string): Promise<void> {
  const tournament = await db.tournaments.get(tournamentId);
  if (!tournament?.timedMode || tournament.timedMode.timerStartedAt !== null) return;
  await updateTournamentImpl(tournamentId, {
    timedMode: { ...tournament.timedMode, timerStartedAt: Date.now() },
  });
}
export const startFreePlayTimer = command(
  'startFreePlayTimer',
  (tournamentId) => tournamentId,
  startFreePlayTimerImpl,
);

export interface StartDraftedBracketInput {
  tournamentId: string;
  /** Fixed teams as decided by the captain's draft. */
  teams: { playerIds: string[] }[];
  thirdPlaceMatch?: boolean;
}

/**
 * Commits the timed mode's captain-drafted teams into a single-elimination
 * bracket. The teams are already decided - only seeding (by combined rating)
 * and the bracket construction itself happen here. Players not part of any
 * team become spectators.
 */
async function startDraftedBracketImpl(
  input: StartDraftedBracketInput,
): Promise<StartTournamentResult> {
  const result = await db.transaction('rw', db.tournaments, db.players, db.matches, async () => {
    const tournament = await db.tournaments.get(input.tournamentId);
    if (!tournament) throw new Error('Turnier nicht gefunden');

    const players = await db.players.where('tournamentId').equals(input.tournamentId).toArray();
    const existingMatches = await db.matches
      .where('tournamentId')
      .equals(input.tournamentId)
      .toArray();

    const previous = existingMatches.filter((match) => match.stage !== 'casual');
    if (previous.length > 0) await db.matches.bulkDelete(previous.map((m) => m.id));

    const casualMatches = existingMatches.filter((match) => match.stage === 'casual');
    const replay = replayElo(players, casualMatches, tournament.elo);
    const nameOf = (id: string) => players.find((player) => player.id === id)?.name ?? '?';

    const drafted = new Set(input.teams.flatMap((team) => team.playerIds));
    await db.players.bulkPut(
      players.map((player) => ({ ...player, inTournament: drafted.has(player.id) })),
    );

    const teams = seedTeams(input.teams, replay.ratings, tournament.elo.baseElo, nameOf, makeId);
    const thirdPlaceMatch = input.thirdPlaceMatch ?? tournament.play.thirdPlaceMatch;
    const { drafts, bracket } = planEliminationBracket(teams, thirdPlaceMatch);
    const created = matchesFromDrafts(input.tournamentId, drafts);

    await db.matches.bulkAdd(created);
    await db.tournaments.update(input.tournamentId, {
      phase: 'tournament',
      status: 'running',
      format: 'single_elim',
      bracket,
      startedAt: Date.now(),
      finishedAt: null,
      updatedAt: Date.now(),
      play: {
        ...tournament.play,
        participantLimit: drafted.size,
        thirdPlaceMatch,
      },
    });

    return {
      matches: created.filter((match) => !match.bye).length,
      rounds: new Set(created.map((match) => match.round)).size,
      unassigned: [] as string[],
    };
  });

  await recalculate(input.tournamentId);
  return result;
}
export const startDraftedBracket = command(
  'startDraftedBracket',
  (input) => input.tournamentId,
  startDraftedBracketImpl,
);

async function finishTournamentImpl(tournamentId: string): Promise<void> {
  await updateTournamentImpl(tournamentId, { status: 'finished', finishedAt: Date.now() });
}
export const finishTournament = command('finishTournament', (tournamentId) => tournamentId, finishTournamentImpl);

async function reopenTournamentImpl(tournamentId: string): Promise<void> {
  await updateTournamentImpl(tournamentId, { status: 'running', finishedAt: null });
}
export const reopenTournament = command('reopenTournament', (tournamentId) => tournamentId, reopenTournamentImpl);

/** Drops the generated schedule and returns to the open ad-hoc queue. */
async function backToCasualImpl(tournamentId: string): Promise<void> {
  await db.transaction('rw', db.tournaments, db.players, db.matches, async () => {
    const matches = await db.matches.where('tournamentId').equals(tournamentId).toArray();
    const generated = matches.filter((match) => match.stage !== 'casual');
    if (generated.length > 0) await db.matches.bulkDelete(generated.map((m) => m.id));

    const players = await db.players.where('tournamentId').equals(tournamentId).toArray();
    await db.players.bulkPut(players.map((player) => ({ ...player, inTournament: false })));

    await db.tournaments.update(tournamentId, {
      phase: 'casual',
      status: 'open',
      format: null,
      bracket: null,
      startedAt: null,
      finishedAt: null,
      updatedAt: Date.now(),
    });
  });
  await recalculate(tournamentId);
}
export const backToCasual = command('backToCasual', (tournamentId) => tournamentId, backToCasualImpl);

/* ------------------------------------------------------------------------ */
/* Recalculation                                                              */
/* ------------------------------------------------------------------------ */

async function touch(tournamentId: string): Promise<void> {
  await db.tournaments.update(tournamentId, { updatedAt: Date.now() });
}

function matchesDiffer(a: Match, b: Match): boolean {
  return (
    a.teamA.join(',') !== b.teamA.join(',') ||
    a.teamB.join(',') !== b.teamB.join(',') ||
    a.scoreA !== b.scoreA ||
    a.scoreB !== b.scoreB ||
    a.status !== b.status ||
    a.bye !== b.bye ||
    a.playedAt !== b.playedAt ||
    a.feedsWinnerTo?.matchId !== b.feedsWinnerTo?.matchId ||
    a.feedsLoserTo?.matchId !== b.feedsLoserTo?.matchId
  );
}

/**
 * Re-derives everything that is not raw input: bracket progression and every
 * rating.
 *
 * Called after any mutation. Because it recomputes from scratch rather than
 * patching, correcting a score entered an hour ago repairs the whole
 * tournament rather than leaving the rest inconsistent.
 */
export async function recalculate(tournamentId: string): Promise<void> {
  await db.transaction('rw', db.tournaments, db.players, db.matches, async () => {
    const tournament = await db.tournaments.get(tournamentId);
    if (!tournament) return;

    const players = await db.players.where('tournamentId').equals(tournamentId).toArray();
    let matches = await db.matches.where('tournamentId').equals(tournamentId).toArray();

    if (tournament.phase === 'tournament' && tournament.format === 'single_elim') {
      matches = await syncBracket(tournament, matches);
    }

    const replay = replayElo(players, matches, tournament.elo);
    const changedPlayers = players
      .filter((player) => player.elo !== (replay.ratings[player.id] ?? player.baseElo))
      .map((player) => ({ ...player, elo: replay.ratings[player.id] ?? player.baseElo }));
    if (changedPlayers.length > 0) await db.players.bulkPut(changedPlayers);

    await db.tournaments.update(tournamentId, { updatedAt: Date.now() });
  });
}

/** Advances teams through the bracket from the recorded results. */
async function syncBracket(tournament: Tournament, matches: Match[]): Promise<Match[]> {
  const working = resolveBracket(matches);

  const byId = new Map(matches.map((match) => [match.id, match]));
  const changed = working.filter((match) => {
    const original = byId.get(match.id);
    return original === undefined || matchesDiffer(original, match);
  });
  if (changed.length > 0) await db.matches.bulkPut(changed);

  const result = bracketResult(working);
  if (result.complete && tournament.status !== 'finished') {
    await db.tournaments.update(tournament.id, {
      status: 'finished',
      finishedAt: Date.now(),
    });
  } else if (!result.complete && tournament.status === 'finished') {
    await db.tournaments.update(tournament.id, { status: 'running', finishedAt: null });
  }

  return working;
}
