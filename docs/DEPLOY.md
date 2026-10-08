# Wdrożenie na serwerze

Do krótkiego testu wystarczy skopiować plik i go uruchomić (README, „Uruchomienie”). Ten dokument
opisuje stałą instalację: tester startuje razem z serwerem i działa bez zalogowanego użytkownika,
np. gdy bramka ma wysyłać do niego wiadomości przez kilka dni.

## Lista kontrolna

1. Katalog tylko dla testera, z prawem zapisu dla konta, na którym działa (powstaną w nim `config/`,
   `logs/`, `scenarios/`, `examples/`).
2. Port interfejsu (domyślnie `8080`) otwarty tylko dla komputerów zespołu.
3. Porty listenerów (domyślnie `2575`) otwarte dla adresu bramki.
4. Uzgodnione z klientem, że na serwerze działa narzędzie testowe i że logi zawierają treść wiadomości.
5. Plan usunięcia programu i logów po testach.

## Windows Server

### Instalacja

```bat
mkdir C:\simple-hl7
copy simple-hl7-0.1.0-windows-amd64.exe C:\simple-hl7\simple-hl7.exe
```

Nazwa pliku nie ma znaczenia. Krótsza ułatwia zapis w harmonogramie.

### Firewall

W konsoli administratora. `remoteip` ogranicza dostęp do interfejsu do wskazanych adresów:

```bat
netsh advfirewall firewall add rule name="HL7 tester UI" dir=in action=allow protocol=TCP localport=8080 remoteip=10.0.0.0/24
netsh advfirewall firewall add rule name="HL7 tester MLLP" dir=in action=allow protocol=TCP localport=2575
```

Usunięcie reguł po testach:

```bat
netsh advfirewall firewall delete rule name="HL7 tester UI"
netsh advfirewall firewall delete rule name="HL7 tester MLLP"
```

### Autostart (Harmonogram zadań)

Zadanie uruchamia tester przy starcie systemu na koncie SYSTEM, bez okna konsoli i bez przeglądarki:

```bat
schtasks /create /tn "simple-hl7" /sc onstart /ru SYSTEM /rl HIGHEST /tr "\"C:\simple-hl7\simple-hl7.exe\" --no-browser"
schtasks /run /tn "simple-hl7"
```

Zatrzymanie, ponowne uruchomienie i usunięcie:

```bat
schtasks /end /tn "simple-hl7"
schtasks /run /tn "simple-hl7"
schtasks /delete /tn "simple-hl7" /f
```

Program działa w tle, więc jego komunikaty z konsoli nie są widoczne. Stan sprawdzisz w interfejsie
albo zapytaniem `curl http://localhost:8080/api/health`. Zdarzenia zapisują się w
`C:\simple-hl7\logs\events.ndjson`.

## Linux (systemd)

### Instalacja

```bash
sudo useradd --system --home /opt/simple-hl7 --shell /usr/sbin/nologin hl7t
sudo mkdir -p /opt/simple-hl7
sudo cp simple-hl7-0.1.0-linux-amd64 /opt/simple-hl7/simple-hl7
sudo chmod +x /opt/simple-hl7/simple-hl7
sudo chown -R hl7t:hl7t /opt/simple-hl7
```

### Usługa

`/etc/systemd/system/simple-hl7.service`:

```ini
[Unit]
Description=HL7 gateway tester
After=network-online.target
Wants=network-online.target

[Service]
User=hl7t
Group=hl7t
WorkingDirectory=/opt/simple-hl7
ExecStart=/opt/simple-hl7/simple-hl7 --no-browser
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now simple-hl7
sudo systemctl status simple-hl7
journalctl -u simple-hl7 -f
```

Port poniżej 1024 wymaga dodatkowego uprawnienia. Wybierz port 1024 lub wyższy, np. `2575`.

### Firewall

```bash
# ufw (Ubuntu, Debian)
sudo ufw allow from 10.0.0.0/24 to any port 8080 proto tcp
sudo ufw allow 2575/tcp

# firewalld (RHEL, Rocky, Alma)
sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="10.0.0.0/24" port port="8080" protocol="tcp" accept'
sudo firewall-cmd --permanent --add-port=2575/tcp
sudo firewall-cmd --reload
```

## Za reverse proxy

Interfejs korzysta z WebSocket pod `/ws`, więc proxy musi przepuszczać upgrade połączenia. Tester
słucha wtedy tylko lokalnie (`--listen 127.0.0.1:8080`), a proxy dodaje logowanie i TLS. Nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_read_timeout 3600s;
    auth_basic "HL7 tester";
    auth_basic_user_file /etc/nginx/simple-hl7.htpasswd;
}
```

Długi `proxy_read_timeout` jest potrzebny, bo uruchomienie scenariusza przez REST czeka na koniec
przebiegu, a scenariusz z odbiorem może czekać kilka minut.

## Aktualizacja i sprzątanie

- **Aktualizacja:** zatrzymaj program, podmień plik wykonywalny, uruchom ponownie. Konfiguracja,
  scenariusze i przykłady w katalogu zostają bez zmian. Nowe przykładowe scenariusze z nowej wersji
  pojawią się tylko wtedy, gdy usuniesz katalog `scenarios/` (najpierw skopiuj własne pliki).
- **Po testach:** zatrzymaj i usuń zadanie lub usługę, usuń reguły firewalla, usuń katalog programu
  razem z `logs/` (zawiera dane pacjentów).
