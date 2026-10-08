# Strona projektu na hubie Mysttic/Mysttic

Katalog `simple-hl7/` to gotowa strona dla publicznego repozytorium
[Mysttic/Mysttic](https://github.com/Mysttic/Mysttic) (https://mysttic.github.io/Mysttic/),
ułożona tak jak strony innych projektów: korzysta ze wspólnych `assets/style.css`, `assets/theme.js`
i `assets/releases.js`, a jedyny kod per projekt to wywołanie `initDownloads()` na końcu.

Strona sama pobiera listę wydań z API GitHuba przy każdym otwarciu, więc nowe wydanie nie wymaga
żadnego commita w Mysttic/Mysttic. Pliki wydania trafiają tam z workflow `Release` tego
repozytorium (job `site`), pod tagiem `simple-hl7-v<wersja>`.

## Kontrakt ze stroną

Te trzy rzeczy czyta strona, więc zmieniają się tylko razem z nią:

| Co | Wartość |
|---|---|
| tag wydania na hubie | `simple-hl7-v<wersja>`, np. `simple-hl7-v0.1.0` |
| pliki wydania | `simple-hl7-<wersja>-windows-amd64.exe`, `simple-hl7-<wersja>-linux-amd64`, `simple-hl7-<wersja>-checksums.txt` |
| opis wydania na hubie | nazwa i numer, pusta linia, adres strony |

Nazwy plików tworzy `scripts/build-exe.mjs`, a plik sum kontrolnych job `release` w
`.github/workflows/release.yml`. Strona dopasowuje pliki po końcówce nazwy (`initDownloads()` w
`simple-hl7/index.html`).

## Podpięcie (jednorazowo, w repozytorium Mysttic/Mysttic)

Zrobione 2026-10-08 dla wersji 0.1.0. Kroki zostają jako opis tego, co jest na hubie.

1. Skopiować `site/simple-hl7/` jako `simple-hl7/` do katalogu głównego huba.
2. Dodać kartę w głównym `index.html`, obok pozostałych projektów:

```html
    <a class="project" href="simple-hl7/">
      <div class="head">
        <img src="simple-hl7/img/icon.svg" alt="">
        <h2>simple-hl7</h2>
      </div>
      <p>
        An HL7 gateway tester that is one file. Receive and send HL7 v2 over
        MLLP, check every frame byte by byte and see each message and ACK with
        millisecond timestamps and the gateway's response times.
      </p>
      <div class="platforms">
        <span>Windows</span>
        <span>Linux</span>
      </div>
      <span class="go">See it and download →</span>
    </a>
```

3. Jeśli `RELEASES.md` huba ma tabelę projektów, dopisać do niej wiersz:

```
| simple-hl7 | `simple-hl7/` | `simple-hl7-v` |
```

4. Commit i push w Mysttic/Mysttic.

## Po kolejnych wydaniach

Job `site` kopiuje na hub tylko pliki wydania, a nie treść strony. Po zmianie `site/simple-hl7/`
(opis, zrzuty), zwykle przy wydaniu z nowymi funkcjami, trzeba po udanym Release skopiować katalog
jeszcze raz (krok 1), a po zmianie karty podmienić ją w głównym `index.html` huba. Jedno i drugie
to commit w Mysttic/Mysttic.

Zrzuty w `simple-hl7/img/` odświeża `node scripts/screenshots.mjs` razem ze zrzutami do README.

## Podgląd lokalny

Strona potrzebuje wspólnych plików huba z katalogu `assets/`. Do obejrzenia przed kopiowaniem
wystarczy położyć obok siebie `assets/` z klonu Mysttic/Mysttic i `simple-hl7/` z tego katalogu
i otworzyć `simple-hl7/index.html` przez dowolny lokalny serwer HTTP. Bez wydania na hubie sekcja
Download pokazuje odnośnik do listy wydań na GitHubie.
