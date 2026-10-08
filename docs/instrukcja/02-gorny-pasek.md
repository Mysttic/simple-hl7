# Górny pasek

[Spis treści](README.md) · Poprzednia: [Ekran główny](01-ekran-glowny.md) · Następna: [Menu Eksport](03-menu-eksport.md) <!-- nav -->

![Górny pasek: nazwa i wersja, stan połączenia, zegar, licznik, przyciski](img/02-gorny-pasek.png)

Pasek na samej górze ekranu jest widoczny zawsze. Po lewej pokazuje stan programu, po prawej ma
przyciski, które działają na całą oś czasu.

> Na zrzucie pusty środek paska został wycięty. W programie przyciski są dosunięte do prawej krawędzi okna.

## Lewa część: stan

| Element | Znaczenie |
|---|---|
| logo **HL7**, nazwa **simple-hl7** i `v0.1.0` | nazwa i wersja programu działającego na serwerze |
| Kropka i napis stanu | połączenie przeglądarki z programem. Zielone **połączono**: dane płyną na bieżąco. **łączenie...**: chwila po otwarciu strony. **ponawiam (N)**: połączenie zerwane, N to numer kolejnej próby, patrz [Brak połączenia](06-brak-polaczenia.md). Po najechaniu kursorem widać opóźnienie (RTT) między przeglądarką a programem |
| Zegar `HH:mm:ss.SSS` | czas serwera z milisekundami. Przeglądarka koryguje go o różnicę między swoim zegarem a zegarem serwera, więc pokazuje czas, który program zapisuje w zdarzeniach. Po najechaniu widać wielkość korekty i RTT. W trybie UTC (Ustawienia) za czasem stoi dopisek `UTC` |
| Licznik `widoczne / wszystkie` | pierwsza liczba: ile wierszy pokazuje oś czasu po filtrach; druga: ile zdarzeń przeglądarka trzyma w pamięci (najwyżej 2000). Po najechaniu widać też, ile zdarzeń jest w pamięci programu i ile program już odrzucił z bufora |

## Prawa część: przyciski

| Przycisk | Działanie |
|---|---|
| **⏸ Autoprzewijanie** | wstrzymuje przewijanie osi czasu do najnowszych zdarzeń. Po wstrzymaniu napis zmienia się na **▶ Wznów (N)**, gdzie N to liczba zdarzeń, które przyszły w tym czasie. Klawisz: `Spacja`. Szczegóły: [Wstrzymane przewijanie](43-wstrzymane-przewijanie.md) |
| **Filtry** | pokazuje i chowa [pasek filtrów](41-pasek-filtrow.md) nad osią czasu. Podświetlony przycisk oznacza widoczny pasek. Klawisz: `/` |
| **Eksport ▾** | rozwija [menu eksportu](03-menu-eksport.md) zdarzeń do pliku |
| **Wyczyść** (czerwony napis) | usuwa zdarzenia z pamięci programu i z osi czasu, po potwierdzeniu. Szczegóły: [Czyszczenie zdarzeń](05-czyszczenie-zdarzen.md) |
| **⚙ Ustawienia** | otwiera [okno ustawień](04-okno-ustawien.md): progi kolorów czasów, zdarzenia bajtów, strefa czasu |
| **Inspektor** | chowa i pokazuje panel inspektora po prawej. Podświetlony przycisk oznacza widoczny inspektor. Klawisz: `i` |

## Typowe sytuacje

- **Napis stanu nie jest zielony dłużej niż kilka sekund:** program nie działa albo przeglądarka nie
  dociera do niego przez sieć lub proxy. Zobacz [Brak połączenia](06-brak-polaczenia.md).
- **Druga liczba licznika stoi na 2000:** przeglądarka trzyma już maksymalną liczbę zdarzeń i usuwa
  najstarsze. Starsze zdarzenia są nadal w programie (eksport) i w pliku `logs/events.ndjson`.
- **Zegar różni się od zegara w logach bramki:** porównuj z czasem serwera, na którym działa tester.
  Różnica między serwerami wynika z ich zegarów systemowych, nie z testera.

---

[Spis treści](README.md) · Poprzednia: [Ekran główny](01-ekran-glowny.md) · Następna: [Menu Eksport](03-menu-eksport.md) <!-- nav -->
