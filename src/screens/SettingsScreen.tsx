import { useEffect, useRef, useState } from 'react';
import {
  AppBar,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  Icon,
  Screen,
  SectionTitle,
  Segmented,
  Shell,
  Stack,
  useToast,
} from '../ui';
import { Logo } from '../components/Logo';
import { strings, formatBytes } from '../i18n';
import { useTheme, type ThemePreference } from '../state/theme';
import { requestPersistentStorage, type StorageStatus } from '../db/db';
import {
  backupFileName,
  eraseEverything,
  exportBackup,
  importBackup,
  parseBackup,
} from '../db/backup';
import { downloadBlob } from '../lib/download';
import form from '../styles/forms.module.css';
import css from './SettingsScreen.module.css';

const s = strings;

export function SettingsScreen() {
  const { preference, setPreference } = useTheme();
  const toast = useToast();
  const fileInput = useRef<HTMLInputElement>(null);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [confirmErase, setConfirmErase] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void requestPersistentStorage().then(setStorage);
  }, []);

  const doExport = async () => {
    setBusy(true);
    try {
      const backup = await exportBackup();
      downloadBlob(
        new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }),
        backupFileName(),
      );
      toast.success('Backup gespeichert');
    } catch (error) {
      console.error(error);
      toast.error(s.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  const doImport = async (file: File) => {
    setBusy(true);
    try {
      const result = await importBackup(parseBackup(await file.text()));
      toast.success(s.settings.importSuccess(result.tournaments));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : s.errors.generic);
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const storageTone =
    storage?.mode === 'persistent' ? 'win' : storage?.mode === 'best-effort' ? 'warn' : 'neutral';
  const storageLabel =
    storage?.mode === 'persistent'
      ? s.settings.storagePersistent
      : storage?.mode === 'best-effort'
        ? s.settings.storageBestEffort
        : s.settings.storageUnsupported;

  return (
    <Shell>
      <AppBar title={s.settings.title} back="/" />
      <Screen>
        <Stack>
          <SectionTitle>{s.settings.appearance}</SectionTitle>
          <Card padded>
            <Segmented
              ariaLabel={s.settings.theme}
              value={preference}
              onChange={(value) => setPreference(value as ThemePreference)}
              options={[
                { value: 'system', label: s.settings.themeSystem },
                { value: 'light', label: s.settings.themeLight },
                { value: 'dark', label: s.settings.themeDark },
              ]}
            />
          </Card>

          <SectionTitle>{s.settings.storage}</SectionTitle>
          <Card>
            <CardHeader
              title={storageLabel}
              subtitle={
                storage?.mode === 'persistent'
                  ? s.settings.storagePersistentHint
                  : s.settings.storageBestEffortHint
              }
              action={
                <Badge tone={storageTone} icon={storage?.mode === 'persistent' ? 'shield' : 'alert'}>
                  {storage?.mode === 'persistent' ? 'sicher' : 'prüfen'}
                </Badge>
              }
            />
            {storage?.usageBytes !== null && storage?.quotaBytes ? (
              <CardBody>
                <p className={form.hint}>
                  {s.settings.storageUsage(
                    formatBytes(storage.usageBytes ?? 0),
                    formatBytes(storage.quotaBytes),
                  )}
                </p>
              </CardBody>
            ) : null}
          </Card>

          <SectionTitle>{s.settings.backup}</SectionTitle>
          <Card>
            <CardBody>
              <Stack>
                <Button variant="secondary" icon="download" block busy={busy} onClick={() => void doExport()}>
                  {s.settings.exportBackup}
                </Button>
                <p className={form.hint}>{s.settings.exportBackupHint}</p>
                <Button
                  variant="secondary"
                  icon="upload"
                  block
                  busy={busy}
                  onClick={() => fileInput.current?.click()}
                >
                  {s.settings.importBackup}
                </Button>
                <p className={form.hint}>{s.settings.importBackupHint}</p>
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/json,.json"
                  className="visually-hidden"
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) void doImport(file);
                  }}
                />
                <Button
                  variant="dangerGhost"
                  icon="trash"
                  block
                  onClick={() => setConfirmErase(true)}
                >
                  {s.settings.erase}
                </Button>
              </Stack>
            </CardBody>
          </Card>

          <SectionTitle>{s.settings.about}</SectionTitle>
          <Card padded>
            <div className={css.about}>
              <Logo size={40} withWordmark />
              <p className={form.hint}>{s.settings.aboutText}</p>
              <p className={form.hint}>
                <Icon name="info" size={13} /> {s.settings.installHint}
              </p>
            </div>
          </Card>
        </Stack>
      </Screen>

      <ConfirmDialog
        open={confirmErase}
        title={s.settings.eraseTitle}
        message={s.settings.eraseText}
        confirmLabel={s.settings.erase}
        destructive
        onCancel={() => setConfirmErase(false)}
        onConfirm={async () => {
          setConfirmErase(false);
          await eraseEverything();
          toast.success('Alle Daten geloescht');
        }}
      />
    </Shell>
  );
}
