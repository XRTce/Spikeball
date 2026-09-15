# Corporate identity

Everything visual comes from `src/styles/tokens.css`. Components must not
hard-code a value that exists there — that is what keeps the app looking like
one app.

## The mark

A roundnet net seen from above, with the ball coming off it. Two shapes and two
colours, so it still reads at 16&nbsp;px.

The geometry is defined once, on a 32&times;32 grid, and reproduced in three
places that must stay in sync:

| Where | File |
|---|---|
| In the app | `src/components/Logo.tsx` |
| On the share image | `drawLogo()` in `src/export/shareCard.ts` |
| Favicon and PWA icons | `scripts/generate-icons.mjs` |

Run `npm run icons` after changing it and commit the regenerated files. CI fails
if `public/` drifts from the generator.

## Colour

The brand ramps are identical in both themes; only surfaces, text and tints are
redefined for dark mode. That way the CI reads the same either way.

| Token | Value | Used for |
|---|---|---|
| `--brand-500` | `#ff6b2c` | Primary actions, active navigation, the net |
| `--accent-500` | `#14b8a6` | Secondary accents, the ball, "even match" |
| `--ink` / `--bg` | `#0b1220` / `#f4f6fa` | Ground |
| `--win-500` | `#16a34a` | Wins |
| `--loss-500` | `#dc2626` | Losses |
| `--gold` `--silver` `--bronze` | `#f5b301` `#a8b3c4` `#cd7f32` | Podium |

**Series colours** (`--series-1` … `--series-12`) identify players in charts and
avatars. They are assigned by a player's **position in the roster**, not by
hashing their id: hashing into twelve buckets collides more often than not with
eight players, and two identically coloured lines make the Elo chart useless.
See `src/state/playerColors.tsx`.

The literal hex values live in `src/ui/palette.ts` so the canvas export — where
CSS variables do not exist — draws exactly the same colours as the UI.

## Type

System stack, no web fonts: instant paint, native feel, no layout shift.

Scale runs `--text-2xs` (11&nbsp;px) to `--text-3xl` (36&nbsp;px). Body text is
15&nbsp;px; **form controls are 16&nbsp;px**, which is what stops iOS Safari
zooming the viewport on focus. Anything numeric carries
`font-variant-numeric: tabular-nums` so scores and ratings do not jitter as they
change.

## Space and shape

A 4&nbsp;px grid (`--space-1` … `--space-10`). Radii step from `--radius-xs`
(6&nbsp;px) to `--radius-pill`. Every interactive element is at least
`--tap-target` (44&nbsp;px) on its smallest side.

The content column is capped at `--app-max-width` (30&nbsp;rem) and centred, so
the app stays phone-shaped on a desktop rather than stretching.

## Motion

| Token | Duration | For |
|---|---|---|
| `--motion-instant` | 90&nbsp;ms | Press feedback (`scale(0.97)`) |
| `--motion-fast` | 140&nbsp;ms | Hover, colour changes |
| `--motion-base` | 220&nbsp;ms | Sheets, sliding indicators, chart transitions |
| `--motion-slow` | 340&nbsp;ms | Progress and ratio bars |

Easing is `--ease-out` for entrances, `--ease-spring` for anything that should
feel physical (switch knobs, the radio dot). All four durations collapse to
1&nbsp;ms under `prefers-reduced-motion`.

## Layout rules that are not negotiable

- **The page never scrolls horizontally.** Wide content (tables, tab strips)
  scrolls inside its own `overflow-x: auto` container. `html, body` carry
  `overflow-x: clip` as a backstop, and grid tracks use `minmax(0, 1fr)` rather
  than `1fr` — an `auto` minimum is min-content, which lets a `nowrap` button
  label stretch the column past the viewport and make mobile browsers
  shrink-to-fit the whole page.
- **Flex scroll areas need `min-height: 0`.** A flex item defaults to
  `min-height: auto`, which lets content push a sheet's action footer off the
  bottom instead of scrolling.
- **Both themes, always.** Colours are defined on `:root` and only *redefined*
  under `[data-theme='dark']`; nothing gets its only definition inside the dark
  block.

## Components

Reuse from `src/ui/` rather than writing a new one:

`Button` · `Card` / `CardButton` / `CardHeader` / `CardBody` · `SectionTitle` ·
`TextField` / `SelectField` / `NumberStepper` / `Switch` · `Sheet` /
`ConfirmDialog` · `Segmented` / `Tabs` · `Badge` / `Avatar` / `AvatarStack` /
`EloDelta` / `Stat` / `Progress` / `WinLossBar` · `EmptyState` / `Skeleton` ·
`AppBar` / `Screen` / `TabBar` / `FloatingAction` · `Icon` · `useToast`

`Icon` holds the whole icon set as inline SVG on a 24&nbsp;px grid with a
uniform 1.75 stroke and round caps. Add new icons there rather than pasting SVG
into a screen, or the optical weight drifts.
