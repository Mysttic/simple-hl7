# Znaczki ramki

[Spis treści](README.md) · Poprzednia: [Wiadomość odebrana](50-wiadomosc-odebrana.md) · Następna: [Zakładka Czytelny](52-zakladka-czytelny.md) <!-- nav -->

Poprawna ramka MLLP:

![Znaczki poprawnej ramki: Prefix OK, Suffix OK, Separator CR, Końcowy CR OK, Non-ASCII, Wariant](img/51-znaczki-ramki-ok.png)

> Znaczki ramki są w widokach Standardowy i Pełny, patrz [Widok interfejsu](08-widok.md).

Ramka ze złym sufiksem:

![Znaczki ramki ze złym sufiksem: czerwony znaczek sufiksu, separator mieszany, wariant 0D 0A](img/51-znaczki-ramki-blad.png)

Znaczki w inspektorze podsumowują analizę ramki bajt po bajcie. Pojawiają się przy każdym zdarzeniu,
które ma bajty ramki: wiadomości odebranej i wysłanej, ACK wysłanym i odebranym, niekompletnej
ramce i braku ACK z częściowo odebranymi bajtami. Po najechaniu na znaczek widać dokładniejszy opis.

## Znaczki

| Znaczek | Kolor | Znaczenie |
|---|---|---|
| **Prefix OK 0B** | zielony | ramka zaczyna się od oczekiwanego prefiksu |
| **Prefix: oczekiwano 0B, otrzymano 00** | czerwony | pierwsze bajty są inne niż oczekiwany prefiks; `brak` oznacza ramkę bez prefiksu |
| **Suffix OK 1C 0D** | zielony | ramka kończy się oczekiwanym sufiksem |
| **Suffix: oczekiwano 1C 0D, otrzymano 0D 0A** | czerwony | ostatnie bajty są inne niż oczekiwany sufiks |
| **Separator CR** | zielony | segmenty rozdzielone znakiem CR, zgodnie z HL7 |
| **Separator LF**, **CRLF**, **mieszany** | żółty | segmenty rozdzielone LF, CRLF albo różnymi znakami naraz; wiele bramek takich wiadomości nie przyjmie |
| **Separator brak** | szary | nie znaleziono separatora, np. jednosegmentowa wiadomość |
| **Końcowy CR OK** | zielony | po ostatnim segmencie, przed sufiksem, jest CR, jak wymaga MLLP |
| **Brak końcowego CR** | żółty | brak CR po ostatnim segmencie; część systemów gubi wtedy ostatni segment |
| **Non-ASCII: 37** | niebieski | liczba bajtów o wartości 0x80 i wyższej, czyli zwykle polskich znaków. Informacja, nie błąd |
| **Znaki sterujące: N** | żółty | w treści są bajty sterujące inne niż CR i LF, np. podwójny prefiks albo resztka poprzedniej ramki; po najechaniu pozycje i wartości |
| **Wariant: …** | szary | rozpoznany sposób ramkowania, opis niżej |
| **Kodowanie: MSH-18 8859/2 vs cp1250** | żółty | wiadomość deklaruje w MSH-18 inne kodowanie niż to, którym ją odczytano |
| **MSH-18: …** | szary | MSH-18 ma wartość, której program nie rozpoznaje, więc nie sprawdza kodowania |

## Warianty ramki

| Wariant | Ramka |
|---|---|
| standard MLLP (0B / 1C 0D) | poprawna ramka MLLP |
| MLLP z dodatkowym LF (0B / 1C 0D 0A) | po sufiksie jest jeszcze LF |
| MLLP bez końcowego CR (0B / 1C) | sufiks bez CR |
| prefiks 0B, sufiks 0D 0A (CRLF, bez FS) | zamiast `1C 0D` na końcu jest CRLF |
| prefiks 0B, bez sufiksu (koniec na CR) | brak sufiksu |
| prefiks 0B, nieznany sufiks | sufiks nierozpoznany |
| tylko sufiks 1C 0D (bez prefiksu) | brak prefiksu |
| tylko sufiks 1C | brak prefiksu i CR w sufiksie |
| sufiks 0D 0A (CRLF, bez FS) | brak prefiksu, koniec na CRLF |
| STX / ETX (02 / 03) | inny protokół ramkowania |
| bez ramki | sama treść HL7 bez prefiksu i sufiksu |

## Ostrzeżenia pod znaczkami

Pod znaczkami może pojawić się lista ostrzeżeń z analizy ramki, kontroli kodowania i odczytu
wiadomości. Najczęstsze:

| Ostrzeżenie | Co zrobić |
|---|---|
| Sufiks niezgodny / Prefiks niezgodny | porównaj z ustawieniami ramki bramki; jeśli bramka tak ma działać, zmień prefiks lub sufiks listenera |
| Oczekiwany prefiks 0B jest na pozycji 2, przed nim 2 B | przed ramką przyszły dodatkowe bajty; zajrzyj do zakładki Hex |
| Segmenty rozdzielone LF zamiast CR | bramka albo system źródłowy zamienia CR na LF |
| Brak CR przed sufiksem | ostatni segment bez CR |
| Prefiks 0B występuje w treści na pozycji N | prawdopodobnie dwie wiadomości bez sufiksu między nimi |
| MSH-18 deklaruje …, a treść zdekodowano jako … | ustaw kodowanie listenera zgodnie z MSH-18 albo zgłoś bramce błędną deklarację |
| Zdekodowano jako UTF-8, a treść ma N bajtów niepoprawnych w UTF-8 | bramka wysyła w cp1250 albo ISO-8859-2; zmień kodowanie listenera |
| Zdekodowano jako cp1250, a treść wygląda na UTF-8 | bramka wysyła w UTF-8; zmień kodowanie listenera |

---

[Spis treści](README.md) · Poprzednia: [Wiadomość odebrana](50-wiadomosc-odebrana.md) · Następna: [Zakładka Czytelny](52-zakladka-czytelny.md) <!-- nav -->
