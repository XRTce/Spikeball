# Contributing

Thanks for wanting to improve Rally. This is a small app for a small purpose,
so the bar is less "is it clever" and more "will it still work at dusk on
someone's phone with cold hands".

## Setup

```bash
npm install
npm run dev
```

Node 20 or newer.

## Before you open a pull request

```bash
npm run test     # Vitest
npm run build    # Typecheck + production build
```

And by hand:

- [ ] Checked at a phone width (375–430&nbsp;px). This is the primary target,
      not an afterthought.
- [ ] Checked in **both** light and dark themes.
- [ ] Nothing scrolls horizontally.
- [ ] Every new tap target is at least 44&nbsp;px.

If you changed the logo, run `npm run icons` and commit the regenerated files —
CI fails when `public/` drifts from the generator.

## Where things go

| Change | Where |
|---|---|
| Rating or pairing rules | `src/domain/` — pure functions, **must** come with tests |
| Reading or writing data | `src/db/repo.ts` — the only place that mutates |
| A new reusable control | `src/ui/` |
| A new screen | `src/screens/` |
| Any user-facing text | `src/i18n/de.ts` — never inline a string in a screen |
| Colours, spacing, motion | `src/styles/tokens.css` — never hard-code a value that exists there |

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for why the layers are split
that way, and [`docs/BRAND.md`](docs/BRAND.md) for the design rules.

## Conventions

- **Code, comments and docs in the repo are English. The UI is German.**
- Comments explain *why*, not *what*. If a line needs a comment to say what it
  does, rename something instead.
- No new runtime dependencies without a good reason. The whole bundle is around
  140&nbsp;kB gzipped and the app is meant to load on a bad connection in a
  field; a chart library or an icon font would change that materially.
- Derived state is not stored. If you find yourself writing an incremental
  update to a rating or a bracket, add it to the replay in `recalculate()`
  instead — see the architecture doc.

## Tests

`src/domain/` is where correctness lives, and it is testable without a browser.
Anything touching Elo or pairing needs a test that would fail without the
change. Prefer testing a *property* over a fixed expectation where you can — for
example "in an 8-player round robin every pair partners exactly once" rather
than a hard-coded schedule.

The database layer is tested against `fake-indexeddb` in `tests/repo.test.ts`.

## Reporting bugs

Please say which device and browser, whether the app was installed to the home
screen, and which format was running. If ratings or a schedule look wrong, a
backup export (Settings → Backup) makes it reproducible — it contains player
names, so strip them if you would rather not share them.
