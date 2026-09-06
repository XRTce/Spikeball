import { db, makeId } from './db';
import {
  DEFAULT_ELO_SETTINGS,
  DEFAULT_PLAY_SETTINGS,
  isEliminationFormat,
  teamSize as teamSizeOf,
  type EloSettings,
  type Match,
  type MatchStage,
  type PlaySettings,
  type Player,
  type Tournament,
  type TournamentFormat,
} from '../domain/types';
import { replayElo } from '../domain/elo';
import { buildStandings } from '../domain/standings';
import { buildHistory, type PlannedMatch } from '../domain/pairing/utils';
import { roundRobinSchedule } from '../domain/pairing/roundRobin';
import { suggestedSwissRounds, swissRound } from '../domain/pairing/swiss';
import {
  bracketResult,
  buildBracket,
  buildBracketTeams,
  grandFinalResetState,
  resolveBracket,
  type BracketMatchDraft,
} from '../domain/pairing/elimination';

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
  matchFormat?: Tournament['matchFormat'];
  elo?: Partial<EloSettings>;
  play?: Partial<PlaySettings>;
  /** Copy the player list (and their ratings) out of an existing tournament. */
  cloneFrom?: { tournamentId: string; ratingSource: 'current' | 'base' };
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
    matchFormat: input.matchFormat ?? '2v2',
    format: null,
    elo: { ...DEFAULT_ELO_SETTINGS, ...input.elo },
    play: { ...DEFAULT_PLAY_SETTINGS, ...input.play },
    bracket: null,
    clonedFrom: null,
    startedAt: null,
    finishedAt: null,
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

export async function updateTournament(
  id: string,
  patch: Partial<Omit<Tournament, 'id'>>,
): Promise<void> {
  await db.tournaments.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteTournament(id: string): Promise<void> {
  await db.transaction('rw', db.tournaments, db.players, db.matches, async () => {
    await db.matches.where('tournamentId').equals(id).delete();
    await db.players.where('tournamentId').equals(id).delete();
    await db.tournaments.delete(id);
  });
}

export async function renameTournament(id: string, name: string): Promise<void> {
  await updateTournament(id, { name: name.trim() || 'Turnier' });
}

/* ------------------------------------------------------------------------ */
/* Players                                                                    */
/* ------------------------------------------------------------------------ */

export async function addPlayer(
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

export async function updatePlayer(
  id: string,
  patch: Partial<Omit<Player, 'id' | 'tournamentId'>>,
): Promise<void> {
  const player = await db.players.get(id);
  if (!player) return;
  await db.players.update(id, patch);
  // Editing the base rating changes the starting point of the whole replay.
  await recalculate(player.tournamentId);
}

export async function deletePlayer(id: string): Promise<void> {
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
export async function clonePlayersFrom(
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
export async function scheduleCasualMatch(
  tournamentId: string,
  teamA: string[],
  teamB: string[],
): Promise<string> {
  const match = blankMatch(tournamentId, 'casual', { teamA, teamB });
  await db.matches.add(match);
  await touch(tournamentId);
  return match.id;
}

/** Records a finished ad-hoc match in one step. */
export async function recordCasualResult(
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

export async function setMatchResult(
  matchId: string,
  scoreA: number,
  scoreB: number,
): Promise<void> {
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

export async function clearMatchResult(matchId: string): Promise<void> {
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

export async function deleteMatch(matchId: string): Promise<void> {
  const match = await db.matches.get(matchId);
  if (!match) return;
  await db.matches.delete(matchId);
  await recalculate(match.tournamentId);
}

export async function swapMatchPlayers(
  matchId: string,
  teamA: string[],
  teamB: string[],
): Promise<void> {
  const match = await db.matches.get(matchId);
  if (!match) return;
  await db.matches.update(matchId, { teamA, teamB });
  await recalculate(match.tournamentId);
}

/* ------------------------------------------------------------------------ */
/* Tournament mode                                                            */
/* ------------------------------------------------------------------------ */

export interface StartTournamentInput {
  tournamentId: string;
  format: TournamentFormat;
  participantIds: string[];
  swissRounds?: number;
  thirdPlaceMatch?: boolean;
  grandFinalReset?: boolean;
  seed?: number;
}

export interface StartTournamentResult {
  matches: number;
  rounds: number;
  /** Players that could not be placed in a team (odd field in an elimination). */
  unassigned: string[];
}

/**
 * Freezes the current ratings into a schedule.
 *
 * Group formats (round robin, Swiss) keep rotating partners. Elimination
 * formats need a stable entity to knock out, so the participants are first
 * paired into fixed teams; individual ratings keep updating from every match
 * either way.
 */
export async function startTournament(
  input: StartTournamentInput,
): Promise<StartTournamentResult> {
  const result = await db.transaction('rw', db.tournaments, db.players, db.matches, async () => {
    const tournament = await db.tournaments.get(input.tournamentId);
    if (!tournament) throw new Error('Turnier nicht gefunden');

    const players = await db.players.where('tournamentId').equals(input.tournamentId).toArray();
    const existingMatches = await db.matches
      .where('tournamentId')
      .equals(input.tournamentId)
      .toArray();

    // Anything previously generated is replaced; casual results are kept.
    const previous = existingMatches.filter((match) => match.stage !== 'casual');
    if (previous.length > 0) await db.matches.bulkDelete(previous.map((m) => m.id));

    const casualMatches = existingMatches.filter((match) => match.stage === 'casual');
    const replay = replayElo(players, casualMatches, tournament.elo);

    const participants = input.participantIds.filter((id) =>
      players.some((player) => player.id === id),
    );
    const size = teamSizeOf(tournament.matchFormat);

    await db.players.bulkPut(
      players.map((player) => ({
        ...player,
        inTournament: participants.includes(player.id),
      })),
    );

    const nameOf = (id: string) => players.find((player) => player.id === id)?.name ?? '?';
    let planned: PlannedMatch[] = [];
    let drafts: BracketMatchDraft[] = [];
    let bracket: Tournament['bracket'] = null;
    let unassigned: string[] = [];

    if (isEliminationFormat(input.format)) {
      const built = buildBracketTeams({
        playerIds: participants,
        ratings: replay.ratings,
        fallbackRating: tournament.elo.baseElo,
        teamSize: size,
        nameOf,
        makeId,
      });
      unassigned = built.unassigned;
      if (built.teams.length < 2) throw new Error('Zu wenige Teams fuer ein K.o.-Turnier');

      const plan = buildBracket(input.format, built.teams, {
        thirdPlaceMatch: input.thirdPlaceMatch ?? tournament.play.thirdPlaceMatch,
        makeId,
      });
      drafts = plan.matches;
      bracket = {
        format: input.format,
        size: plan.size,
        teams: built.teams,
        createdAt: Date.now(),
      };
    } else if (input.format === 'round_robin') {
      planned = roundRobinSchedule({
        playerIds: participants,
        ratings: replay.ratings,
        fallbackRating: tournament.elo.baseElo,
        teamSize: size,
        seed: input.seed ?? Date.now() % 100000,
      });
    } else {
      planned = swissRound({
        playerIds: participants,
        standings: [],
        ratings: replay.ratings,
        fallbackRating: tournament.elo.baseElo,
        history: buildHistory(participants, casualMatches),
        teamSize: size,
        round: 1,
      });
    }

    const stage: MatchStage = input.format === 'round_robin' ? 'round_robin' : 'swiss';
    const created: Match[] =
      drafts.length > 0
        ? drafts.map((draft) =>
            blankMatch(input.tournamentId, draft.stage, {
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
          )
        : planned.map((match) =>
            blankMatch(input.tournamentId, stage, {
              round: match.round,
              order: match.order,
              teamA: match.teamA,
              teamB: match.teamB,
              bye: match.bye,
              status: match.bye ? 'done' : 'scheduled',
            }),
          );

    if (created.length === 0) throw new Error('Kein Spielplan moeglich - zu wenige Spieler');
    await db.matches.bulkAdd(created);

    const swissRounds =
      input.swissRounds ?? suggestedSwissRounds(participants.length, size);

    await db.tournaments.update(input.tournamentId, {
      phase: 'tournament',
      status: 'running',
      format: input.format,
      bracket,
      startedAt: Date.now(),
      finishedAt: null,
      updatedAt: Date.now(),
      play: {
        ...tournament.play,
        swissRounds,
        participantLimit: participants.length,
        thirdPlaceMatch: input.thirdPlaceMatch ?? tournament.play.thirdPlaceMatch,
        grandFinalReset: input.grandFinalReset ?? tournament.play.grandFinalReset,
      },
    });

    return {
      matches: created.filter((match) => !match.bye).length,
      rounds: new Set(created.map((match) => match.round)).size,
      unassigned,
    };
  });

  await recalculate(input.tournamentId);
  return result;
}

/** Generates the next Swiss round once the current one is complete. */
export async function generateNextSwissRound(tournamentId: string): Promise<number> {
  const round = await db.transaction('rw', db.tournaments, db.players, db.matches, async () => {
    const tournament = await db.tournaments.get(tournamentId);
    if (!tournament || tournament.format !== 'swiss') return 0;

    const players = await db.players.where('tournamentId').equals(tournamentId).toArray();
    const matches = await db.matches.where('tournamentId').equals(tournamentId).toArray();
    const swissMatches = matches.filter((match) => match.stage === 'swiss');
    const lastRound = swissMatches.reduce((max, match) => Math.max(max, match.round), 0);

    const openInRound = swissMatches.some(
      (match) => match.round === lastRound && match.status !== 'done',
    );
    if (openInRound) return 0;
    if (lastRound >= tournament.play.swissRounds) return 0;

    const participants = players.filter((player) => player.inTournament).map((p) => p.id);
    const replay = replayElo(players, matches, tournament.elo);
    const standings = buildStandings(players, matches, replay, {
      playerIds: participants,
      stages: ['swiss'],
    });

    const planned = swissRound({
      playerIds: participants,
      standings,
      ratings: replay.ratings,
      fallbackRating: tournament.elo.baseElo,
      history: buildHistory(participants, matches),
      teamSize: teamSizeOf(tournament.matchFormat),
      round: lastRound + 1,
    });
    if (planned.length === 0) return 0;

    await db.matches.bulkAdd(
      planned.map((match) =>
        blankMatch(tournamentId, 'swiss', {
          round: match.round,
          order: match.order,
          teamA: match.teamA,
          teamB: match.teamB,
          bye: match.bye,
          status: match.bye ? 'done' : 'scheduled',
        }),
      ),
    );
    return lastRound + 1;
  });

  if (round > 0) await recalculate(tournamentId);
  return round;
}

export async function finishTournament(tournamentId: string): Promise<void> {
  await updateTournament(tournamentId, { status: 'finished', finishedAt: Date.now() });
}

export async function reopenTournament(tournamentId: string): Promise<void> {
  await updateTournament(tournamentId, { status: 'running', finishedAt: null });
}

/** Drops the generated schedule and returns to the open ad-hoc queue. */
export async function backToCasual(tournamentId: string): Promise<void> {
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
 * Re-derives everything that is not raw input: bracket progression, the
 * decider match in a double elimination, and every rating.
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

    if (tournament.phase === 'tournament' && isEliminationFormat(tournament.format)) {
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

/** Advances teams through the bracket and maintains the grand final decider. */
async function syncBracket(tournament: Tournament, matches: Match[]): Promise<Match[]> {
  let working = resolveBracket(matches);
  const removed: string[] = [];

  if (tournament.format === 'double_elim' && tournament.play.grandFinalReset) {
    const state = grandFinalResetState(working);
    const grandFinal = working.find((match) => match.stage === 'grand_final');
    const reset = working.find((match) => match.stage === 'grand_final_reset');

    if (state === 'needed' && grandFinal && !reset) {
      // The winners-bracket team lost once; they get their second chance. The
      // decider is fed by the final itself, so correcting the final's score
      // updates or removes it automatically.
      const decider = blankMatch(tournament.id, 'grand_final_reset', {
        round: grandFinal.round + 1,
        order: 0,
        labelA: 'Sieger Finale',
        labelB: 'Verlierer Finale',
      });
      const linkedFinal: Match = {
        ...grandFinal,
        feedsWinnerTo: { matchId: decider.id, slot: 'A' },
        feedsLoserTo: { matchId: decider.id, slot: 'B' },
      };
      working = resolveBracket([
        ...working.map((match) => (match.id === grandFinal.id ? linkedFinal : match)),
        decider,
      ]);
    } else if (state !== 'needed' && reset && grandFinal) {
      removed.push(reset.id);
      const unlinked: Match = { ...grandFinal, feedsWinnerTo: null, feedsLoserTo: null };
      working = resolveBracket(
        working
          .filter((match) => match.id !== reset.id)
          .map((match) => (match.id === grandFinal.id ? unlinked : match)),
      );
    }
  }

  if (removed.length > 0) await db.matches.bulkDelete(removed);

  const byId = new Map(matches.map((match) => [match.id, match]));
  // An absent original means the match was created during this pass (the
  // decider), so it has to be written rather than skipped.
  const changed = working.filter((match) => {
    const original = byId.get(match.id);
    return original === undefined || matchesDiffer(original, match);
  });
  if (changed.length > 0) await db.matches.bulkPut(changed);

  if (tournament.format) {
    const result = bracketResult(working, tournament.format);
    if (result.complete && tournament.status !== 'finished') {
      await db.tournaments.update(tournament.id, {
        status: 'finished',
        finishedAt: Date.now(),
      });
    } else if (!result.complete && tournament.status === 'finished') {
      await db.tournaments.update(tournament.id, { status: 'running', finishedAt: null });
    }
  }

  return working;
}
