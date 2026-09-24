import { useCallback, useMemo, useState } from 'react';
import type { Player } from '../domain/types';

const KEY_PREFIX = 'rally:absent:';

function readAbsent(tournamentId: string): string[] {
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + tournamentId);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function writeAbsent(tournamentId: string, ids: readonly string[]) {
  try {
    if (ids.length === 0) sessionStorage.removeItem(KEY_PREFIX + tournamentId);
    else sessionStorage.setItem(KEY_PREFIX + tournamentId, JSON.stringify(ids));
  } catch {
    // Private browsing or a full quota just means the filter does not
    // survive a reload - no worse than plain component state.
  }
}

/**
 * The "Verfügbare Spieler" filter: which active players the organiser has
 * marked as present. `null` means nobody is marked absent, i.e. no filter.
 *
 * It lives in sessionStorage, keyed by tournament, so it survives switching
 * tabs (which unmounts the play screen) and a reload, but not the next
 * session - a stale "who is here" list from last week would silently hide
 * players. It is deliberately not on the tournament row: it is a per-device
 * suggestion filter, not tournament data that should sync to other phones.
 *
 * What is stored is who is *absent*, and the result is always intersected
 * with the current active players. So a player deleted or paused afterwards
 * simply drops out, and someone added later counts as present instead of
 * being hidden by a list that predates them.
 */
export function useAvailablePlayers(
  tournamentId: string,
  activePlayers: readonly Player[],
): [Set<string> | null, (ids: ReadonlySet<string>) => void] {
  // Keyed by tournament so switching tournaments never shows the previous
  // one's filter, not even for a single render.
  const [stored, setStored] = useState(() => ({
    tournamentId,
    absent: readAbsent(tournamentId),
  }));
  const absentIds =
    stored.tournamentId === tournamentId ? stored.absent : readAbsent(tournamentId);

  const availableIds = useMemo(() => {
    const absent = new Set(absentIds);
    if (!activePlayers.some((player) => absent.has(player.id))) return null;
    return new Set(
      activePlayers.filter((player) => !absent.has(player.id)).map((player) => player.id),
    );
  }, [absentIds, activePlayers]);

  const setAvailableIds = useCallback(
    (ids: ReadonlySet<string>) => {
      const absent = activePlayers
        .filter((player) => !ids.has(player.id))
        .map((player) => player.id);
      writeAbsent(tournamentId, absent);
      setStored({ tournamentId, absent });
    },
    [activePlayers, tournamentId],
  );

  return [availableIds, setAvailableIds];
}
