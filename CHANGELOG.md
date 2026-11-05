# Changelog

Wszystkie istotne zmiany w projekcie. Format według [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/),
numeracja według [SemVer](https://semver.org/lang/pl/). Numer bieżącej wersji jest w `VERSION.md`;
release powstaje po merge do `master`, który zmienia `VERSION.md`, gdy ten numer jest wyższy od
ostatniego wydanego tagu.

## [Unreleased]

### Dodane

- Widok interfejsu ([#4](https://github.com/Mysttic/simple-hl7/issues/4)): lista **Widok** w górnym pasku
  i sekcja w oknie Ustawienia przełączają między widokami Prosty, Standardowy, Pełny i Własny (dowolny
  zestaw z 29 elementów ekranu). Nowa przeglądarka zaczyna w widoku Prosty, a przeglądarka używana
  wcześniej w widoku Pełny, czyli bez zmian na ekranie.
- Panel Klient pokazuje ukryte w bieżącym widoku pola z wartością inną niż domyślna i link
  **Przywróć domyślne**. Błąd w ukrytym polu przy wysyłce podaje nazwę pola.
- Instrukcja: strona [Widok interfejsu](docs/instrukcja/08-widok.md) i uwaga o widokach na stronach
  elementów, których nie ma w każdym widoku.

### Zmienione

- Główny zrzut w README i na stronie projektu pokazuje widok Prosty; widok Pełny ma w README osobny zrzut.
- Sekcja okna Ustawienia z czasem UTC i zdarzeniami bajtów nazywa się **Wyświetlanie**.
- Widok bez paska filtrów czyści aktywne filtry osi czasu. Gdy widok ukrywa zdarzenia połączeń,
  eksport bez filtra typów też je pomija.

## [0.1.1] - 2026-10-08

### Dodane

- Przycisk **Zatrzymaj** na kafelku uruchomionego scenariusza i `POST /api/scenarios/<nazwa>/stop`: czekanie
  kończy się od razu, seria wysyłek po wiadomości w drodze, przebieg dostaje status `stopped`.

### Zmienione

- Domyślny port interfejsu to `7575` zamiast zajętego często `8080` ([#1](https://github.com/Mysttic/simple-hl7/issues/1)).
  Istniejąca instalacja zachowuje port zapisany w swoim `config/app.json`.
- CSV z eksportu ma średnik, przecinek dziesiętny i BOM UTF-8, więc polski Excel otwiera go dwuklikiem w kolumnach.
- Plik eksportu nazywa się `simple-hl7-events-<data>`.
- Przykład `adt_a01` deklaruje UTF-8, w którym klient go domyślnie wysyła; scenariusz `04` ma własną kopię
  w ISO-8859-2. Przykład `oru_r01` jest wynikiem zlecenia z `orm_o01`, więc scenariusz `06` da się
  zamknąć bez bramki, wysyłając go z panelu Klient.
- Oś czasu i filtr punktów pokazują nazwę scenariusza zamiast identyfikatora uruchomienia.
- Edytor klienta przy pierwszym uruchomieniu ma gotową wiadomość zamiast pustego pola.

### Naprawione

- Czerwony pasek „Brak połączenia z serwerem” nie miga już przy każdym otwarciu strony.
- Wysokość inspektora zapamiętana na większym oknie nie zasłania osi czasu.
- Job `site` przy odrzuconym `HUB_TOKEN` mówi wprost, że token jest zły.

## [0.1.0] - 2026-10-08

Pierwsze wydanie.

### Dodane

- Serwer MLLP (listenery): dowolna liczba portów, własny prefiks, sufiks i kodowanie każdego z nich,
  ACK w trybie AA, AE, AR, bez ACK albo z własnego szablonu, celowe opóźnienie ACK, osobna ramka ACK,
  timeout ramki, który zgłasza zły sufiks bramki bez czekania na rozłączenie, statystyki czasu
  przetwarzania na kafelku.
- Klient MLLP: wysyłka do bramki z walidacją ACK (MSA-1, zgodność MSA-2 z MSH-10, ramka ACK),
  rozkład czasu na połączenie, wysyłkę, pierwszy bajt i ACK, serie wysyłek z czasami minimalnym,
  średnim, maksymalnym i p95, celowo zła ramka do testów odporności bramki.
- Analiza ramki bajt po bajcie: prefiks, sufiks, separatory segmentów, CR przed sufiksem, znaki
  sterujące, rozpoznany wariant ramki, zgodność kodowania z MSH-18 (UTF-8, CP1250, ISO-8859-2,
  ISO-8859-1, Windows-1252, ASCII).
- Oś czasu wszystkich zdarzeń z czasem co do milisekundy i czasami odpowiedzi z zegara monotonicznego,
  łańcuchy wiadomość i ACK, filtry, podświetlanie powiązanych zdarzeń, eksport CSV i NDJSON, pełny
  dziennik w `logs/events.ndjson`.
- Inspektor: dane z nagłówka MSH, znaczki ramki, zakładki Czytelny (kolorowanie składni), Drzewo
  (pola z nazwami ze słownika HL7 2.5) i Hex, podgląd ACK.
- Scenariusze YAML z krokami wysyłki, odbioru i pauzy oraz warunkami na ACK, pola, ramkę i czasy;
  dziewięć gotowych scenariuszy; adres bramki podawany w interfejsie.
- Jeden plik wykonywalny dla Windows x64 i Linux x64, bez instalacji; przy pierwszym starcie tworzy
  obok siebie konfigurację, scenariusze i przykłady.
- Instrukcja obsługi z opisem każdego elementu interfejsu (`docs/instrukcja/`).
