# Rozwój

Dla osób, które rozwijają simple-hl7: budowanie, testy i wydania. Moduły, przepływ zdarzeń, REST API
i WebSocket opisuje [ARCHITEKTURA.md](ARCHITEKTURA.md).

## Budowanie

Potrzebny Node 22 i npm. Skrypt instaluje zależności, uruchamia testy i buduje plik dla systemu,
na którym działa:

```
build.cmd          Windows: dist\simple-hl7-<wersja>-windows-amd64.exe
sh build.sh        Linux:   dist/simple-hl7-<wersja>-linux-amd64
```

Wynik trafia do `dist/` razem z plikiem sum kontrolnych `simple-hl7-<wersja>-checksums.txt`. Plik ma około 85 MB, bo zawiera środowisko Node.
Pod spodem działa Node SEA (single executable application): esbuild składa kod w jeden plik,
interfejs, scenariusze i przykłady są dołączane jako zasoby, a całość trafia do kopii programu `node`.
Numer wersji pochodzi z `VERSION.md`. Plik dla Linuksa buduje się na Linuksie; wydania budują się same, patrz [Wydania](#wydania).

Bez budowania, prosto ze źródeł (Node 22):

```
npm ci
npm start
```

Tak uruchomiony program trzyma konfigurację i logi w katalogu projektu i czyta interfejs z `public/`.

## Rozwój i testy

```
npm test                       # testy jednostkowe, transport MLLP, scenariusze, API i WebSocket
npm run dev                    # start z automatycznym restartem po zmianie pliku
node scripts/screenshots.mjs   # odświeża zrzuty w docs/img (potrzebny Edge albo Chrome)
node scripts/manual-shots.mjs  # zrzuty elementów do instrukcji w docs/instrukcja/img
```

Testy używają losowych wolnych portów, więc nie kolidują z działającą kopią programu.
Budowa modułów, przepływ zdarzeń, REST API i WebSocket: [ARCHITEKTURA.md](ARCHITEKTURA.md).

Gałęzie: `develop` (praca) i `master` (wydania). CI (`.github/workflows/ci.yml`) nie startuje na
`develop`; uruchamia się na pull request `develop` → `master` albo ręcznie (`workflow_dispatch`).
Sprawdza składnię i testy, buduje plik wykonywalny na Windows i na Linuksie i uruchamia każdy z nich
testem dymnym (`scripts/smoke-exe.mjs`: start w pustym katalogu, interfejs, API, scenariusze, jedna
wiadomość MLLP z ACK).

## Wydania

- `VERSION.md` trzyma numer wersji (jedna linia, `major.minor.patch`). Program wkompilowuje go przy
  budowaniu, a ze źródeł czyta go przy starcie, więc plik wykonywalny, `--version` i tag zawsze się
  zgadzają. `package.json` ma stałą wersję `0.0.0` i nie jest publikowany.
- `CHANGELOG.md` opisuje zmiany w każdej wersji (format Keep a Changelog). Wydanie wymaga sekcji
  `## [x.y.z]` dla numeru z `VERSION.md`; jej treść staje się opisem release.
- Workflow `Release` (`.github/workflows/release.yml`) startuje po push do `master`, który zmienia
  `VERSION.md`, czyli po merge PR z `develop` z podbitym numerem. Publikuje tylko wtedy, gdy
  `VERSION.md` jest wyższy od najnowszego tagu `v*`. Wtedy: testy, build na Windows i Linuksie
  z testem dymnym każdego pliku, plik sum kontrolnych, tag `v<wersja>` i release w tym
  repozytorium, a potem job `site` kopiuje te same trzy pliki do Mysttic/Mysttic pod tagiem
  `simple-hl7-v<wersja>` i usuwa tam starsze wydania projektu. Strona
  https://mysttic.github.io/Mysttic/simple-hl7/ pokazuje je od razu, bez commita na hubie.
- Bez podniesienia `VERSION.md` merge nie publikuje nic. Obniżenie numeru albo brak sekcji
  w `CHANGELOG.md` zatrzymuje workflow z błędem. Wydanie, które nie wystartowało albo padło przed
  utworzeniem tagu, uruchamia się ręcznie: „Run workflow” na `master`. Wydanie, które padło po
  utworzeniu tagu (np. w jobie `site`), ponawia się przez „Re-run failed jobs”.

Procedura wydania:

1. Na `develop`: podnieść `VERSION.md`, dopisać sekcję w `CHANGELOG.md` (to, co było w
   `[Unreleased]`, pod nowym numerem i datą).
2. PR `develop` → `master`, poczekać na zielone CI i podgląd „Release preview”.
3. Merge. Release i kopia plików wydania na hub dzieją się same.

Wymagany sekret: `HUB_TOKEN` w ustawieniach repozytorium (Settings, Secrets and variables, Actions):
fine-grained token dla właściciela `Mysttic`, dostęp tylko do `Mysttic/Mysttic`, uprawnienie
Contents: Read and write. Bez niego release w tym repozytorium powstanie, a job `site` zakończy się
czytelnym błędem. Token ma datę ważności; po jej upływie job `site` zatrzyma się tym samym błędem.

Strona projektu na hubie ma własną kopię w Mysttic/Mysttic. Zmiana jej treści albo zrzutów to commit
w tamtym repozytorium.
