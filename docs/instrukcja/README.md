# Instrukcja obsługi

Instrukcja opisuje każdy element interfejsu testera bramek HL7: kafelki, formularze, okna, oś czasu
i widoki inspektora. Każdy element ma osobną podstronę ze zrzutem ekranu i opisem wszystkich pól,
przycisków i stanów.

Jak zainstalować i uruchomić program, opisuje [README projektu](../../README.md). Składnię plików
scenariuszy opisuje [docs/SCENARIOS.md](../SCENARIOS.md).

## Pojęcia używane w instrukcji

| Pojęcie | Znaczenie |
|---|---|
| **Bramka** | testowany system integracyjny, który odbiera i wysyła wiadomości HL7 po MLLP |
| **Serwer (listener, nasłuch)** | część testera, która czeka na porcie TCP, aż bramka się połączy i coś wyśle |
| **Klient (nadawca)** | część testera, która sama łączy się do bramki i wysyła wiadomość |
| **Ramka MLLP** | sposób oznaczenia początku i końca wiadomości w strumieniu TCP: prefiks (zwykle `0B`) przed treścią i sufiks (zwykle `1C 0D`) po niej |
| **ACK** | potwierdzenie odbioru, które odbiorca odsyła na każdą wiadomość; pole MSA-1 mówi, czy wiadomość przyjęto (`AA`), czy odrzucono (`AE`, `AR`) |
| **Control ID** | identyfikator wiadomości z pola MSH-10; ACK powtarza go w polu MSA-2 |
| **Zdarzenie** | jeden wpis na osi czasu: połączenie, fragment danych, wiadomość, ACK, błąd, krok scenariusza |
| **Punkt** | kto wygenerował zdarzenie: identyfikator listenera (np. `default`), klient (`sender`), przebieg scenariusza albo `system` |

## Spis treści

### Ogólne

1. [Ekran główny](01-ekran-glowny.md)
2. [Górny pasek](02-gorny-pasek.md)
3. [Menu Eksport](03-menu-eksport.md)
4. [Okno Ustawienia](04-okno-ustawien.md)
5. [Czyszczenie zdarzeń](05-czyszczenie-zdarzen.md)
6. [Brak połączenia z serwerem](06-brak-polaczenia.md)
7. [Powiadomienia](07-powiadomienia.md)

### Serwer

1. [Kafelek serwera](10-kafelek-serwera.md)
2. [Stany kafelka serwera](11-stany-serwera.md)
3. [Formularz serwera: dodawanie](12-formularz-serwera.md)
4. [Formularz serwera: edycja i własny ACK](13-formularz-serwera-ack.md)
5. [Usuwanie serwera](14-usuwanie-serwera.md)

### Klient

1. [Formularz klienta](20-formularz-klienta.md)
2. [Edytor wiadomości](21-edytor-wiadomosci.md)
3. [Podgląd wiadomości](22-podglad-wiadomosci.md)
4. [Wynik wysyłki](23-wynik-wysylki.md)
5. [Wynik wysyłki: błąd](24-wynik-wysylki-blad.md)
6. [Wynik serii wysyłek](25-wynik-serii.md)

### Scenariusze

1. [Adres bramki dla scenariuszy](30-adres-bramki.md)
2. [Kafelek scenariusza](31-kafelek-scenariusza.md)
3. [Scenariusz w trakcie](32-scenariusz-w-trakcie.md)
4. [Ostatnie uruchomienia](33-ostatnie-uruchomienia.md)
5. [Wynik scenariusza](34-wynik-scenariusza.md)

### Oś czasu

1. [Oś czasu](40-os-czasu.md)
2. [Pasek filtrów](41-pasek-filtrow.md)
3. [Filtr typów zdarzeń](42-filtr-typow.md)
4. [Wstrzymane przewijanie](43-wstrzymane-przewijanie.md)
5. [Podświetlanie powiązanych zdarzeń](44-powiazane-zdarzenia.md)

### Inspektor

1. [Wiadomość odebrana](50-wiadomosc-odebrana.md)
2. [Znaczki ramki](51-znaczki-ramki.md)
3. [Zakładka Czytelny](52-zakladka-czytelny.md)
4. [Zakładka Drzewo](53-zakladka-drzewo.md)
5. [Zakładka Hex](54-zakladka-hex.md)
6. [ACK wysłany przez serwer](55-ack-wyslany.md)
7. [Wiadomość wysłana](56-wiadomosc-wyslana.md)
8. [ACK otrzymany](57-ack-otrzymany.md)
9. [Brak ACK](58-brak-ack.md)
10. [Niekompletna ramka](59-niekompletna-ramka.md)
11. [Zdarzenia połączeń i inne zdarzenia techniczne](60-zdarzenie-polaczenia.md)
12. [Krok scenariusza](61-krok-scenariusza.md)
13. [Okno Podgląd ACK](62-podglad-ack.md)

## Zrzuty ekranu

Zrzuty w `img/` generuje skrypt `node scripts/manual-shots.mjs` (potrzebny Edge albo Chrome). Po zmianach
w interfejsie wystarczy go uruchomić ponownie. Skrypt sprawdza też, czy każda podstrona pokazuje swoje zrzuty,
i wypisuje ostrzeżenie, gdy któregoś brakuje.
