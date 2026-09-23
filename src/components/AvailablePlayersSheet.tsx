import { useEffect, useState } from 'react';
import { Avatar, Button, Sheet } from '../ui';
import { cx } from '../lib/cx';
import { strings } from '../i18n';
import { usePlayerColors } from '../state/playerColors';
import type { Player } from '../domain/types';
import css from '../screens/PlayScreen.module.css';

/**
 * Lets the organiser mark who is actually present right now. The automatic
 * suggestion and the manual picker both only draw from this set, so someone
 * who stepped away is not proposed for the next match.
 */
export function AvailablePlayersSheet({
  open,
  onClose,
  players,
  ratings,
  selected,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  players: Player[];
  ratings: Readonly<Record<string, number>>;
  selected: ReadonlySet<string>;
  onConfirm: (ids: string[]) => void;
}) {
  const colors = usePlayerColors();
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (open) setChosen(new Set(selected));
  }, [open, selected]);

  const toggle = (id: string) => {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = players.length > 0 && chosen.size === players.length;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={strings.play.availablePlayers}
      subtitle={strings.play.availableCount(chosen.size, players.length)}
      actions={
        <>
          <Button
            variant="secondary"
            onClick={() => setChosen(allSelected ? new Set() : new Set(players.map((p) => p.id)))}
          >
            {allSelected ? strings.play.selectNone : strings.play.selectAll}
          </Button>
          <Button variant="primary" icon="check" onClick={() => onConfirm([...chosen])}>
            {strings.common.save}
          </Button>
        </>
      }
    >
      <div className={css.pickerGrid}>
        {players.map((player) => {
          const isSelected = chosen.has(player.id);
          return (
            <button
              key={player.id}
              type="button"
              aria-pressed={isSelected}
              className={cx(css.pickerItem, isSelected && css.pickerSelected)}
              onClick={() => toggle(player.id)}
            >
              <Avatar name={player.name} seed={player.id} size={28} color={colors.varOf(player.id)} />
              <span className={css.pickerName}>
                {player.name}
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
