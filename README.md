<div align="center">
  <img src="public/logo.svg" width="88" height="88" alt="">
  <h1>Rally</h1>
  <p><strong>Roundnet-Turniere organisieren &mdash; offline, ohne Account.</strong></p>
  <p>
    <img src="https://img.shields.io/badge/PWA-installierbar-ff6b2c" alt="PWA">
    <img src="https://img.shields.io/badge/Speicher-lokal-14b8a6" alt="Lokaler Speicher">
    <img src="https://img.shields.io/badge/Bundle-~140%20kB%20gzip-0b1220" alt="Bundle-Groesse">
    <img src="https://img.shields.io/badge/Lizenz-MIT-blue" alt="MIT">
  </p>
  <p><a href="https://xrtce.github.io/Spikeball/"><strong>&rarr; App oeffnen</strong></a></p>
</div>

---

Rally ist eine Progressive Web App fuer Roundnet-Runden im Freundes- und
Familienkreis. Eine Person &mdash; der Turnierleiter &mdash; installiert sie aufs Handy,
legt die Mitspieler an, tippt Ergebnisse ein und laesst den Rest die App machen:
Elo-Wertung, Spielplan, Tabelle und am Ende ein Bild fuers Gruppenchat.

Kein Account, keine Registrierung. Ein Turnier ist standardmaessig **lokal**:
alle Daten liegen im IndexedDB-Speicher des Geraets und verlassen es nur, wenn
du ein Backup oder ein Ergebnisbild teilst. Ein Turnier kann daneben auch
**oeffentlich** sein &mdash; dann liegt eine Kopie auf einem winzigen eigenen
Sync-Server, jeder mit dem QR-Code-Link bekommt eine live mitlaufende Kopie
aufs Handy und kann Ergebnisse eintragen. Mehr dazu in
[`docs/SYNC.md`](docs/SYNC.md).

## Was die App kann

| | |
|---|---|
| **Liga-Modus** | Dauerhaftes freies Spiel: Die App schlaegt die naechste faire Partie vor, oder du stellst die Teams selbst zusammen. Wer am wenigsten gespielt hat kommt zuerst, Partnerschaften rotieren. |
| **Turniermodus** | Freies Spiel mit Zeitlimit. Danach draften die besten Spieler feste Teams &mdash; die bessere Haelfte waehlt sich reihum einen Partner aus der schwaecheren &mdash; und spielen ein K.o.-Bracket. |
| **Elo pro Turnier** | Jeder Spieler hat eine Start-Elo, die sich mit jedem Ergebnis fortschreibt. Wertungen gehoeren zum Turnier, nicht global. |
| **Spieler uebernehmen** | Ein neues Turnier kann die Spielerliste eines alten klonen &mdash; mit der aktuellen oder der urspruenglichen Wertung als neue Start-Elo. |
| **Ergebnisbild** | Podium, Elo-Verlauf und Siegbilanz als PNG zum Teilen. |
| **Offline** | Nach dem ersten Laden laeuft alles ohne Netz. Auf der Wiese hinterm Haus gibt es meist keins. |

## Loslegen

```bash
git clone https://github.com/XRTce/Spikeball.git
cd Spikeball
npm install
npm run dev            # http://localhost:5173
```

### Selbst hosten

Rally ist ein Ordner mit statischen Dateien &mdash; jeder Webserver tut es. Zwei
Wege sind vorbereitet.

#### GitHub Pages

Jeder Push auf den Standard-Branch baut und veroeffentlicht die App unter
[xrtce.github.io/Spikeball](https://xrtce.github.io/Spikeball/)
(`.github/workflows/pages.yml`).

> **Einmalig noetig:** *Settings &rarr; Pages &rarr; Build and deployment &rarr;
> Source: **GitHub Actions***. Das Erstellen einer Pages-Site braucht
> Administrationsrechte, die der Workflow-Token nicht hat &mdash; danach laeuft
> alles automatisch.

Weil ein Projekt-Seite unter `/<repo>/` liegt und nicht im Wurzelverzeichnis,
setzt der Workflow `BASE_PATH`. Daraus leiten sich Asset-Pfade, Router-Basis,
Manifest und Service-Worker-Scope ab &mdash; dieselben Quellen bauen also fuer
beide Ziele:

```bash
npm run build                        # fuer die Wurzel (Docker)
BASE_PATH=/Spikeball/ npm run build  # fuer eine GitHub-Projektseite
```

GitHub Pages kennt keine SPA-Umschreibung, deshalb legt der Build zusaetzlich
eine `404.html` als Kopie der Startseite ab. Ein direkt geoeffneter Link wie
`/Spikeball/new` kommt damit als HTTP 404 an, zeigt aber die richtige Ansicht;
sobald der Service Worker aktiv ist, uebernimmt der seinen Navigations-Fallback.

Pages liefert nur statische Dateien, es gibt dort also keinen Sync-Server:
oeffentliche Turniere lassen sich auf dieser Instanz nicht anlegen, lokale
funktionieren unveraendert. Ein Build mit `VITE_SYNC_URL=https://dein-server`
verbindet eine statische Instanz mit einem Sync-Server anderswo.

#### Mit Docker

```bash
docker compose up -d --build     # http://localhost:8080
```

Ein anderer Port geht ueber `RALLY_PORT` (siehe `.env.example`):

```bash
RALLY_PORT=3000 docker compose up -d --build
```

Das Image ist ein einzelner Node-Prozess (`node:22-alpine`, non-root), der die
gebaute App **und** den kleinen Sync-Server fuer oeffentliche Turniere auf
Port 8080 ausliefert &mdash; kein nginx mehr. Er schreibt genau eine SQLite-Datei
in `/data`, ein benanntes Docker-Volume (`rally-data`); alles andere im
Container bleibt schreibgeschuetzt (`read_only: true`, `cap_drop: ALL`). Lokale
Turniere verlassen das Geraet weiterhin nie &mdash; auf dem Server landen nur
Turniere, die du bewusst als oeffentlich freigibst, und auch dann nur Name,
Spieler und Ergebnisse, kein Backup, keine Analytics.

SPA-Umschreibung, Cache-Header und die Content-Security-Policy (nur `self`)
sind dieselben wie vorher, jetzt implementiert in `server/static.ts` statt in
einer nginx-Konfiguration.

Relevante Umgebungsvariablen (siehe auch [`docs/SYNC.md`](docs/SYNC.md)):

| Variable | Default | |
|---|---|---|
| `PORT` | `8080` | Port, auf dem der Server hoert |
| `RALLY_DATA_DIR` | `/data` (Image), `./.data` (lokal) | Ordner fuer die SQLite-Datei |
| `RALLY_STATIC_DIR` | `./dist` | Gebaute PWA; fehlt sie, laeuft nur die API |
| `RALLY_CORS_ORIGIN` | nicht gesetzt | Erlaubter Cross-Origin-App-Ursprung, `*` fuer alle |
| `RALLY_RETENTION_DAYS` | `365` | Unveraenderte oeffentliche Turniere werden nach dieser Zeit geloescht |
| `RALLY_TRUST_PROXY` | nicht gesetzt | `1`, wenn ein Reverse Proxy davor steht (liest dann `X-Forwarded-For`) |

> **Installieren aufs Handy:** Seite im Browser oeffnen &rarr; Teilen/Menue &rarr;
> *Zum Homescreen hinzufuegen*. Erst als installierte App bekommt Rally von den
> meisten Browsern dauerhaften Speicher zugesagt; der Status steht in den
> Einstellungen.

## Bedienung in 60 Sekunden

1. **Turnier anlegen.** Name, Start-Elo, Liga- oder Turniermodus. Optional
   Spieler aus einem frueheren Turnier uebernehmen.
2. **Spieler eintragen.** Namen antippen, fertig. Wer staerker ist, bekommt eine
   hoehere Start-Elo &mdash; das spart die ersten zehn Spiele Einlaufzeit.
3. **Frei spielen.** Die App schlaegt eine Partie vor, oder ihr stellt die
   Teams selbst zusammen. *Auf den Platz* &rarr; spielen &rarr; *Ergebnis* &rarr;
   die zwei grossen Plus-Knoepfe.
4. **Im Turniermodus:** Zeitlimit starten, wenn alle da sind. Danach draften
   die besten Spieler feste Teams fuers K.o.-Bracket.
5. **Ergebnisbild teilen**, wenn alles durch ist.

## Projektstruktur

```
src/
├── domain/          Reine Spiellogik, ohne UI und ohne Datenbank
│   ├── elo.ts       Elo-Berechnung und Replay
│   ├── standings.ts Tabelle und Bilanzen
│   ├── schedule.ts  Gruppierung des Spielplans in Runden
│   └── pairing/     Auslosung: Balance, freies Spiel, Kapitaens-Draft, K.o.
├── db/              IndexedDB (Dexie), Repository und Backup
├── state/           Lesemodell und Kontexte (Theme, Spielerfarben)
├── ui/              Design-System: Buttons, Karten, Felder, Charts, Icons
├── components/      Zusammengesetzte Bausteine (Spielkarte, Ergebnis-Sheet)
├── screens/         Die einzelnen Ansichten
├── export/          Canvas-Renderer fuer das Ergebnisbild
├── i18n/            Saemtliche Texte
└── styles/          Design-Tokens und Basis-Stylesheet

server/              Sync-Server: SQLite, HTTP-Endpunkte, statische Auslieferung
docs/                Architektur, Algorithmen, Corporate Identity, Sync-Protokoll
scripts/             Icon-Generator
tests/               Vitest-Suite fuer Domain, Datenbank und Sync-Server
```

## Entwicklung

```bash
npm run dev         # Dev-Server fuer die App (Vite, Port 5173)
npm run dev:server  # Sync-Server im Watch-Modus (Port 8787, Daten in ./.data)
npm run test        # Vitest (Elo, Auslosung, Datenbank, Sync-Server)
npm run build       # Typecheck + Produktions-Build (App und Server)
npm run preview     # Produktions-Build der App lokal ausliefern
npm start           # Gebauten Sync-Server ausliefern (nach npm run build)
npm run icons       # PWA-Icons aus dem Logo neu erzeugen

BASE_PATH=/Spikeball/ npm run build   # Build wie fuer GitHub Pages
```

Fuer oeffentliche Turniere waehrend der Entwicklung beide Prozesse parallel
laufen lassen: `npm run dev:server` stellt die API unter `:8787` bereit, `npm
run dev` leitet `/api/*` dorthin weiter (siehe `vite.config.ts`), sodass die
App im Dev-Server genauso same-origin auf die API zugreift wie im gebauten
Image.

Weiter lesen:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) &mdash; wie die App aufgebaut ist und
  warum Wertungen neu berechnet statt fortgeschrieben werden
- [`docs/ALGORITHMS.md`](docs/ALGORITHMS.md) &mdash; Elo-Formel, Auslosungsverfahren
  und die Quellen dazu
- [`docs/BRAND.md`](docs/BRAND.md) &mdash; Farben, Typografie, Abstaende, Bewegung
- [`CONTRIBUTING.md`](CONTRIBUTING.md) &mdash; Konventionen und Checkliste

## Datenschutz

Es gibt keine Analytics, keine Konten und keine Schriftarten von fremden
Servern. Ein lokales Turnier sendet nichts &mdash; es bleibt ausschliesslich im
Speicher des Geraets, Verantwortung fuer Backups liegt entsprechend dort:
**Einstellungen &rarr; Backup exportieren.**

Machst du ein Turnier oeffentlich, liegt ab diesem Moment eine Kopie auf dem
Sync-Server: Turniername, Spielernamen und Ergebnisse, aber kein Backup und
keine sonstigen Geraetedaten. Der Link (eine zufaellige UUID) ist der einzige
Schluessel &mdash; wer ihn hat, kann mitspielen und, falls kein Passwort gesetzt
ist, auch loeschen. Details und Bedrohungsmodell stehen in
[`docs/SYNC.md`](docs/SYNC.md#the-password). Die Content-Security-Policy des
Images erlaubt weiterhin ausschliesslich `self` &mdash; die App spricht mit
keinem Server ausser dem eigenen.

## Lizenz

MIT &mdash; siehe [LICENSE](LICENSE).

*Roundnet ist die Sportart; "Spikeball" ist eine Marke von Spikeball Inc. und
steht in keiner Verbindung zu diesem Projekt.*
