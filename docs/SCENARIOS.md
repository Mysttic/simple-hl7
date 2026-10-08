# Scenariusze YAML

Scenariusz to plik `scenarios/<nazwa>.yaml` (lub `.yml`) opisujący sekwencję kroków: wyślij wiadomość i sprawdź ACK,
poczekaj na wiadomość przychodzącą i sprawdź jej pola, odczekaj. Każdy krok ma asercje z wynikiem
`ok` / `expected` / `actual`, a cały przebieg kończy się statusem `passed`, `failed`, `error` lub `stopped`.
Scenariusze służą do powtarzalnych testów odbiorczych u klienta: ten sam plik uruchamiasz po każdej
zmianie konfiguracji bramki i porównujesz wyniki.

## Uruchamianie

- **UI**: panel **Scenariusze**, przycisk **Uruchom** przy wybranym pliku. Pola **Host** i **Port** nad listą
  nadpisują adres bramki z pliku (to samo co `overrides.target` niżej) i są pamiętane w przeglądarce. Puste pola
  oznaczają adres z pliku. Wynik pokazuje kroki, tabelę asercji (oczekiwane vs faktyczne) oraz czasy.
- **Zatrzymanie**: w trakcie przebiegu kafelek ma przycisk **Zatrzymaj** (REST: `POST /api/scenarios/<nazwa>/stop`,
  409, gdy scenariusz nie jest uruchomiony). Krok `wait` i `receive` kończy się od razu, seria wysyłek kroku `send`
  po wiadomości w drodze, pozostałe kroki są pomijane, a przebieg dostaje status `stopped`.
- **REST**: `POST /api/scenarios/<nazwa>/run` z opcjonalnym body `{ "overrides": { ... } }`. Odpowiedź przychodzi po
  zakończeniu całego przebiegu (ustaw odpowiednio timeout klienta HTTP i proxy). Lista: `GET /api/scenarios`,
  historia: `GET /api/scenarios/runs` (ostatnie 50, najnowszy pierwszy), pojedynczy przebieg: `GET /api/scenarios/runs/<runId>`.
- `<nazwa>` w adresie to nazwa pliku bez rozszerzenia (np. `02_przyjecie_pacjenta_a01` dla `scenarios/02_przyjecie_pacjenta_a01.yaml`);
  dozwolone znaki w nazwie pliku: litery, cyfry, `_`, `.`, `-`. Przyjmowana jest też pełna nazwa pliku
  albo wartość pola `name` z wnętrza pliku. Pole `name` jest nazwą wyświetlaną i może zawierać spacje.
- `overrides` nadpisuje wybrane sekcje pliku bez jego edycji, więc jeden scenariusz można uruchamiać
  przeciwko różnym środowiskom:

  ```json
  {
    "overrides": {
      "target": { "host": "10.20.30.40", "port": 2575, "encoding": "cp1250" },
      "vars": { "patientId": "999" },
      "continueOnFailure": true
    }
  }
  ```

  `overrides.target` przyjmuje te same klucze co sekcja `target`, `overrides.vars` dopisuje lub podmienia zmienne,
  `overrides.continueOnFailure` nadpisuje flagę z pliku. Inne klucze w `overrides` są odrzucane błędem 400.
- Plik z błędem składni pojawia się na liście (`GET /api/scenarios`) z polem `error` zamiast przerywać listowanie;
  próba uruchomienia takiego pliku kończy się błędem 400 z tym samym komunikatem.

Przykład z linii poleceń:

```bash
curl -s -X POST http://localhost:7575/api/scenarios/02_przyjecie_pacjenta_a01/run \
  -H 'Content-Type: application/json' \
  -d '{"overrides":{"target":{"host":"10.20.30.40","port":2575}}}' | jq '.status, .steps[].assertions'
```

## Struktura pliku

```yaml
name: 02 Przyjęcie pacjenta      # nazwa wyświetlana; brak -> nazwa pliku bez rozszerzenia
description: optional            # opcjonalny opis
continueOnFailure: false         # false: zatrzymaj na pierwszym nieudanym kroku (reszta: skipped)
target:                          # domyślne parametry kroków send, scalane nad config.senderDefaults
  host: 127.0.0.1
  port: 2575
  prefixHex: "0B"
  suffixHex: "1C0D"
  encoding: cp1250
  ackTimeoutMs: 5000
vars:                            # zmienne dostępne jako {{vars.nazwa}} w wiadomościach, match i oczekiwanych wartościach
  patientId: "12345"
steps:                           # wymagane, niepusta lista; każdy krok ma dokładnie jedno z: send, receive, wait
  - name: send ADT^A01
    send: { ... }
    expect: { ... }
  - name: wait for inbound ORU
    receive: { ... }
    expect: { ... }
  - name: pause
    wait: { ms: 500 }
```

Walidacja jest ścisła: nieznany klucz na dowolnym poziomie (literówka w `expect`, `send` itd.) powoduje błąd
parsowania z komunikatem wskazującym miejsce i listę dozwolonych kluczy. Dzięki temu literówka w asercji nie
przechodzi "po cichu" jako test, który niczego nie sprawdza.

### Klucze najwyższego poziomu

| klucz | typ | wymagane | znaczenie |
|---|---|---|---|
| `name` | string | nie (nazwa pliku) | nazwa wyświetlana w UI i w zdarzeniach `scenario.*` |
| `description` | string | nie | opis pokazywany na liście scenariuszy |
| `continueOnFailure` | bool | nie (`false`) | `true`: po nieudanym kroku wykonuj kolejne; `false`: kolejne kroki dostają status `skipped` |
| `target` | obiekt | nie | domyślne pola wysyłki dla wszystkich kroków `send`; dowolny klucz z tabeli "Krok send" poza `file` i `message` |
| `vars` | obiekt | nie | zmienne; klucze to identyfikatory (`[A-Za-z_][A-Za-z0-9_]*`), wartości skalarne, zawsze zamieniane na tekst. Liczby podawaj w cudzysłowie (`"00123"`), żeby YAML nie obciął zer wiodących |
| `steps` | lista | tak | kroki wykonywane po kolei, co najmniej jeden |

Kolejność scalania parametrów wysyłki (późniejsze nadpisuje wcześniejsze):
`config.senderDefaults` < `target` < `overrides.target` z żądania < pola kroku `send`.

### Krok `send`

Wysyła jedną wiadomość (lub `repeat` wiadomości) tak samo jak panel Sender i `POST /api/send`.

| klucz | typ | znaczenie |
|---|---|---|
| `name` | string | nazwa kroku (opcjonalna; domyślnie `send step N`) |
| `file` | string | ścieżka do pliku z wiadomością, względem katalogu programu (obok pliku wykonywalnego) albo projektu przy uruchomieniu ze źródeł, np. `examples/adt_a01.hl7`; musi wskazywać do wnętrza tego katalogu. Początkowe linie zaczynające się od `#` oraz puste są pomijane |
| `message` | string | treść wiadomości wprost w YAML (blok `\|`); separatorami segmentów mogą być nowe linie. Podaj `file` albo `message`, nie oba |
| `host`, `port` | string, number | adres bramki (`port` od 1 do 65535) |
| `prefixHex`, `suffixHex` | string | ramka wysyłanej wiadomości (hex, np. `"0B"`, `"1C0D"`, `""` dla braku) |
| `ackPrefixHex`, `ackSuffixHex` | string lub null | oczekiwana ramka ACK; `null` oznacza taką jak wyjściowa |
| `encoding` | string | `utf8`, `cp1250`, `iso88592`, `latin1`, `windows1252`, `ascii` |
| `normalizeSegmentSeparator` | bool | zamień separatory segmentów na CR i dopilnuj końcowego CR (domyślnie `true`) |
| `autoControlId` | bool | podmień MSH-10 na nowy identyfikator; potrzebne, żeby `controlIdMatches` miało sens przy powtórzeniach |
| `renderTemplate` | bool | renderuj placeholdery (`{{controlId}}`, `{{now}}` itd.) przed wysłaniem (domyślnie `true`) |
| `connectTimeoutMs`, `ackTimeoutMs` | number | timeouty w ms (0 do 3600000) |
| `expectAck` | bool | `false`: nie czekaj na ACK (asercje `ack.*` wtedy nie mają sensu) |
| `repeat`, `intervalMs`, `keepAlive` | number, number, bool | wyślij N razy (1 do 100000) co `intervalMs`; `keepAlive: true` używa jednego połączenia TCP |
| `logBytes` | bool | emituj zdarzenia `bytes.in` / `bytes.out` dla tego kroku |
| `id` | string | `endpointId` zdarzeń sendera dla tego kroku (domyślnie `sender`) |

Kolejność renderowania treści: najpierw runner podstawia wyłącznie `{{vars.nazwa}}` (z pliku `.hl7` albo z `message`),
potem sender (przy `renderTemplate: true`) renderuje pozostałe placeholdery (`{{controlId}}`, `{{now}}`, `{{now:FORMAT}}`,
`{{seq}}`), a przy `autoControlId: true` podmienia MSH-10. Wartości w `vars` nie są renderowane
(placeholder w wartości zmiennej trafi do wiadomości dosłownie i zostanie zrenderowany dopiero przez sender, ale
w oczekiwanych wartościach asercji pozostanie dosłowny). Pełna lista placeholderów jest w README (sekcja "Placeholdery").

Przy `repeat > 1` asercje są liczone osobno dla każdej wysyłki, a ich nazwy dostają przedrostek `#1 `, `#2 `, ...;
krok przechodzi tylko wtedy, gdy wszystkie wysyłki spełniają wszystkie asercje.

### Krok `receive`

Czeka na wiadomość przychodzącą na wskazanym listenerze (zdarzenie `msg.in`).

| klucz | typ | znaczenie |
|---|---|---|
| `listenerId` | string | `id` listenera z konfiguracji (domyślnie `default`); nieistniejący listener daje status kroku `error` |
| `timeoutMs` | number | maksymalny czas oczekiwania w ms (domyślnie `10000`); po przekroczeniu krok ma status `failed` z asercją `receive.message` |
| `match` | obiekt `{ "ŚCIEŻKA": "wartość" }` | opcjonalny filtr: wiadomości, których pola nie pasują, są ignorowane i oczekiwanie trwa dalej (np. `{ "MSH-9.1": "ORU" }`); wartości mogą zawierać `{{vars.x}}` |

Listener musi być w stanie `listening`; krok nie uruchamia go sam. Wiadomość jest normalnie potwierdzana ACK
według konfiguracji listenera, krok `receive` tylko ją obserwuje.

Krok bierze pod uwagę wiadomości odebrane od początku przebiegu scenariusza, nie tylko te, które przyjdą
po jego starcie. Bramka może odesłać wynik, zanim skończy się poprzedni krok (np. jeszcze w trakcie
oczekiwania na ACK), i krok `receive` go nie przegapi. Każda wiadomość jest dopasowywana do jednego kroku:
dwa kolejne kroki `receive` dostaną dwie różne wiadomości.

### Krok `wait`

| klucz | typ | znaczenie |
|---|---|---|
| `ms` | number | pauza w milisekundach (0 do 600000), np. czas na przetworzenie po stronie bramki przed kolejnym krokiem |

Dopuszczalny jest też skrót `wait: 500` (sama liczba). Krok `wait` nie może mieć sekcji `expect`.

### Sekcja `expect`

Asercje po kroku `send` oceniane są na odebranym ACK, po kroku `receive` na odebranej wiadomości.

| klucz | dotyczy | typ | znaczenie |
|---|---|---|---|
| `ack.msa1` | send | string lub lista | oczekiwana wartość MSA-1 w ACK, np. `AA` lub `[AA, CA]` (porównanie bez rozróżniania wielkości liter) |
| `ack.controlIdMatches` | send | bool | MSA-2 w ACK równe MSH-10 wysłanej wiadomości |
| `ack.maxAckMs` | send | number | `ackMs` (od wypchnięcia ramki do skompletowania ramki ACK) nie większy niż podana wartość |
| `ack.timeout` | send | bool | `true`: oczekujemy BRAKU ACK (zdarzenie `ack.timeout`), test negatywny; `false`: ACK musi przyjść (dodatkowa asercja `ack.received`) |
| `framing.prefixOk` | send, receive | bool | prefix ramki (ACK lub wiadomości wejściowej) zgodny z oczekiwanym |
| `framing.suffixOk` | send, receive | bool | suffix ramki zgodny z oczekiwanym |
| `framing.segmentSeparator` | send, receive | `CR`, `LF`, `CRLF`, `mixed`, `none` | separator segmentów wykryty w treści |
| `framing.trailingSeparator` | send, receive | bool | treść kończy się separatorem segmentu przed suffixem |
| `framing.knownVariant` | send, receive | string | podpowiedź wariantu ramki z analizy, np. `MLLP standard (0B / 1C 0D)` |
| `framing.prefixHexActual`, `framing.suffixHexActual` | send, receive | string | faktyczne bajty prefixu / suffixu (hex wielkimi literami, bez separatorów) |
| `framing.nonAsciiCount` | send, receive | number | liczba bajtów spoza ASCII w treści |
| `fields` | send, receive | obiekt `{ "ŚCIEŻKA": "wartość" }` | porównanie pól; wartości renderowane placeholderami `{{vars.x}}`, porównanie jako tekst; `null` oznacza "pole puste lub nieobecne" |
| `maxReceiveMs` | receive | number | `receiveMs` (od pierwszego bajtu ramki do suffixu) nie większy niż podana wartość |

Sekcja `ack` jest dozwolona tylko w krokach `send`, `maxReceiveMs` tylko w krokach `receive`.

Niezależnie od zawartości `expect` krok `send` zawsze dostaje asercję `send.ok` (wysyłka zakończona bez błędu
połączenia, wysyłki i ACK), a przy `ack.timeout: true` zamiast niej `send.delivered` (wiadomość wyszła, błąd
nie wystąpił w fazie `connect` / `send`) oraz `ack.timeout`. Krok `receive` zawsze dostaje asercję `receive.message`.

Ścieżki pól: `SEG-n`, `SEG-n.c`, `SEG-n.c.s`, powtórzenie `SEG-n(r).c`, wystąpienie segmentu `SEG[k]-n`,
np. `MSA-1`, `PID-3.1`, `PID-3(2).1`, `OBX[2]-5`, `MSH-9.1`. Indeksy są liczone od 1. Ścieżka o złej składni
jest odrzucana już przy parsowaniu pliku.

## Wynik przebiegu

```json
{
  "runId": "6f1c2a0e-3b7d-4c0a-9e1f-2d5b8a7c4e10",
  "name": "02 Przyjęcie pacjenta (ADT^A01)",
  "file": "scenarios/02_przyjecie_pacjenta_a01.yaml",
  "startedAt": "2026-10-07T20:15:01.123Z",
  "finishedAt": "2026-10-07T20:15:01.388Z",
  "durationMs": 265.412,
  "status": "passed",
  "steps": [
    {
      "index": 0,
      "name": "send ADT^A01",
      "kind": "send",
      "status": "passed",
      "durationMs": 41.207,
      "assertions": [
        { "name": "send.ok", "ok": true, "expected": true, "actual": true },
        { "name": "ack.msa1", "ok": true, "expected": "AA", "actual": "AA" },
        { "name": "ack.controlIdMatches", "ok": true, "expected": true, "actual": true },
        { "name": "ack.maxAckMs", "ok": true, "expected": "<= 1000 ms", "actual": 12.4 },
        { "name": "framing.prefixOk", "ok": true, "expected": true, "actual": true },
        { "name": "framing.suffixOk", "ok": true, "expected": true, "actual": true },
        { "name": "fields.MSA-1", "ok": true, "expected": "AA", "actual": "AA" }
      ],
      "result": { "results": [ { "ok": true, "controlId": "20261007221501123001", "timings": { "ackMs": 12.4 } } ], "summary": { "count": 1, "ok": 1 } },
      "error": null
    }
  ]
}
```

`result` kroku `send` to pełny wynik `POST /api/send` (`results[]` z czasami i ACK każdej wysyłki oraz `summary`
z `minAckMs` / `avgAckMs` / `maxAckMs` / `p95AckMs`), kroku `receive` to zdarzenie `msg.in`, kroku `wait` `null`.
Czasy (`durationMs`) liczone są z zegara monotonicznego z dokładnością do mikrosekund.

Statusy kroku: `passed`, `failed` (asercja nie przeszła lub timeout odbioru), `error` (błąd wykonania, np. brak
pliku, zły hex, nieistniejący listener), `skipped` (pominięty po wcześniejszym niepowodzeniu), `stopped` (przerwany
zatrzymaniem). Status przebiegu: `stopped`, gdy przebieg zatrzymano; `error`, gdy którykolwiek krok ma status `error`; `failed`, gdy którykolwiek nie przeszedł lub został pominięty;
`passed`, gdy wszystkie kroki przeszły.

W osi czasu przebieg widać jako `scenario.start` (nazwa, liczba kroków), `scenario.step` dla każdego kroku
(status, czas, asercje) oraz `scenario.end` (status, czas, liczba zaliczonych i niezaliczonych); `endpointId`
tych zdarzeń to `runId`. Zdarzenia `msg.out`, `ack.in`, `ack.timeout`, `msg.in` wygenerowane przez kroki mają
`endpointId` jak zwykle (`sender`, id listenera), więc filtrując po czasie przebiegu zobaczysz pełny ruch
sieciowy scenariusza.

## Dołączone scenariusze

Przy pierwszym starcie program zapisuje w katalogu `scenarios/` dziewięć gotowych plików. Wszystkie domyślnie
celują w `127.0.0.1:2575`, czyli we własny listener testera, więc działają od razu jako demonstracja. Do testu
bramki wpisz jej adres w polach **Host** i **Port** panelu Scenariusze.
Trzy scenariusze zachowują się bez bramki inaczej niż przy niej: `05` kończy się błędem, bo własny
listener odpowiada AA na wszystko; `06` czeka na wynik, który trzeba odesłać samemu (w panelu
**Klient** wybierz przykład `oru_r01` i wyślij go w ciągu 5 minut); `07` czeka na dowolną wiadomość,
np. wysłaną z panelu **Klient**.

| Plik | Kroki | Oczekiwany wynik przy prawidłowej bramce | Gdy nie przechodzi |
|---|---|---|---|
| `01_czy_bramka_odpowiada` | ADT^A08 | jakikolwiek ACK (AA, AE, AR) w 3 s, MSA-2 = MSH-10, ramka `0B ... 1C 0D` | brak ACK: zła ramka, zły port albo bramka nie odpowiada na tym połączeniu; inny MSA-2: bramka potwierdza nie tę wiadomość |
| `02_przyjecie_pacjenta_a01` | ADT^A01 | AA w czasie do 1 s | AE / AR: przeczytaj MSA-3 i ERR w ACK; za wolno: porównaj `firstByteMs` i `ackMs` |
| `03_hospitalizacja_a01_a08_a03` | A01, A08, A03 tego samego pacjenta | trzy razy AA | bramka odrzuca A08 lub A03 bez wcześniejszego A01 albo ma kłopot z kolejnością |
| `04_polskie_znaki_iso8859_2` | ADT^A01 w ISO-8859-2 | AA | krzaki po stronie bramki: zmień `encoding` w `target` na `cp1250` albo `utf8` i porównaj |
| `05_bledna_wiadomosc` | ADT^A01 bez PID | AE albo AR z poprawnym MSA-2 | AA: bramka nie waliduje treści; ustal z klientem, czy tak ma być |
| `06_zlecenie_i_wynik` | ORM^O01, potem odbiór ORU^R01 | AA na zlecenie, w 5 min wynik dla PID-3.1 i OBR-2.1 ze zlecenia | brak wyniku: sprawdź, czy bramka ma skonfigurowaną wysyłkę na adres testera; `frame.incomplete` na osi czasu oznacza inną ramkę |
| `07_odbior_z_bramki` | odbiór | dowolna wiadomość w 2 min, ramka `0B ... 1C 0D`, separatory CR, CR przed sufiksem | czerwone znaczki w inspektorze pokazują, co dokładnie jest nie tak |
| `08_czas_odpowiedzi_20x` | 20 x ADT^A08 co 200 ms, jedno połączenie | każdy ACK AA do 500 ms | wolne pojedyncze ACK: porównaj ich numery z logiem bramki; wolny tylko pierwszy: koszt otwarcia sesji |
| `09_zly_sufiks` | ADT^A08 z sufiksem `0D0A` | brak ACK (timeout po 3 s) | ACK mimo złej ramki: bramka ma luźne ramkowanie, warto to zgłosić |

## Własny scenariusz

Najprościej skopiować najbliższy dołączony plik i zmienić go. Przykład: klient potwierdza, że bramka
przyjmuje A01 w cp1250 i odsyła AA w czasie do 800 ms, a numer pacjenta ma pochodzić z ich systemu testowego.

```yaml
name: Klient X, przyjęcie w cp1250
description: ADT^A01 w cp1250, AA do 800 ms, pacjent testowy klienta
target:
  encoding: cp1250
  ackTimeoutMs: 5000
vars:
  pesel: "00000000000"
  nazwisko: "Testowy"
steps:
  - name: ADT^A01
    send:
      autoControlId: true
      message: |
        MSH|^~\&|HIS|SZPITAL|BRAMKA|LAB|{{now}}||ADT^A01^ADT_A01|{{controlId}}|P|2.5|||AL|NE|PL|CP1250
        EVN|A01|{{now}}
        PID|1||{{vars.pesel}}^^^SZPITAL^PI||{{vars.nazwisko}}^Jan||19800101|M
        PV1|1|I|ODDZ^101^1
    expect:
      ack:
        msa1: AA
        controlIdMatches: true
        maxAckMs: 800
      framing:
        prefixOk: true
        suffixOk: true
```

Brak `host` i `port` w `target` oznacza wartości domyślne z konfiguracji programu; adres bramki podaje się
w panelu. Plik zapisz w `scenarios/` obok programu i kliknij **Odśwież** nad listą.

W oczekiwanych wartościach `fields` i w `match` działają wyłącznie placeholdery `{{vars.x}}`; kontekstem jest
scenariusz, nie odebrana wiadomość, więc `{{field:...}}` ani `{{now}}` nie mają tu zastosowania.

## Dobre praktyki

- Jeden plik na jeden przypadek testowy z protokołu odbioru; numer na początku nazwy ustala kolejność na liście.
- Zawsze `autoControlId: true` przy `repeat` i przy wielokrotnym uruchamianiu, inaczej bramka może odrzucać
  duplikaty MSH-10.
- Progi `maxAckMs` i `maxReceiveMs` ustawiaj z zapasem względem SLA (np. SLA 1 s, próg 800 ms), a do raportu
  bierz faktyczne wartości `actual` z asercji oraz `minAckMs` / `avgAckMs` / `p95AckMs` z `result.summary` kroku `repeat`.
- Adresu bramki nie wpisuj do plików: podawaj go w panelu (pola Host i Port) albo przez `overrides.target`.
- Zmienne, które muszą być unikalne między przebiegami (numery zleceń, identyfikatory), podawaj przez `overrides.vars`.
- Eksportuj zdarzenia z czasu przebiegu (`GET /api/events/export?format=csv`) jako załącznik do protokołu.
