# Scenariusz w trakcie

[Spis treści](README.md) · Poprzednia: [Kafelek scenariusza](31-kafelek-scenariusza.md) · Następna: [Ostatnie uruchomienia](33-ostatnie-uruchomienia.md) <!-- nav -->

![Kafelek scenariusza 08 w trakcie wykonywania, przycisk „Zatrzymaj”](img/32-scenariusz-w-trakcie.png)

Po kliknięciu **Uruchom** kafelek zmienia wygląd: ma podświetloną ramkę, a zamiast **Uruchom** ma
czerwony przycisk **Zatrzymaj**. Jednocześnie pojawia się powiadomienie „Uruchamiam scenariusz …”.

## Co dzieje się w tym czasie

- Scenariusz wykonuje program na serwerze, krok po kroku. Każda wysyłka, każdy ACK i każdy krok
  pojawiają się na bieżąco na [osi czasu](40-os-czasu.md).
- Przeglądarka czeka na koniec całego scenariusza i dopiero wtedy pokazuje wynik w liście
  [Ostatnie uruchomienia](33-ostatnie-uruchomienia.md) i w [szczegółach](34-wynik-scenariusza.md).
- Scenariusz z krokiem odbioru może trwać długo: czeka na wiadomość od bramki do czasu z pliku
  (np. `06_zlecenie_i_wynik` do 5 minut, `07_odbior_z_bramki` do 2 minut).

## Zatrzymanie

**Zatrzymaj** przerywa scenariusz. Krok czekający na wiadomość albo na upływ czasu kończy się od razu,
seria wysyłek (np. 20 wiadomości w `08_czas_odpowiedzi_20x`) kończy się po wiadomości, która jest
właśnie w drodze, a kolejne kroki są pomijane. Do końca zatrzymania przycisk ma napis **Zatrzymuję...**.
Wynik dostaje status **ZATRZYMANY**, a przerwany krok też jest oznaczony jako zatrzymany.

## Na co uważać

- Zamknięcie albo odświeżenie przeglądarki nie zatrzymuje scenariusza. Po ponownym otwarciu strony
  kafelek nadal ma przycisk **Zatrzymaj**, a wynik pojawi się na liście ostatnich uruchomień.
- Można uruchomić inny scenariusz, zanim skończy się pierwszy. Oba będą wtedy wysyłać jednocześnie,
  co utrudnia czytanie osi czasu i może zawyżyć czasy odpowiedzi. Lepiej uruchamiać je po kolei.

---

[Spis treści](README.md) · Poprzednia: [Kafelek scenariusza](31-kafelek-scenariusza.md) · Następna: [Ostatnie uruchomienia](33-ostatnie-uruchomienia.md) <!-- nav -->
