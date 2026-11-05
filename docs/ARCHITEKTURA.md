# Architektura

Dokument dla osoby, która rozwija tester. Użytkownikowi końcowemu wystarczą README i [przewodnik](PRZEWODNIK.md).

## Zasady

- Jeden proces Node 22, moduły ESM, bez kroku budowania przy pracy ze źródeł. Interfejs to czysty
  JavaScript w `public/`, bez frameworka.
- Zależności produkcyjne: `express`, `ws`, `iconv-lite`, `js-yaml`. Deweloperskie: `esbuild` i `postject`,
  tylko do budowania pliku wykonywalnego.
- Moduły `src/hl7/parser.js`, `tokenize.js`, `dictionary.js`, `templates.js` i `ack.js` działają też
  w przeglądarce (bez `node:`, `Buffer`, `process`). Serwer udostępnia je pod `/lib/`, a interfejs używa
  tego samego parsera i tokenizera co serwer.
- Czasy: znacznik ściany `ts` (ISO z milisekundami) do porównań z logami bramki, a wszystkie różnice
  (`*Ms`) z zegara monotonicznego `process.hrtime`.
- Żaden błąd sieci ani źle zbudowana wiadomość nie zatrzymuje procesu. Każdy problem staje się
  zdarzeniem z `level: 'warn'` lub `'error'`.

## Moduły

```
src/index.js            flagi, wczytanie konfiguracji, start App i serwera WWW, sygnały
src/runtime.js          tryb exe albo źródła: katalog danych, wersja, zasoby osadzone, wypakowanie przykładów
src/app.js              App: magazyn zdarzeń, listenery, wysyłka, scenariusze, parse, przykłady
src/config.js           config/app.json: wartości domyślne, scalanie, walidacja, zapis atomowy
src/core/events.js      EventStore: bufor cykliczny, filtry, eksport CSV i NDJSON, dopisywanie do pliku
src/core/hex.js         konwersje hex, hexdump
src/mllp/framing.js     frame(), FrameDecoder (strumieniowy), analyzeFraming()
src/mllp/listener.js    MllpListener: serwer TCP, dekoder na połączenie, ACK, statystyki
src/mllp/sender.js      sendMessage(), sendMany(), MllpSenderConnection, walidacja ACK
src/hl7/                parser, tokenizer, słownik segmentów i pól, szablony, budowa ACK, kodowania
src/scenarios/runner.js scenariusze YAML: walidacja, uruchamianie, asercje
src/web/server.js       REST, WebSocket, pliki interfejsu (z dysku albo z zasobów exe)
public/                 interfejs: index.html, css/app.css, js/*.js
public/js/view.js       widoki interfejsu: elementy, które da się ukryć, presety Prosty, Standardowy, Pełny
scripts/build-exe.mjs   budowa pliku wykonywalnego (Node SEA)
scripts/screenshots.mjs zrzuty do README (docs/img) przez headless Edge lub Chrome
scripts/manual-shots.mjs zrzut każdego elementu interfejsu do instrukcji (docs/instrukcja/img) i kontrola podstron
scripts/lib/devtools.mjs wspólne funkcje zrzutów: start programu, sterowanie przeglądarką, wycinanie elementów
scripts/smoke-exe.mjs   test dymny gotowego pliku: start w pustym katalogu, UI, API, scenariusze, wiadomość MLLP z ACK
scripts/release-version.sh   porównanie VERSION.md z ostatnim tagiem v*: czy wydawać (CI i Release)
scripts/changelog-section.sh sekcja CHANGELOG.md jednej wersji, opis release
.github/workflows/      ci.yml (PR develop do master) i release.yml (wydanie i kopia na hub)
```

## Przepływ

**Odbiór (serwer).** Gniazdo TCP, potem `FrameDecoder` składa ramkę z fragmentów (ramka może przyjść
bajt po bajcie albo kilka ramek w jednym fragmencie). Pełna ramka idzie do `analyzeFraming`, dekodowania
kodowaniem listenera, kontroli kodowania względem MSH-18 i parsera. Powstaje `msg.in`. Potem ACK:
budowa przez `buildAck` (albo szablon), opcjonalne opóźnienie, zapis do gniazda i `ack.out` z czasem
przetwarzania liczonym w callbacku zapisu. Ramka bez sufiksu po `frameTimeoutMs` ciszy, po `idleTimeoutMs`
albo przy zamknięciu staje się `frame.incomplete`.

**Wysyłka (klient).** Szablon, podmiana MSH-10, normalizacja separatorów do CR, kodowanie, ramka.
Połączenie (`sender.connect`), zapis (`msg.out` w callbacku zapisu), dekoder ramki ACK, walidacja MSA-1,
MSA-2 i ramki, `ack.in`. Brak ACK w czasie daje `ack.timeout` z bajtami, które zdążyły przyjść.
Zamknięcie połączenia w trakcie niepełnego ACK daje `frame.incomplete`.

**Interfejs.** Po połączeniu WebSocket dostaje migawkę (stan i ostatnie 500 zdarzeń), potem każde
zdarzenie osobno. Gdy klient nie nadąża (bufor WebSocket ponad 16 MB, np. przy wiadomościach po kilka MB),
serwer przestaje wysyłać mu zdarzenia, a po opróżnieniu bufora wysyła `gap` i klient dociąga brakujące
zdarzenia przez REST.

**Widok interfejsu.** `public/js/view.js` wymienia elementy ekranu, które widok może ukryć (klucz, nazwa,
grupa), i trzy presety. Element do ukrycia ma `data-view="<klucz>"`; przy kilku kluczach oddzielonych
spacją znika, gdy ukryty jest którykolwiek. `app.js` zamienia ukryte klucze na jedną regułę CSS
w `<style id="view-style">`. Kolumny osi czasu, zdarzenia połączeń i zakładkę Hex rysuje kod, więc
pytają `ctx.view.isHidden(klucz)`. Wybór leży w `localStorage` (`hl7t.ui.settings.v1`, pole `view`).
`test/view.test.js` pilnuje, żeby każdy klucz użyty w interfejsie istniał w `view.js` i żeby każdy klucz
z `view.js` coś ukrywał.

## Zdarzenia

Każde zdarzenie ma ten sam kształt:

```js
{
  id: 123,                         // rosnący numer
  ts: '2026-10-08T09:51:28.526Z',  // czas ściany, UTC, milisekundy
  tsMs: 1791445888526,
  mono: 51234.567,                 // ms od startu procesu, zegar monotoniczny
  source: 'listener',              // listener | sender | scenario | system
  endpointId: 'default',           // id listenera, 'sender', runId scenariusza albo 'system'
  connId: 'default#4',             // osobny dla każdego połączenia TCP, null poza połączeniem
  type: 'msg.in',
  direction: 'in',                 // in | out | null
  level: 'info',                   // info | warn | error
  summary: 'Received ADT^A01 ...', // po angielsku, interfejs tłumaczy po typie
  latencyMs: 0.42,                 // główny czas zdarzenia albo null
  data: { }                        // zależne od typu
}
```

| Typ | Źródło | `latencyMs` | Najważniejsze `data` |
|---|---|---|---|
| `system.started` | system | | `web`, `version` |
| `listener.started`, `listener.stopped`, `listener.error` | listener | | adres, ramka, kodowanie, `reason`, `code` |
| `conn.open`, `conn.close`, `conn.error` | listener, sender | | adresy, `durationMs`, `bytesIn`, `bytesOut`, `messages` |
| `bytes.in`, `bytes.out` | listener, sender | | `length`, `previewHex` (32 bajty) |
| `frame.garbage` | sender | | bajty od bramki, gdy nie czekamy na odpowiedź |
| `frame.incomplete` | listener, sender | | `hex`, `text`, `framing`, `reason` (`close`, `idle`, `timeout`) |
| `msg.in` | listener | `receiveMs` | treść, `raw.hex`, `framing`, `summary`, `encodingWarnings`, `timing` |
| `ack.out` | listener | `processingMs` | treść ACK, `mode`, `delayMs`, `inReplyTo` |
| `ack.skipped` | listener | | `inReplyTo`, `reason` |
| `sender.connect` | sender | `connectMs` | `host`, `port`, `ok`, `error` |
| `msg.out` | sender | | treść, `framing`, `repeatIndex` |
| `ack.in` | sender | `ackMs` | treść ACK, `framing`, `validation`, `timing` |
| `ack.timeout` | sender | | `partialHex`, `framing`, `controlId` |
| `sender.error` | sender | | `phase` (`connect`, `send`, `ack`), `code`, `message` |
| `scenario.start`, `scenario.step`, `scenario.end` | scenario | | `runId`, kroki, asercje, status |

`framing` (wynik `analyzeFraming`): `prefixHexExpected`, `prefixHexActual`, `prefixOk`, to samo dla
sufiksu, `segmentSeparator` (`CR`, `LF`, `CRLF`, `mixed`, `none`), `trailingSeparator`, `nonAsciiCount`,
`controlChars`, `knownVariant`, `warnings`.

## REST API

JSON, błędy jako `{ "error": "..." }` z kodem 400, 404, 409 lub 500. Limit treści żądania 20 MB.

| Metoda | Ścieżka | Treść albo parametry | Zwraca |
|---|---|---|---|
| GET | `/api/health` | | `{ ok, uptimeMs, version }` |
| GET | `/api/state` | | listenery, statystyki zdarzeń, konfiguracja, scenariusze, czas serwera |
| GET | `/api/listeners` | | statusy listenerów |
| POST | `/api/listeners` | konfiguracja listenera, `id` wymagane | status, 201 |
| PUT | `/api/listeners/:id` | część konfiguracji | status; restart przy zmianie hosta, portu, ramki, kodowania |
| DELETE | `/api/listeners/:id` | | 204 |
| POST | `/api/listeners/:id/start`, `/stop` | | status |
| POST | `/api/send` | pola wysyłki, scalane z `senderDefaults` | `{ results[], summary }` |
| GET | `/api/events` | `sinceId`, `limit`, `types` (po przecinku), `endpointId`, `text`, `level` | `{ events, stats }` |
| DELETE | `/api/events` | | 204 |
| GET | `/api/events/export` | `format=csv` albo `ndjson` i filtry jak wyżej | plik do pobrania |
| GET | `/api/events/:id` | | zdarzenie |
| POST | `/api/parse` | `{ text, prefixHex?, suffixHex? }` | segmenty, podsumowanie, tokeny, analiza ramki |
| POST | `/api/ack/preview` | `{ text, code, textMessage, errorCode, template }` | `{ ack, tokens }` |
| GET | `/api/examples` | | wiadomości z `examples/` |
| GET | `/api/scenarios` | | lista scenariuszy |
| POST | `/api/scenarios/:name/run` | `{ overrides?: { target, vars, continueOnFailure } }` | przebieg, po jego zakończeniu |
| POST | `/api/scenarios/:name/stop` | | `{ stopped }`, 409 gdy scenariusz nie działa |
| GET | `/api/scenarios/runs`, `/api/scenarios/runs/:runId` | | ostatnie przebiegi, jeden przebieg |
| GET | `/api/config` | | konfiguracja |
| PUT | `/api/config/ui` | `{ latencyThresholds }` | `config.ui`, zapisane do pliku |
| GET | `/lib/*.js` | | moduły HL7 dla przeglądarki |

Przykłady:

```bash
curl -s http://localhost:7575/api/health
curl -s -X POST http://localhost:7575/api/send -H 'Content-Type: application/json' \
  -d '{"host":"10.0.0.5","port":2575,"encoding":"cp1250","autoControlId":true,"message":"MSH|^~\\&|HIS|SZP|GW|LAB|{{now}}||ADT^A01^ADT_A01|{{controlId}}|P|2.5\rPID|1||123^^^SZP^PI||Kowalski^Jan\r"}'
curl -s 'http://localhost:7575/api/events?types=ack.in,ack.timeout&limit=50'
curl -s -o czasy.csv 'http://localhost:7575/api/events/export?format=csv&types=ack.in'
```

## WebSocket `/ws`

Serwer do klienta:

| Komunikat | Kiedy |
|---|---|
| `{ type: 'snapshot', state, events, serverTime }` | zaraz po połączeniu, ostatnie 500 zdarzeń |
| `{ type: 'event', event }` | każde nowe zdarzenie |
| `{ type: 'state', state }` | po zmianie stanu listenerów, najwyżej co 250 ms, oraz co 2 s |
| `{ type: 'gap', sinceId, dropped }` | klient nie nadążał; zdarzenia po `sinceId` trzeba pobrać przez REST |
| `{ type: 'clear' }` | po wyczyszczeniu zdarzeń |
| `{ type: 'pong', serverTime }` | odpowiedź na `{ type: 'ping' }` od klienta |

## Plik wykonywalny

`scripts/build-exe.mjs`:

1. esbuild składa `src/index.js` z zależnościami w jeden plik CommonJS (`build/exe/bundle.cjs`), bo SEA w Node 22
   uruchamia tylko jeden skrypt CommonJS. Dlatego `src/index.js` nie używa `await` na najwyższym poziomie.
   `import.meta.url` jest podmieniane, a wersja z `package.json` wpisywana jako `__HL7T_VERSION__`.
2. Zasoby: `public/**` jako `public/...`, przeglądarkowe moduły HL7 jako `lib/...`, `scenarios/**`, `examples/**`
   oraz `manifest.json` z listą kluczy (Node 22 nie ma funkcji listującej zasoby).
3. `node --experimental-sea-config` tworzy blob, `postject` wstrzykuje go do kopii `node`.
4. Plik sum kontrolnych `simple-hl7-<wersja>-checksums.txt` i test `--version` na gotowym pliku.

W trybie exe `src/runtime.js` ustawia katalog danych na katalog pliku wykonywalnego, `src/web/server.js`
serwuje interfejs z zasobów, a przy pierwszym starcie `extractDefaults()` zapisuje scenariusze i przykłady
obok programu. Plik dla innego systemu: `node scripts/build-exe.mjs --node <ścieżka do node tego systemu> --target linux-amd64`;
wersja tego `node` musi być dokładnie taka jak Node, który buduje.

## Testy

`npm test` uruchamia `node --test` na `test/**/*.test.js`: hex, ramkowanie (fragmentacja, wiele ramek,
zły prefiks, limit rozmiaru), parser, tokenizer, szablony, ACK, kodowania, listener i wysyłka (czasy,
opóźniony ACK, tryb `none`, zły sufiks i prefiks, timeout ramki, częściowy ACK), scenariusze (także
wszystkie dołączone pliki), REST i WebSocket. Pomocnicze funkcje są w `test/helpers.js`, porty są losowe.
