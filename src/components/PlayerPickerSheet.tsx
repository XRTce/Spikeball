import { useEffect, useState } from 'react';
import { Avatar, Button, Sheet } from '../ui';
import { cx } from '../lib/cx';
import { strings } from '../i18n';
import { usePlayerColors } from '../state/playerColors';
import type { Player } from '../domain/types';
import css from '../screens/PlayScreen.module.css';

/**
 * Manual line-up. Exactly `count` players must be chosen; the teams themselves
 * are still balanced by the app so a hand-picked four is not lopsided.
 */
export function PlayerPickerSheet({
  open,
  onClose,
  players,
  ratings,
  count,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  players: Player[];
  ratings: Readonly<Record<string, number>>;
  count: number;
  onConfirm: (ids: string[]) => void | Promise<void>;
}) {
  const colors = usePlayerColors();
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (open) setSelected([]);
  }, [open]);

  const toggle = (id: string) => {
    setSelected((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length >= count) return current;
      return [...current, id];
    });
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={strings.play.chooseManually}
      subtitle={`${selected.length} von ${count} gewaehlt`}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            {strings.common.cancel}
          </Button>
          <Button
            variant="primary"
            icon="check"
            disabled={selected.length !== count}
            onClick={() => void onConfirm(selected)}
          >
            {strings.play.startMatch}
          </Button>
        </>
      }
    >
      <div className={css.pickerGrid}>
        {players.map((player) => {
          const isSelected = selected.includes(player.id);
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
