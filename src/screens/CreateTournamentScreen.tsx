import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AppBar,
  Button,
  Icon,
  NumberStepper,
  Screen,
  SelectField,
  Segmented,
  Shell,
  Switch,
  TextField,
  useToast,
} from '../ui';
import { OptionList } from '../components/OptionList';
import { cx } from '../lib/cx';
import { strings } from '../i18n';
import { createTournament } from '../db/repo';
import { useTournamentList } from '../state/useTournament';
import { DEFAULT_ELO_SETTINGS, DEFAULT_PLAY_SETTINGS, type MatchFormat } from '../domain/types';
import css from '../styles/forms.module.css';

const s = strings;

export function CreateTournamentScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const existing = useTournamentList() ?? [];

  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [matchFormat, setMatchFormat] = useState<MatchFormat>('2v2');
  const [baseElo, setBaseElo] = useState(DEFAULT_ELO_SETTINGS.baseElo);
  const [pointsToWin, setPointsToWin] = useState(DEFAULT_PLAY_SETTINGS.pointsToWin);
  const [kFactor, setKFactor] = useState(DEFAULT_ELO_SETTINGS.kFactor);
  const [provisionalK, setProvisionalK] = useState(DEFAULT_ELO_SETTINGS.kFactorProvisional);
  const [provisionalMatches, setProvisionalMatches] = useState(
    DEFAULT_ELO_SETTINGS.provisionalMatches,
  );
  const [useMov, setUseMov] = useState(DEFAULT_ELO_SETTINGS.useMarginOfVictory);
  const [cloneId, setCloneId] = useState('');
  const [ratingSource, setRatingSource] = useState<'current' | 'base'>('current');
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const id = await createTournament({
        name,
        note,
        matchFormat,
        elo: {
          baseElo,
          kFactor,
          kFactorProvisional: provisionalK,
          provisionalMatches,
          useMarginOfVictory: useMov,
        },
        play: { pointsToWin },
        ...(cloneId ? { cloneFrom: { tournamentId: cloneId, ratingSource } } : {}),
      });
      navigate(`/t/${id}`, { replace: true });
    } catch (error) {
      console.error(error);
      toast.error(s.errors.generic);
      setBusy(false);
    }
  };

  return (
    <Shell>
      <AppBar title={s.create.title} back="/" />
      <Screen>
        <form
          className={css.form}
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className={css.group}>
            <TextField
              label={s.create.name}
              placeholder={s.create.namePlaceholder}
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              autoFocus
              enterKeyHint="next"
              maxLength={60}
            />
            <TextField
              label={s.create.note}
              placeholder={s.create.notePlaceholder}
              value={note}
              onChange={(event) => setNote(event.currentTarget.value)}
              maxLength={120}
            />
          </div>

          <div className={css.group}>
            <div>
              <div className={css.groupTitle} style={{ marginBottom: 'var(--space-2)' }}>
                {s.create.format}
              </div>
              <Segmented
                ariaLabel={s.create.format}
                value={matchFormat}
                onChange={setMatchFormat}
                options={[
                  { value: '2v2', label: s.create.doubles },
                  { value: '1v1', label: s.create.singles },
                ]}
              />
            </div>
            <NumberStepper
              label={s.create.baseElo}
              hint={s.create.baseEloHint}
              value={baseElo}
              onChange={setBaseElo}
              min={100}
              max={3000}
              step={25}
            />
          </div>

          {existing.length > 0 && (
            <div className={css.group}>
              <div className={css.groupTitle}>{s.create.clone}</div>
              <SelectField
                value={cloneId}
                onChange={(event) => setCloneId(event.currentTarget.value)}
                aria-label={s.create.clone}
              >
                <option value="">{s.create.cloneNone}</option>
                {existing.map(({ tournament, players }) => (
                  <option key={tournament.id} value={tournament.id}>
                    {tournament.name} ({players})
                  </option>
                ))}
              </SelectField>
              {cloneId && (
                <>
                  <OptionList
                    ariaLabel={s.create.cloneRating}
                    value={ratingSource}
                    onChange={setRatingSource}
                    options={[
                      {
                        value: 'current',
                        label: s.create.cloneCurrent,
                        text: 'Der Stand am Ende des alten Turniers wird zur neuen Start-Elo.',
                      },
                      {
                        value: 'base',
                        label: s.create.cloneBase,
                        text: 'Alle starten wieder mit dem Wert, mit dem sie damals begonnen haben.',
                      },
                    ]}
                  />
                  <p className={css.hint}>{s.create.cloneHint}</p>
                </>
              )}
            </div>
          )}

          <div className={css.group}>
            <button
              type="button"
              className={cx(css.disclosure, advanced && css.disclosureOpen)}
              onClick={() => setAdvanced((open) => !open)}
              aria-expanded={advanced}
            >
              {s.create.advanced}
              <Icon
                name="chevronDown"
                size={18}
                className={cx(css.chevron, advanced && css.chevronOpen)}
              />
            </button>
            {advanced && (
              <>
                <div className={css.twoUp}>
                  <NumberStepper
                    label="K-Faktor"
                    value={kFactor}
                    onChange={setKFactor}
                    min={8}
                    max={64}
                    step={2}
                  />
                  <NumberStepper
                    label="K (neu)"
                    value={provisionalK}
                    onChange={setProvisionalK}
                    min={8}
                    max={80}
                    step={2}
                  />
                </div>
                <NumberStepper
                  label="Spiele bis etabliert"
                  hint="Bis dahin gilt der hoehere K-Faktor"
                  value={provisionalMatches}
                  onChange={setProvisionalMatches}
                  min={0}
                  max={40}
                />
                <NumberStepper
                  label="Spiel bis"
                  hint="Zielpunktzahl fuer die Ergebniseingabe"
                  value={pointsToWin}
                  onChange={setPointsToWin}
                  min={5}
                  max={51}
                />
                <Switch
                  checked={useMov}
                  onChange={setUseMov}
                  label="Deutlichkeit des Siegs einrechnen"
                  hint="Ein 21:3 zaehlt mehr als ein 21:19."
                />
              </>
            )}
          </div>

          <div className={css.submitRow}>
            <Button type="submit" variant="primary" size="lg" icon="check" block busy={busy}>
              {s.create.submit}
            </Button>
          </div>
        </form>
      </Screen>
    </Shell>
  );
}
