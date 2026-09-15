/** Single-elimination is the only bracket format the app produces. */
export type TournamentFormat = 'single_elim';

/** `casual` = open queue, `tournament` = a generated schedule is running. */
export type TournamentPhase = 'casual' | 'tournament';

export type TournamentStatus = 'open' | 'running' | 'finished';

export type MatchStage = 'casual' | 'winners' | 'third_place';

export type MatchStatus = 'scheduled' | 'done';

export type Slot = 'A' | 'B';

export interface EloSettings {
  /** Rating every new player starts from. */
  baseElo: number;
  /** K for settled players. */
  kFactor: number;
  /** Higher K while a player is still provisional, so ratings converge fast. */
  kFactorProvisional: number;
  /** Number of matches after which a player stops being provisional. */
  provisionalMatches: number;
  /** Scale the rating change by the score margin (538 MOV multiplier). */
  useMarginOfVictory: boolean;
}

export interface PlaySettings {
  /** Target score, used to pre-fill the result entry. */
  pointsToWin: number;
  /** Only the n highest-rated players enter the tournament; null = everyone. */
  participantLimit: number | null;
  /** Play a match for third place - only meaningful with at least 4 teams. */
  thirdPlaceMatch: boolean;
}

export interface BracketTeam {
  id: string;
  playerIds: string[];
  seed: number;
  name: string;
}

export interface BracketMeta {
  format: TournamentFormat;
  size: number;
  teams: BracketTeam[];
  createdAt: number;
}

/**
 * Turniermodus: a time-boxed free-play phase, after which the best
 * `draftSize` players are drafted into fixed teams for a single-elimination
 * bracket. `null` on a tournament means Liga-Modus - open-ended free play
 * that never transitions into a bracket.
 */
export interface TimedModeSettings {
  /** Configured duration of the free-play phase. */
  freePlayMinutes: number;
  /** X - how many of the best players enter the bracket. Always even. */
  draftSize: number;
  /** Set when the tournament master manually starts the countdown. */
  timerStartedAt: number | null;
  /** Max times two players may share a team before auto-matching avoids repeating it; null = unlimited. */
  maxPartnerRepeats: number | null;
}

export interface Tournament {
  id: string;
  name: string;
  note: string;
  createdAt: number;
  updatedAt: number;
  phase: TournamentPhase;
  status: TournamentStatus;
  format: TournamentFormat | null;
  elo: EloSettings;
  play: PlaySettings;
  bracket: BracketMeta | null;
  clonedFrom: { tournamentId: string; name: string } | null;
  startedAt: number | null;
  finishedAt: number | null;
  timedMode: TimedModeSettings | null;
}

export interface Player {
  id: string;
  tournamentId: string;
  name: string;
  /** Rating the player entered this tournament with. Elo replays from here. */
  baseElo: number;
  /** Denormalised current rating; always the output of the last replay. */
  elo: number;
  createdAt: number;
  /** Available for matchmaking (false = injured / went home). */
  active: boolean;
  /** Selected into the running tournament schedule. */
  inTournament: boolean;
  /** Where this player was cloned from, for traceability. */
  origin: { tournamentId: string; playerId: string } | null;
}

export interface MatchFeed {
  matchId: string;
  slot: Slot;
}

export interface Match {
  id: string;
  tournamentId: string;
  stage: MatchStage;
  /** 1-based round number within the stage. */
  round: number;
  /** Position within the round, used for stable ordering and bracket layout. */
  order: number;
  teamA: string[];
  teamB: string[];
  scoreA: number | null;
  scoreB: number | null;
  status: MatchStatus;
  /** Walkover: counted for progression but never for Elo. */
  bye: boolean;
  createdAt: number;
  playedAt: number | null;
  /** Monotonic counter defining the Elo replay order. */
  sequence: number;
  feedsWinnerTo: MatchFeed | null;
  feedsLoserTo: MatchFeed | null;
  /** Placeholder text shown while a slot is not decided yet. */
  labelA: string | null;
  labelB: string | null;
}

export interface StandingRow {
  playerId: string;
  name: string;
  played: number;
  wins: number;
  losses: number;
  pointsFor: number;
  pointsAgainst: number;
  pointDiff: number;
  winRate: number;
  elo: number;
  baseElo: number;
  eloChange: number;
  /** Most recent results first, `true` = win. */
  form: boolean[];
}

export const DEFAULT_ELO_SETTINGS: EloSettings = {
  baseElo: 1000,
  kFactor: 24,
  kFactorProvisional: 40,
  provisionalMatches: 8,
  useMarginOfVictory: true,
};

export const DEFAULT_PLAY_SETTINGS: PlaySettings = {
  pointsToWin: 21,
  participantLimit: null,
  thirdPlaceMatch: true,
};
