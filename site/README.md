# Strona projektu

Katalog `simple-hl7/` to strona projektu: prezentacja programu i pobieranie najnowszego wydania.
Szczegóły działania zostają w README i w instrukcji, do których strona linkuje. Strona jest
samodzielna: ma własne `style.css` i `site.js` i nie korzysta ze wspólnych plików huba
Mysttic/Mysttic.

| Plik | Co robi |
|---|---|
| `index.html` | treść strony, po angielsku (interfejs programu jest po polsku) |
| `style.css` | wygląd, jasny i ciemny motyw w kolorach programu |
| `site.js` | przełącznik motywu (Auto, Light, Dark) i przyciski pobierania |
| `img/` | ikona i zrzuty ekranu |

## Pobieranie

`site.js` przy każdym otwarciu pyta API GitHuba o wydania tego repozytorium (`Mysttic/simple-hl7`),
wybiera najwyższe `v<wersja>` i podpina pliki po końcówce nazwy:

| Przycisk | Plik w wydaniu |
|---|---|
| Windows | `simple-hl7-<wersja>-windows-amd64.exe` |
| Linux | `simple-hl7-<wersja>-linux-amd64` |
| Checksums | `simple-hl7-<wersja>-checksums.txt` |

Nazwy plików tworzy `scripts/build-exe.mjs`, a plik sum kontrolnych workflow `Release`. Nowe
wydanie nie wymaga więc żadnej zmiany na stronie. Gdy API nie odpowiada (brak sieci albo wyczerpany
limit 60 zapytań na godzinę z jednego adresu), przyciski prowadzą do listy wydań na GitHubie.

API odpowiada tylko dla repozytorium publicznego. Dopóki to repozytorium jest prywatne, przyciski
prowadzą do strony wydań, której gość nie zobaczy. Kopia strony postawiona gdzie indziej może czytać
wydania z innego repozytorium: wystarczy przed `site.js` ustawić na przykład
`window.RELEASES_SOURCE = { repo: 'Mysttic/Mysttic', tagPrefix: 'simple-hl7-v' }`, czyli kopie wydań
na hubie.

## Zrzuty

`node scripts/screenshots.mjs` odświeża zrzuty do README i kopiuje pięć z nich do `simple-hl7/img/`:
`promo.png` (widok Prosty), `full.png` (widok Pełny), `framing.png`, `client.png` i `scenarios.png`.

## Podgląd

Wystarczy otworzyć `simple-hl7/index.html` w przeglądarce.

## Publikacja

Strona zastępuje stronę projektu na hubie (https://mysttic.github.io/Mysttic/simple-hl7/). Działa
w pełni dopiero z publicznego repozytorium, na przykład przez GitHub Pages serwujące ten katalog.
Do tego czasu pliki do pobrania pokazuje hub: job `site` w workflow `Release` kopiuje tam pliki
każdego wydania pod tagiem `simple-hl7-v<wersja>`.
