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
import { DEFAULT_ELO_SETTINGS, DEFAULT_PLAY_SETTINGS } from '../domain/types';
import { LIMITS } from '../sync/protocol';
import { SyncError, publishTournament, useServerAvailable } from '../sync';
import css from '../styles/forms.module.css';

const s = strings;

export function CreateTournamentScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const existing = useTournamentList() ?? [];
  const serverAvailable = useServerAvailable();

  const [visibility, setVisibility] = useState<'local' | 'public'>('local');
  const [password, setPassword] = useState('');
  const passwordError =
    password.length > 0 && password.length < LIMITS.passwordMin
      ? s.create.passwordTooShort(LIMITS.passwordMin)
      : undefined;

  const [name, setName] = useState('');
  const [note, setNote] = useState('');
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
  const [mode, setMode] = useState<'manual' | 'timed'>('manual');
  const [freePlayHours, setFreePlayHours] = useState(1);
  const [draftSize, setDraftSize] = useState(8);
  const [maxPartnerRepeats, setMaxPartnerRepeats] = useState(0);

  const submit = async () => {
    setBusy(true);
    try {
      const id = await createTournament({
        name,
        note,
        elo: {
          baseElo,
          kFactor,
          kFactorProvisional: provisionalK,
          provisionalMatches,
          useMarginOfVictory: useMov,
        },
        play: { pointsToWin },
        ...(cloneId ? { cloneFrom: { tournamentId: cloneId, ratingSource } } : {}),
        timedMode:
          mode === 'timed'
            ? {
                freePlayMinutes: freePlayHours * 60,
                draftSize,
                maxPartnerRepeats: maxPartnerRepeats > 0 ? maxPartnerRepeats : null,
              }
            : null,
      });

      if (visibility === 'public') {
        try {
          // Works offline too - the upload is queued and the share sheet
          // still shows a scannable link, it just says "not uploaded yet".
          // A SyncError here just means offline/unavailable, which is the
          // expected queued path, not a failure worth interrupting for.
          await publishTournament(id, password || null);
        } catch (error) {
          if (!(error instanceof SyncError)) {
            console.error(error);
            toast.error(s.errors.generic);
          }
        }
      }

      navigate(`/t/${id}`, {
        replace: true,
        state: visibility === 'public' ? { openShareSheet: true } : undefined,
      });
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
                {s.create.visibility}
              </div>
              <Segmented
                ariaLabel={s.create.visibility}
                value={visibility}
                onChange={(value) => {
                  if (value === 'public' && serverAvailable !== true) return;
                  setVisibility(value);
                }}
                options={[
                  { value: 'local', label: s.create.visibilityLocal },
                  {
                    value: 'public',
                    label: serverAvailable === null ? (
                      <>
                        {s.create.visibilityPublic}
                        <span className={css.hint}> · {s.create.visibilityCheckingHint}</span>
                      </>
                    ) : (
                      s.create.visibilityPublic
                    ),
                  },
                ]}
              />
            </div>
            <p className={css.hint}>
              {visibility === 'local' ? s.create.visibilityLocalHint : s.create.visibilityPublicHint}
            </p>
            {serverAvailable === false && (
              <p className={css.hint}>{s.create.visibilityUnavailableHint}</p>
            )}
            {visibility === 'public' && (
              <>
                <TextField
                  label={s.create.password}
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.currentTarget.value)}
                  autoComplete="new-password"
                  error={passwordError}
                />
                <p className={css.hint}>
                  {s.create.passwordHint} {s.create.passwordProtects}{' '}
                  {[
                    s.sync.reasons.delete_player,
                    s.sync.reasons.delete_result,
                    s.sync.reasons.settings,
                    s.sync.reasons.start,
                    s.sync.reasons.bracket,
                    s.sync.reasons.delete_tournament,
                  ].join(', ')}
                  .
                </p>
              </>
            )}
          </div>

          <div className={css.group}>
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

          <div className={css.group}>
            <div>
              <div className={css.groupTitle} style={{ marginBottom: 'var(--space-2)' }}>
                {s.create.mode}
              </div>
              <Segmented
                ariaLabel={s.create.mode}
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'manual', label: s.create.modeManual },
                  { value: 'timed', label: s.create.modeTimed },
                ]}
              />
            </div>
            {mode === 'timed' && (
              <>
                <p className={css.hint}>{s.create.modeTimedHint}</p>
                <NumberStepper
                  label={s.create.timedFreePlay}
                  hint={s.create.timedFreePlayHint}
                  value={freePlayHours}
                  onChange={setFreePlayHours}
                  min={1}
                  max={12}
                  step={1}
                />
                <NumberStepper
                  label={s.create.timedDraftSize}
                  hint={s.create.timedDraftSizeHint}
                  value={draftSize}
                  onChange={(value) => setDraftSize(value - (value % 2))}
                  min={4}
                  max={32}
                  step={2}
                />
                <NumberStepper
                  label={s.create.maxPartnerRepeats}
                  hint={
                    maxPartnerRepeats === 0
                      ? s.create.maxPartnerRepeatsUnlimited
                      : s.create.maxPartnerRepeatsHint
                  }
                  value={maxPartnerRepeats}
                  onChange={setMaxPartnerRepeats}
                  min={0}
                  max={10}
                />
              </>
            )}
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
                        text: s.create.cloneCurrentText,
                      },
                      {
                        value: 'base',
                        label: s.create.cloneBase,
                        text: s.create.cloneBaseText,
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
                    label={s.create.kFactor}
                    value={kFactor}
                    onChange={setKFactor}
                    min={8}
                    max={64}
                    step={2}
                  />
                  <NumberStepper
                    label={s.create.provisionalK}
                    value={provisionalK}
                    onChange={setProvisionalK}
                    min={8}
                    max={80}
                    step={2}
                  />
                </div>
                <NumberStepper
                  label={s.create.provisionalMatches}
                  hint={s.create.provisionalMatchesHint}
                  value={provisionalMatches}
                  onChange={setProvisionalMatches}
                  min={0}
                  max={40}
                />
                <NumberStepper
                  label={s.create.pointsToWin}
                  hint={s.create.pointsToWinHint}
                  value={pointsToWin}
                  onChange={setPointsToWin}
                  min={5}
                  max={51}
                />
                <Switch
                  checked={useMov}
                  onChange={setUseMov}
                  label={s.create.marginOfVictory}
                  hint={s.create.marginOfVictoryHint}
                />
              </>
            )}
          </div>

          <div className={css.submitRow}>
            <Button
              type="submit"
              variant="primary"
              size="lg"
              icon="check"
              block
              busy={busy}
              disabled={!!passwordError}
            >
              {s.create.submit}
            </Button>
          </div>
        </form>
      </Screen>
    </Shell>
  );
}
