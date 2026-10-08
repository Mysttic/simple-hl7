# Changelog

Wszystkie istotne zmiany w projekcie. Format według [Keep a Changelog](https://keepachangelog.com/pl/1.1.0/),
numeracja według [SemVer](https://semver.org/lang/pl/). Numer bieżącej wersji jest w `VERSION.md`;
release powstaje po merge do `master`, który zmienia `VERSION.md`, gdy ten numer jest wyższy od
ostatniego wydanego tagu.

## [Unreleased]

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
