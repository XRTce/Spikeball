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

Kein Account, kein Server, keine Registrierung. Alle Daten liegen im
IndexedDB-Speicher des Geraets und verlassen es nur, wenn du ein Backup oder ein
Ergebnisbild teilst.

## Was die App kann

| | |
|---|---|
| **Freies Spiel** | Die App schlaegt die naechste faire Partie vor: Wer am wenigsten gespielt hat kommt zuerst, die Teams werden nach Elo ausbalanciert und Partnerschaften rotieren. Ergebnis eintippen, fertig. |
| **Turniermodus** | Wenn es ernst wird: Spielplan auf Knopfdruck fuer *Jeder gegen jeden*, *Schweizer System*, *K.o.* oder *Doppel-K.o.* &mdash; wahlweise nur mit den n besten Spielern. |
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

#### Mit Docker

```bash
docker compose up -d --build     # http://localhost:8080
```

Ein anderer Port geht ueber `RALLY_PORT` (siehe `.env.example`):

```bash
RALLY_PORT=3000 docker compose up -d --build
```

Das Image ist ein nginx mit den statischen Dateien &mdash; keine Datenbank, kein
Volume, nichts zu sichern. Es laeuft mit `read_only: true` und ohne zusaetzliche
Capabilities. Anders als bei Pages gibt es hier eine echte SPA-Umschreibung,
Cache-Header und eine Content-Security-Policy, die nur `self` erlaubt.

> **Installieren aufs Handy:** Seite im Browser oeffnen &rarr; Teilen/Menue &rarr;
> *Zum Homescreen hinzufuegen*. Erst als installierte App bekommt Rally von den
> meisten Browsern dauerhaften Speicher zugesagt; der Status steht in den
> Einstellungen.

## Bedienung in 60 Sekunden

1. **Turnier anlegen.** Name, 2v2 oder 1v1, Start-Elo. Optional Spieler aus einem
   frueheren Turnier uebernehmen.
2. **Spieler eintragen.** Namen antippen, fertig. Wer staerker ist, bekommt eine
   hoehere Start-Elo &mdash; das spart die ersten zehn Spiele Einlaufzeit.
3. **Frei spielen.** Die App schlaegt eine Partie vor. *Auf den Platz* &rarr;
   spielen &rarr; *Ergebnis* &rarr; die zwei grossen Plus-Knoepfe.
4. **Turniermodus starten**, wenn ihr genug aufgewaermt seid. Format waehlen,
   Teilnehmerzahl festlegen, Spielplan erstellen.
5. **Ergebnisbild teilen**, wenn alles durch ist.

## Projektstruktur

```
src/
├── domain/          Reine Spiellogik, ohne UI und ohne Datenbank
│   ├── elo.ts       Elo-Berechnung und Replay
│   ├── standings.ts Tabelle und Bilanzen
│   ├── schedule.ts  Gruppierung des Spielplans in Runden
│   └── pairing/     Auslosung: Balance, freies Spiel, Jeder-gegen-jeden,
│                    Schweizer System, K.o. und Doppel-K.o.
├── db/              IndexedDB (Dexie), Repository und Backup
├── state/           Lesemodell und Kontexte (Theme, Spielerfarben)
├── ui/              Design-System: Buttons, Karten, Felder, Charts, Icons
├── components/      Zusammengesetzte Bausteine (Spielkarte, Ergebnis-Sheet)
├── screens/         Die einzelnen Ansichten
├── export/          Canvas-Renderer fuer das Ergebnisbild
├── i18n/            Saemtliche Texte
└── styles/          Design-Tokens und Basis-Stylesheet

docker/              nginx-Konfiguration fuer das Image
docs/                Architektur, Algorithmen, Corporate Identity
scripts/             Icon-Generator
tests/               Vitest-Suite fuer Domain und Datenbank
```

## Entwicklung

```bash
npm run dev        # Dev-Server
npm run test       # Vitest (Elo, Auslosung, Datenbank)
npm run build      # Typecheck + Produktions-Build
npm run preview    # Produktions-Build lokal ausliefern
npm run icons      # PWA-Icons aus dem Logo neu erzeugen

BASE_PATH=/Spikeball/ npm run build   # Build wie fuer GitHub Pages
```

Weiter lesen:

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) &mdash; wie die App aufgebaut ist und
  warum Wertungen neu berechnet statt fortgeschrieben werden
- [`docs/ALGORITHMS.md`](docs/ALGORITHMS.md) &mdash; Elo-Formel, Auslosungsverfahren
  und die Quellen dazu
- [`docs/BRAND.md`](docs/BRAND.md) &mdash; Farben, Typografie, Abstaende, Bewegung
- [`CONTRIBUTING.md`](CONTRIBUTING.md) &mdash; Konventionen und Checkliste

## Datenschutz

Rally sendet nichts. Es gibt keine Analytics, keine Schriftarten von fremden
Servern, keine API. Die Content-Security-Policy des Images erlaubt ausschliesslich
`self`. Was du eintippst, bleibt auf dem Geraet &mdash; entsprechend liegt die
Verantwortung fuer Backups auch dort: **Einstellungen &rarr; Backup exportieren.**

## Lizenz

MIT &mdash; siehe [LICENSE](LICENSE).

*Roundnet ist die Sportart; "Spikeball" ist eine Marke von Spikeball Inc. und
steht in keiner Verbindung zu diesem Projekt.*
