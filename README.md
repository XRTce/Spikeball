<div align="center">
  <img src="public/logo.svg" width="88" height="88" alt="">
  <h1>Rally</h1>
  <p><strong>Roundnet-Turniere organisieren &mdash; offline, ohne Account.</strong></p>
  <p>
    <img src="https://img.shields.io/badge/PWA-installierbar-ff6b2c" alt="PWA">
    <img src="https://img.shields.io/badge/Speicher-lokal-14b8a6" alt="Lokaler Speicher">
    <img src="https://img.shields.io/badge/Bundle-~140%20kB%20gzip-0b1220" alt="Bundle-Größe">
    <img src="https://img.shields.io/badge/Lizenz-MIT-blue" alt="MIT">
  </p>
  <p><a href="https://xrtce.github.io/Spikeball/"><strong>&rarr; App öffnen</strong></a></p>
</div>

---

Rally ist eine Progressive Web App für Roundnet-Runden im Freundes- und
Familienkreis. Eine Person &mdash; der Turnierleiter &mdash; installiert sie aufs Handy,
legt die Mitspieler an, tippt Ergebnisse ein und lässt den Rest die App machen:
Elo-Wertung, Spielplan, Tabelle und am Ende ein Bild fürs Gruppenchat.

Kein Account, keine Registrierung. Ein Turnier ist standardmäßig **lokal**:
alle Daten liegen im IndexedDB-Speicher des Geräts und verlassen es nur, wenn
du ein Backup oder ein Ergebnisbild teilst. Ein Turnier kann daneben auch
**öffentlich** sein &mdash; dann liegt eine Kopie auf einem winzigen eigenen
Sync-Server, jeder mit dem QR-Code-Link bekommt eine live mitlaufende Kopie
aufs Handy und kann Ergebnisse eintragen. Mehr dazu in
[`docs/SYNC.md`](docs/SYNC.md).

## Was die App kann

| | |
|---|---|
| **Liga-Modus** | Dauerhaftes freies Spiel: Die App schlägt die nächste faire Partie vor, oder du stellst die Teams selbst zusammen. Wer am wenigsten gespielt hat kommt zuerst, Partnerschaften rotieren. |
| **Turniermodus** | Freies Spiel mit Zeitlimit. Danach draften die besten Spieler feste Teams &mdash; die bessere Hälfte wählt sich reihum einen Partner aus der schwächeren &mdash; und spielen ein K.o.-Bracket. |
| **Elo pro Turnier** | Jeder Spieler hat eine Start-Elo, die sich mit jedem Ergebnis fortschreibt. Wertungen gehören zum Turnier, nicht global. |
| **Spieler übernehmen** | Ein neues Turnier kann die Spielerliste eines alten klonen &mdash; mit der aktuellen oder der ursprünglichen Wertung als neue Start-Elo. |
| **Ergebnisbild** | Podium, Elo-Verlauf und Siegbilanz als PNG zum Teilen. |
| **Öffentliche Turniere** | Beim Anlegen *Öffentlich* wählen, QR-Code zeigen, fertig: Wer ihn scannt, hat das Turnier live auf dem eigenen Handy und kann Ergebnisse eintragen, Spiele ansetzen und Spieler hinzufügen. Kein Account, der Link ist der Schlüssel. |
| **Admin-Passwort** | Optional pro öffentlichem Turnier. Es sperrt alles Zerstörerische: Spieler oder gespielte Ergebnisse löschen, Regeln und Start-Elo ändern, Timer und K.o. starten oder verwerfen, das Turnier beenden oder für alle löschen. Ergebnisse eintragen bleibt für alle offen. |
| **Offline** | Nach dem ersten Laden läuft alles ohne Netz. Auf der Wiese hinterm Haus gibt es meist keins. Änderungen an öffentlichen Turnieren werden gesammelt und hochgeladen, sobald wieder Netz da ist. |

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

Jeder Push auf den Standard-Branch baut und veröffentlicht die App unter
[xrtce.github.io/Spikeball](https://xrtce.github.io/Spikeball/)
(`.github/workflows/pages.yml`).

> **Einmalig nötig:** *Settings &rarr; Pages &rarr; Build and deployment &rarr;
> Source: **GitHub Actions***. Das Erstellen einer Pages-Site braucht
> Administrationsrechte, die der Workflow-Token nicht hat &mdash; danach läuft
> alles automatisch.

Weil ein Projekt-Seite unter `/<repo>/` liegt und nicht im Wurzelverzeichnis,
setzt der Workflow `BASE_PATH`. Daraus leiten sich Asset-Pfade, Router-Basis,
Manifest und Service-Worker-Scope ab &mdash; dieselben Quellen bauen also für
beide Ziele:

```bash
npm run build                        # fuer die Wurzel (Docker)
BASE_PATH=/Spikeball/ npm run build  # fuer eine GitHub-Projektseite
```

GitHub Pages kennt keine SPA-Umschreibung, deshalb legt der Build zusätzlich
eine `404.html` als Kopie der Startseite ab. Ein direkt geöffneter Link wie
`/Spikeball/new` kommt damit als HTTP 404 an, zeigt aber die richtige Ansicht;
sobald der Service Worker aktiv ist, übernimmt der seinen Navigations-Fallback.

Pages liefert nur statische Dateien, es gibt dort also keinen Sync-Server:
öffentliche Turniere lassen sich auf dieser Instanz nicht anlegen, lokale
funktionieren unverändert. Ein Build mit `VITE_SYNC_URL=https://dein-server`
verbindet eine statische Instanz mit einem Sync-Server anderswo.

#### Mit Docker

```bash
docker compose up -d --build     # http://localhost:8080
```

Ein anderer Port geht über `RALLY_PORT` (siehe `.env.example`):

```bash
RALLY_PORT=3000 docker compose up -d --build
```

Das Image ist ein einzelner Node-Prozess (`node:22-alpine`, non-root), der die
gebaute App **und** den kleinen Sync-Server für öffentliche Turniere auf
Port 8080 ausliefert &mdash; kein nginx mehr. Er schreibt genau eine SQLite-Datei
in `/data`, ein benanntes Docker-Volume (`rally-data`); alles andere im
Container bleibt schreibgeschützt (`read_only: true`, `cap_drop: ALL`). Lokale
Turniere verlassen das Gerät weiterhin nie &mdash; auf dem Server landen nur
Turniere, die du bewusst als öffentlich freigibst, und auch dann nur Name,
Spieler und Ergebnisse, kein Backup, keine Analytics.

SPA-Umschreibung, Cache-Header und die Content-Security-Policy (nur `self`)
sind dieselben wie vorher, jetzt implementiert in `server/static.ts` statt in
einer nginx-Konfiguration.

Relevante Umgebungsvariablen (siehe auch [`docs/SYNC.md`](docs/SYNC.md)):

| Variable | Default | |
|---|---|---|
| `PORT` | `8080` | Port, auf dem der Server hört |
| `RALLY_DATA_DIR` | `/data` (Image), `./.data` (lokal) | Ordner für die SQLite-Datei |
| `RALLY_STATIC_DIR` | `./dist` | Gebaute PWA; fehlt sie, läuft nur die API |
| `RALLY_CORS_ORIGIN` | nicht gesetzt | Erlaubter Cross-Origin-App-Ursprung, `*` für alle |
| `RALLY_RETENTION_DAYS` | `365` | Unveränderte öffentliche Turniere werden nach dieser Zeit gelöscht |
| `RALLY_TRUST_PROXY` | nicht gesetzt (`0`) | Anzahl vertrauenswürdiger Proxy-Hops davor, z. B. `1`; liest dann die rechteste `X-Forwarded-For`-Adresse für das Passwort-Ratelimit. Nur setzen, wenn der Port ausschließlich über diese Proxys erreichbar ist – sonst kann ein Client den Header fälschen und das Ratelimit umgehen. Siehe [`docs/SYNC.md`](docs/SYNC.md) |
| `RALLY_CONNECT_SRC` | nicht gesetzt | Zusätzliche Origin(s) für `connect-src` in der CSP, falls dieser Server eine mit `VITE_SYNC_URL=https://anderer-server` gebaute PWA ausliefert |

> **Installieren aufs Handy:** Seite im Browser öffnen &rarr; Teilen/Menü &rarr;
> *Zum Homescreen hinzufügen*. Erst als installierte App bekommt Rally von den
> meisten Browsern dauerhaften Speicher zugesagt; der Status steht in den
> Einstellungen.

#### Automatisches Deployment auf einen eigenen Server

`.github/workflows/deploy.yml` baut das Docker-Image bei jedem Push, pusht es
nach GHCR (`ghcr.io/xrtce/spikeball`) und aktualisiert per SSH den
`docker compose`-Stack auf einem eigenen Server &mdash; inklusive Sync-Server, im
Gegensatz zu GitHub Pages. GitHub Pages läuft parallel weiter als kostenlose,
rein lokale Instanz.

Voraussetzungen auf dem Server: Docker (mit dem Compose-Plugin), ein
Reverse-Proxy mit TLS vor Port 8080 (nicht Teil dieses Workflows) und einmalig
von Hand angelegt: das Zielverzeichnis mit einer `.env`
(siehe [`.env.example`](.env.example), z. B. `RALLY_CORS_ORIGIN`, falls Pages
und Server parallel laufen).

Einmalig als Repository-Secrets nötig (*Settings &rarr; Secrets and variables
&rarr; Actions*):

| Secret | Bedeutung |
|---|---|
| `DEPLOY_HOST` | Hostname/IP des Servers |
| `DEPLOY_USER` | SSH-Benutzer (muss `docker compose` ausführen dürfen) |
| `DEPLOY_SSH_KEY` | Privater Schlüssel; der öffentliche Teil steht in `~/.ssh/authorized_keys` des Nutzers |
| `DEPLOY_PATH` | Zielverzeichnis auf dem Server für `docker-compose.yml` und `.env` |
| `DEPLOY_PORT` | Optional, SSH-Port, Default `22` |
| `GHCR_DEPLOY_TOKEN` | Classic PAT mit `read:packages`, mit dem der Server das (private) GHCR-Image zieht |

`GITHUB_TOKEN` für den Push nach GHCR braucht kein eigenes Secret &mdash; der
Workflow nutzt den eingebauten Token mit `permissions: packages: write`.

## Bedienung in 60 Sekunden

1. **Turnier anlegen.** Name, Start-Elo, Liga- oder Turniermodus. Optional
   Spieler aus einem früheren Turnier übernehmen.
2. **Spieler eintragen.** Namen antippen, fertig. Wer stärker ist, bekommt eine
   höhere Start-Elo &mdash; das spart die ersten zehn Spiele Einlaufzeit.
3. **Frei spielen.** Die App schlägt eine Partie vor, oder ihr stellt die
   Teams selbst zusammen. *Auf den Platz* &rarr; spielen &rarr; *Ergebnis* &rarr;
   die zwei großen Plus-Knöpfe.
4. **Im Turniermodus:** Zeitlimit starten, wenn alle da sind. Danach draften
   die besten Spieler feste Teams fürs K.o.-Bracket.
5. **Ergebnisbild teilen**, wenn alles durch ist.

Mit mehreren Handys: beim Anlegen *Öffentlich* wählen (und optional ein
Admin-Passwort setzen). Den QR-Code zeigt die App direkt danach, später unter
*Mehr &rarr; QR-Code zeigen*. Die anderen scannen ihn mit der Kamera. Wer das
Passwort kennt, entsperrt sein Handy einmal unter *Mehr*.

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

Für öffentliche Turniere während der Entwicklung beide Prozesse parallel
laufen lassen: `npm run dev:server` stellt die API unter `:8787` bereit, `npm
run dev` leitet `/api/*` dorthin weiter (siehe `vite.config.ts`), sodass die
App im Dev-Server genauso same-origin auf die API zugreift wie im gebauten
Image.

Weiter lesen:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) &mdash; wie die App aufgebaut ist und
  warum Wertungen neu berechnet statt fortgeschrieben werden
- [`docs/ALGORITHMS.md`](docs/ALGORITHMS.md) &mdash; Elo-Formel, Auslosungsverfahren
  und die Quellen dazu
- [`docs/BRAND.md`](docs/BRAND.md) &mdash; Farben, Typografie, Abstände, Bewegung
- [`CONTRIBUTING.md`](CONTRIBUTING.md) &mdash; Konventionen und Checkliste

## Datenschutz

Es gibt keine Analytics, keine Konten und keine Schriftarten von fremden
Servern. Ein lokales Turnier sendet nichts &mdash; es bleibt ausschließlich im
Speicher des Geräts, Verantwortung für Backups liegt entsprechend dort:
**Einstellungen &rarr; Backup exportieren.**

Machst du ein Turnier öffentlich, liegt ab diesem Moment eine Kopie auf dem
Sync-Server: Turniername, Spielernamen und Ergebnisse, aber kein Backup und
keine sonstigen Gerätedaten. Der Link (eine zufällige UUID) ist der einzige
Schlüssel &mdash; wer ihn hat, kann mitspielen und, falls kein Passwort gesetzt
ist, auch löschen. Details und Bedrohungsmodell stehen in
[`docs/SYNC.md`](docs/SYNC.md#the-password). Die Content-Security-Policy des
Images erlaubt weiterhin ausschließlich `self` &mdash; die App spricht mit
keinem Server außer dem eigenen.

## Lizenz

MIT &mdash; siehe [LICENSE](LICENSE).

*Roundnet ist die Sportart; "Spikeball" ist eine Marke von Spikeball Inc. und
steht in keiner Verbindung zu diesem Projekt.*
