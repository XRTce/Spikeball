import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AppBar,
  Button,
  EmptyState,
  Screen,
  Stack,
  useToast,
} from '../ui';
import { usePlayerColors } from '../state/playerColors';
import { strings, formatDate } from '../i18n';
import { useTournamentView } from './TournamentLayout';
import { canvasToBlob, renderShareCard, type ShareCardData } from '../export/shareCard';
import { canShareFiles, downloadBlob } from '../lib/download';
import { eloSeries } from '../domain/elo';
import { bracketResult } from '../domain/pairing/elimination';
import { isEliminationFormat } from '../domain/types';
import type { TournamentView } from '../state/useTournament';
import css from './ExportScreen.module.css';

const s = strings;

const MAX_SERIES = 6;
const MAX_ROWS = 10;

function buildCardData(view: TournamentView, hexOf: (id: string) => string): ShareCardData {
  const tournament = view.tournament!;
  const played = view.standings.filter((row) => row.played > 0);

  const nameOf = (ids: string[]) =>
    ids.map((id) => view.playerById.get(id)?.name ?? '?').join(' & ');

  const teamEntry = (ids: string[] | null, rank: 1 | 2 | 3) => {
    if (!ids || ids.length === 0) return null;
    const ratings = ids.map((id) => view.ratings[id] ?? 0);
    const bases = ids.map((id) => view.playerById.get(id)?.baseElo ?? 0);
    const mean = (values: number[]) =>
      Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
    return {
      rank,
      name: nameOf(ids),
      elo: mean(ratings),
      delta: mean(ratings) - mean(bases),
      color: hexOf(ids[0]!),
    };
  };

  let podium: ShareCardData['podium'] = [];

  if (isEliminationFormat(tournament.format) && tournament.format) {
    // A knockout is decided on the pitch, so the bracket - not the table -
    // says who finished where.
    const result = bracketResult(view.tournamentMatches, tournament.format);
    podium = [
      teamEntry(result.championIds, 1),
      teamEntry(result.runnerUpIds, 2),
      teamEntry(result.thirdIds, 3),
    ].filter((entry): entry is NonNullable<typeof entry> => entry !== null);
  }

  if (podium.length === 0) {
    podium = played.slice(0, 3).map((row, index) => ({
      rank: (index + 1) as 1 | 2 | 3,
      name: row.name,
      elo: row.elo,
      delta: row.eloChange,
      color: hexOf(row.playerId),
    }));
  }

  const chartRows = played.slice(0, MAX_SERIES);
  const curves = eloSeries(
    view.replay,
    chartRows.map((row) => row.playerId),
  );

  return {
    title: tournament.name,
    subtitle: [
      tournament.format ? s.formats[tournament.format] : s.play.casualTitle,
      `${played.length} ${s.common.players}`,
      `${view.matches.filter((match) => match.status === 'done' && !match.bye).length} ${s.common.matches}`,
    ].join(' · '),
    podium,
    series: chartRows.map((row) => ({
      name: row.name,
      color: hexOf(row.playerId),
      points: curves[row.playerId] ?? [],
    })),
    winLoss: played.slice(0, MAX_ROWS).map((row) => ({
      name: row.name,
      wins: row.wins,
      losses: row.losses,
      color: hexOf(row.playerId),
    })),
    footnote: formatDate(tournament.finishedAt ?? tournament.updatedAt),
  };
}

export function ExportScreen() {
  const view = useTournamentView();
  const colors = usePlayerColors();
  const toast = useToast();
  const tournament = view.tournament!;
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const blobRef = useRef<Blob | null>(null);

  const hasResults = view.standings.some((row) => row.played > 0);
  const cardData = useMemo(
    () => (hasResults ? buildCardData(view, colors.hexOf) : null),
    [colors, hasResults, view],
  );

  useEffect(() => {
    if (!cardData) return;
    let cancelled = false;
    void (async () => {
      try {
        const canvas = renderShareCard(cardData);
        const blob = await canvasToBlob(canvas);
        if (cancelled) return;
        blobRef.current = blob;
        setPreview((previous) => {
          if (previous) URL.revokeObjectURL(previous);
          return URL.createObjectURL(blob);
        });
      } catch (error) {
        console.error(error);
        if (!cancelled) toast.error(s.errors.generic);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `toast` is stable; re-rendering on it would loop the image generation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardData]);

  useEffect(
    () => () => {
      setPreview((previous) => {
        if (previous) URL.revokeObjectURL(previous);
        return null;
      });
    },
    [],
  );

  const fileName = `${tournament.name.replace(/[^\p{L}\p{N}]+/gu, '-').toLowerCase()}-rally.png`;

  const share = async () => {
    const blob = blobRef.current;
    if (!blob) return;
    setBusy(true);
    const file = new File([blob], fileName, { type: 'image/png' });
    try {
      if (canShareFiles([file])) {
        await navigator.share({ files: [file], title: tournament.name });
      } else {
        downloadBlob(blob, fileName);
      }
    } catch (error) {
      // An abort means the user closed the share sheet - not worth a message.
      if (!(error instanceof DOMException && error.name === 'AbortError')) {
        downloadBlob(blob, fileName);
        toast.show(s.exportImage.shareFailed);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <AppBar
        title={s.exportImage.title}
        subtitle={tournament.name}
        back={`/t/${tournament.id}/more`}
      />
      <Screen>
        {!hasResults ? (
          <EmptyState icon="image" title={s.exportImage.noResults} />
        ) : (
          <Stack>
            <div className={css.previewFrame}>
              {preview ? (
                <img src={preview} alt={s.exportImage.title} className={css.preview} />
              ) : (
                <div className={css.previewLoading}>{s.exportImage.building}…</div>
              )}
            </div>

            <Button
              variant="primary"
              size="lg"
              icon="share"
              block
              busy={busy}
              disabled={!preview}
              onClick={() => void share()}
            >
              {s.exportImage.share}
            </Button>
            <Button
              variant="secondary"
              icon="download"
              block
              disabled={!preview}
              onClick={() => {
                if (blobRef.current) downloadBlob(blobRef.current, fileName);
              }}
            >
              {s.exportImage.download}
            </Button>
          </Stack>
        )}
      </Screen>
    </>
  );
}
