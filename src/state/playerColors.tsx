import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { SERIES_COLORS, SERIES_COUNT, seriesHex, seriesVar } from '../ui/palette';
import type { Player } from '../domain/types';

interface PlayerColors {
  /** CSS custom property, so avatars and chips follow the theme. */
  varOf: (playerId: string) => string;
  /** Literal hex, for the canvas export where CSS variables do not exist. */
  hexOf: (playerId: string) => string;
}

/**
 * Assigns each player a colour by their position in the tournament roster
 * rather than by hashing their id.
 *
 * Hashing into a fixed palette collides constantly - with eight players and
 * twelve colours a clash is more likely than not - and two identically
 * coloured lines make the Elo chart unreadable. Position-based assignment
 * guarantees distinct colours for the first twelve players and stays stable
 * for the life of the tournament.
 */
const PlayerColorContext = createContext<PlayerColors | null>(null);

const fallback: PlayerColors = { varOf: seriesVar, hexOf: seriesHex };

export function PlayerColorProvider({
  players,
  children,
}: {
  players: Player[];
  children: ReactNode;
}) {
  const value = useMemo<PlayerColors>(() => {
    const index = new Map<string, number>();
    players.forEach((player, position) => index.set(player.id, position % SERIES_COUNT));
    return {
      varOf: (playerId) => {
        const slot = index.get(playerId);
        return slot === undefined ? seriesVar(playerId) : `var(--series-${slot + 1})`;
      },
      hexOf: (playerId) => {
        const slot = index.get(playerId);
        return slot === undefined ? seriesHex(playerId) : SERIES_COLORS[slot]!;
      },
    };
  }, [players]);

  return <PlayerColorContext.Provider value={value}>{children}</PlayerColorContext.Provider>;
}

/** Falls back to hashing when used outside a tournament. */
export function usePlayerColors(): PlayerColors {
  return useContext(PlayerColorContext) ?? fallback;
}
