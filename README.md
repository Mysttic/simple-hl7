# simple-hl7

**An HL7 gateway tester that is one file.** Receive and send HL7 v2 over MLLP, check every frame
byte by byte and see each connection, message and ACK with millisecond timestamps and the
gateway's response times. Made for testing integration gateways at a hospital, on the hospital's
own server.

Copy one file to the server, run it, open the browser. That is the whole setup.

**[Download the latest release](https://github.com/Mysttic/simple-hl7/releases/latest)** for Windows
or Linux x64. Free and open source under the MIT licence. The interface and the documentation are in
Polish.

![simple-hl7 in its simple view: the listener and the client on the left, the live timeline in the middle and a colour-coded ADT^A01 message on the right](docs/img/glowny.png)

## Up and running in three steps

1. **Download** one file for Windows or Linux. No installer, no runtime, no Docker.
2. **Run** it on the server next to the gateway and open its address in a browser, from any
   computer: `http://<server>:7575`.
3. **Test**: send to the gateway or let it send to you, and watch every message and ACK as it
   happens.

On first start the program writes its configuration, ready scenarios and example messages next to
itself. It runs on Windows 10 and 11, Windows Server and Linux x64 with glibc 2.28 or newer (RHEL,
Rocky and Alma 8+, Ubuntu 20.04+, Debian 10+). The files are not signed with a certificate, so
Windows SmartScreen asks once: choose "More info", then "Run anyway".

## Simple to start, detailed when you dig

A switch in the top bar decides how much the screen shows. Start with the essentials and open the
full view when you need every byte and every millisecond.

| View | Shows |
|---|---|
| **Simple** (Prosty) | sending, receiving and reading the message |
| **Standard** (Standardowy) | adds the frame, filters, export and scenarios |
| **Full** (Pełny) | every timing, column and tool |
| **Custom** (Własny) | exactly the parts you pick |

![simple-hl7 in its full view: listener statistics, the whole client form, every timeline column and the frame checks in the inspector](docs/img/glowny-pelny.png)

## What it does

- **Server and client in one.** Listeners wait for the gateway on as many ports as you need and
  answer with AA, AE, AR, no ACK at all or an ACK from your own template. The client connects to
  the gateway and sends, so both directions are tested in one loop.
- **Every frame checked.** Prefix and suffix against what you expect, CR or LF between segments, the
  CR before the suffix and stray control bytes, with a plain hint when the gateway gets the frame
  wrong.
- **Response times you can quote.** Every event on a millisecond timeline, the gateway's answer split
  into connect, send, first byte and ACK, and minimum, average, maximum and p95 for a series.
- **Messages you can read.** Colour-coded segments, a tree with HL7 2.5 field names, a hex view with
  the frame bytes marked, and the encoding checked against MSH-18: UTF-8, CP1250, ISO-8859-2 and more.
- **Ready scenarios.** Nine repeatable YAML tests, from "does the gateway answer at all" to an order
  sent out and its result coming back.
- **Evidence for the report.** Export the timeline to CSV or NDJSON. The full history also goes to a
  log file next to the program.

| A wrong suffix, caught and explained | The gateway's answer and where the time went | Ready scenarios, pointed at the gateway |
|---|---|---|
| ![The inspector showing a frame that ended with 0D 0A instead of 1C 0D](docs/img/zly-sufiks.png) | ![The result of a send: ACK AA, matching control id and a timing bar](docs/img/klient-wynik.png) | ![The scenarios panel with the gateway address and the list of ready scenarios](docs/img/scenariusze.png) |

## Your data stays with you

- **Nothing leaves the server.** No telemetry, no account, no update check. Messages stay in the
  program's own log and exports; delete the folder when the tests are over.
- **Keep it off the internet.** The interface has no password. Limit its port on the firewall, or
  start the program with `--listen 127.0.0.1:7575` and reach it through SSH.
- **Files you can verify.** Every release comes with the SHA-256 of both files.

## Documentation

In Polish:

- [Guide](docs/PRZEWODNIK.md): running the program, a first test step by step, the server, the
  client, scenarios, the timeline and troubleshooting
- [Manual](docs/instrukcja/README.md): every panel, form and dialog with a screenshot
- [Scenarios](docs/SCENARIOS.md): the YAML format and every assertion
- [Deployment](docs/DEPLOY.md): autostart on Windows, a systemd service, the firewall
- [Architecture](docs/ARCHITEKTURA.md) and [development](docs/ROZWOJ.md): building, tests and releases
- [Changelog](CHANGELOG.md)

## Licence

MIT, see [LICENSE](LICENSE).
