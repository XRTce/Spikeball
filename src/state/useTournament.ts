import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { replayElo, type EloReplay } from '../domain/elo';
import { buildStandings } from '../domain/standings';
import { buildHistory, type PlayHistory } from '../domain/pairing/utils';
import {
  teamSize as teamSizeOf,
  type Match,
  type Player,
  type StandingRow,
  type Tournament,
} from '../domain/types';

export interface TournamentView {
  loading: boolean;
  tournament: Tournament | null;
  players: Player[];
  activePlayers: Player[];
  participants: Player[];
  matches: Match[];
  casualMatches: Match[];
  tournamentMatches: Match[];
  playerById: Map<string, Player>;
  replay: EloReplay;
  ratings: Record<string, number>;
  standings: StandingRow[];
  history: PlayHistory;
  teamSize: number;
}

const EMPTY_REPLAY: EloReplay = { ratings: {}, matchesPlayed: {}, history: [], perMatch: {} };

/**
 * Single read model for a tournament screen.
 *
 * Ratings, standings and pairing history are derived here rather than stored,
 * so every screen sees exactly the same numbers and a corrected result is
 * reflected everywhere at once. Dexie's live query re-runs this whenever the
 * underlying tables change.
 */
export function useTournament(tournamentId: string | undefined): TournamentView {
  const data = useLiveQuery(async () => {
    if (!tournamentId) return null;
    const tournament = await db.tournaments.get(tournamentId);
    if (!tournament) return { tournament: null, players: [], matches: [] };
    const [players, matches] = await Promise.all([
      db.players.where('tournamentId').equals(tournamentId).toArray(),
      db.matches.where('tournamentId').equals(tournamentId).toArray(),
    ]);
    return { tournament, players, matches };
  }, [tournamentId]);

  return useMemo<TournamentView>(() => {
    if (!data) {
      return {
        loading: true,
        tournament: null,
        players: [],
        activePlayers: [],
        participants: [],
        matches: [],
        casualMatches: [],
        tournamentMatches: [],
        playerById: new Map(),
        replay: EMPTY_REPLAY,
        ratings: {},
        standings: [],
        history: { played: {}, lastSeen: {}, partnered: {}, faced: {}, byes: {} },
        teamSize: 2,
      };
    }

    const { tournament, matches } = data;
    const players = [...data.players].sort((a, b) => a.createdAt - b.createdAt);
    const replay = tournament ? replayElo(players, matches, tournament.elo) : EMPTY_REPLAY;
    const standings = tournament ? buildStandings(players, matches, replay) : [];

    return {
      loading: false,
      tournament,
      players,
      activePlayers: players.filter((player) => player.active),
      participants: players.filter((player) => player.inTournament),
      matches,
      casualMatches: matches.filter((match) => match.stage === 'casual'),
      tournamentMatches: matches.filter((match) => match.stage !== 'casual'),
      playerById: new Map(players.map((player) => [player.id, player])),
      replay,
      ratings: replay.ratings,
      standings,
      history: buildHistory(
        players.map((player) => player.id),
        matches,
      ),
      teamSize: tournament ? teamSizeOf(tournament.matchFormat) : 2,
    };
  }, [data]);
}

export function useTournamentList() {
  return useLiveQuery(async () => {
    const tournaments = await db.tournaments.orderBy('updatedAt').reverse().toArray();
    const [players, matches] = await Promise.all([db.players.toArray(), db.matches.toArray()]);

    const playerCount = new Map<string, number>();
    for (const player of players) {
      playerCount.set(player.tournamentId, (playerCount.get(player.tournamentId) ?? 0) + 1);
    }
    const matchCount = new Map<string, number>();
    for (const match of matches) {
      if (match.status !== 'done' || match.bye) continue;
      matchCount.set(match.tournamentId, (matchCount.get(match.tournamentId) ?? 0) + 1);
    }

    return tournaments.map((tournament) => ({
      tournament,
      players: playerCount.get(tournament.id) ?? 0,
      matches: matchCount.get(tournament.id) ?? 0,
    }));
  }, []);
}
