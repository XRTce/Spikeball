import { useEffect, useState } from 'react';
import { Avatar, Button, Sheet } from '../ui';
import { cx } from '../lib/cx';
import { strings } from '../i18n';
import { usePlayerColors } from '../state/playerColors';
import type { Player } from '../domain/types';
import css from '../screens/PlayScreen.module.css';

type Assignment = 'A' | 'B';

/**
 * Manual team assignment: tapping a player cycles it through "unassigned" ->
 * "Team A" -> "Team B" -> "unassigned" (skipping a side once it is full), so
 * the organiser decides the actual pairing rather than just picking four
 * players for the app to balance.
 */
export function PlayerPickerSheet({
  open,
  onClose,
  players,
  ratings,
  teamSize,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  players: Player[];
  ratings: Readonly<Record<string, number>>;
  teamSize: number;
  onConfirm: (teamA: string[], teamB: string[]) => void | Promise<void>;
}) {
  const colors = usePlayerColors();
  const [assignments, setAssignments] = useState<Record<string, Assignment>>({});

  useEffect(() => {
    if (open) setAssignments({});
  }, [open]);

  const teamA = players.filter((player) => assignments[player.id] === 'A').map((p) => p.id);
  const teamB = players.filter((player) => assignments[player.id] === 'B').map((p) => p.id);

  const cycle = (id: string) => {
    setAssignments((current) => {
      const state = current[id];
      const countA = Object.values(current).filter((value) => value === 'A').length;
      const countB = Object.values(current).filter((value) => value === 'B').length;
      const next = { ...current };
      if (state === undefined) {
        if (countA < teamSize) next[id] = 'A';
        else if (countB < teamSize) next[id] = 'B';
        else return current;
      } else if (state === 'A') {
        if (countB < teamSize) next[id] = 'B';
        else delete next[id];
      } else {
        delete next[id];
      }
      return next;
    });
  };

  const complete = teamA.length === teamSize && teamB.length === teamSize;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={strings.play.chooseManually}
      subtitle={strings.play.teamsAssigned(teamA.length, teamB.length, teamSize)}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {strings.common.cancel}
          </Button>
          <Button
            variant="primary"
            icon="check"
            disabled={!complete}
            onClick={() => void onConfirm(teamA, teamB)}
          >
            {strings.play.startMatch}
          </Button>
        </>
      }
    >
      <div className={css.pickerGrid}>
        {players.map((player) => {
          const assignment = assignments[player.id];
          return (
            <button
              key={player.id}
              type="button"
              aria-pressed={assignment !== undefined}
              className={cx(
                css.pickerItem,
                assignment === 'A' && css.pickerTeamA,
                assignment === 'B' && css.pickerTeamB,
              )}
              onClick={() => cycle(player.id)}
            >
              <Avatar name={player.name} seed={player.id} size={28} color={colors.varOf(player.id)} />
              <span className={css.pickerName}>
                {player.name}
                {assignment && <span className={css.pickerTeamBadge}>{assignment}</span>}
                <br />
                <span className={css.pickerElo}>
                  {ratings[player.id] ?? player.elo} {strings.common.elo}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {players.length === 0 && <p className={css.pickerCount}>{strings.players.empty}</p>}
    </Sheet>
  );
}
