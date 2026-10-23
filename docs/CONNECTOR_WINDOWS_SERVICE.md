# Analyzer connector — Windows service, mapping script and production rollout

Plan written 2026-10-22. Companion to `docs/INSTRUMENT_CONNECTOR.md` (API side) and `apps/connector/README.md`
(receiver). The receiver's behaviour is **unchanged** by this work, and so are the dev test files
(`apps/connector/windows/*.bat`, the dev bundle/ZIP). No secrets in this file.

## Status at a glance

| Piece                           | Where                                                                       | State                                                              |
| ------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Windows service package         | `apps/connector/windows-service/`                                           | installed and used at the Biomet lab (Dev); new installer flow not yet run on Windows (see §1a) |
| Production-safe mapping script  | `apps/api/prisma/seeds/instrument-mappings.mjs` (+ `.lib.mjs`, `.test.mjs`) | written; unit-tested; dry-run/apply exercised against **dev** only |
| Production migrations / rollout | §3–§4                                                                       | not started — manual, by the owner                                 |

## 1. Windows service

**Package** (`windows-service/build-package.sh`, builds on macOS/Linux): pinned official Node 22 LTS `node.exe`
(v22.23.4, SHA-256 checked against the pin _and_ nodejs.org's `SHASUMS256.txt`) + the unchanged
`vh30-receiver.cjs` + WinSW 2.12.0 (MIT; SHA-256 pinned at first fetch, upstream publishes none) +
`KesherIOConnector.xml.template` + `install.ps1` / `uninstall.ps1` / `status.bat`. The script refuses to
package anything token-, password-, JWT-, `connector.json`- or capture-shaped.

**Layout**

- Program: `C:\Program Files\KesherIO\Connector\` (`app\` shared node + receiver, `services\<name>\` wrapper + XML).
- Data, one folder per analyzer: `C:\ProgramData\KesherIO\Connector\<name>\` — messages, `connector.json`, `status.json`,
  `logs\`. Kept across upgrade **and** uninstall (uninstall has no delete option, on purpose).
- ACL on the data folder (set by SID, before any file is written): SYSTEM + Administrators full, `LocalService` modify,
  inheritance removed. `connector.json` is therefore readable only by those.

**`install.ps1`** (elevated, once per analyzer; re-run = upgrade that keeps settings and token unless `-Reconfigure`)

- **The token never appears in argv, a parameter, a log or the service XML.** It is read from a hidden prompt
  (`Read-Host -AsSecureString`) or, for unattended installs, from the `KESHERIO_CONNECTOR_TOKEN` environment variable
  (removed immediately), validated against the receiver's own pattern, and written straight to `connector.json`
  by PowerShell. We do **not** use `vh30-receiver --configure --token …` (what `configure-upload.bat` does; that file
  is left as is) — and `--configure` ignores the env var anyway. The self-check sends the token as an HTTPS
  `Authorization` header from inside the script, never on a command line.
- Prompts for API URL (`https://` only), listen IP / port / analyzer IP (defaults 192.168.5.13 / 8001 / 192.168.5.14);
  checks the listen IP is assigned to this PC and the port is free.
- Firewall: inbound TCP `<port>` **only from the analyzer IP**.
- Service `KesherIO Connector – <analyzer> (<name>)`: automatic (delayed) start at boot, restart after failure
  (10 s / 30 s / 60 s), `NT AUTHORITY\LocalService`, rolling logs (5 MB × 8) in the data folder, ACK `off`.
- Optional `powercfg` sleep/hibernate off (asked; `-DisableSleep` to force).
- Self-check: service running, port listening, `GET /api/instrument-ingest/ping` with the token → shows analyzer and
  credential name; 401/403 reported as "token refused". Exit code 2 if any check needs attention.
- **One service per analyzer** (own name, port, folder, token) → chemistry is a second `install.ps1 -Name chem …`.

**Needs a Windows PC/VM (nothing below has been run)**

1. `install.ps1` end to end, including PowerShell 5.1 syntax/behaviour (it was written on macOS and only read, not parsed).
2. Reboot → service up **before anyone logs in**; analyzer connects.
3. Kill `node.exe` → restarts in ~10 s.
4. Stop the service → WinSW sends Ctrl+C, receiver shuts down gracefully (else killed after 15 s; the store is durable either way).
5. Unplug internet → results queue; plug in → upload, in order, no duplicates.
6. Revoked token → status shows "credential refused"; `-Reconfigure` with a new token fixes it.
7. Upgrade (re-run with a newer package) keeps `data\`, token and settings; uninstall keeps `data\`.
8. Confirm `LocalService` is enough (read the program files, write the data folder, outbound HTTPS). Fallback: a dedicated
   virtual/local account via the XML `<serviceaccount>`.
9. Delayed auto-start vs the USB Ethernet adapter coming up late (`EADDRNOTAVAIL` → restart policy should cover it).
10. Firewall rule on a network profile of "Public".

Use `vh30-replay.cjs` (shipped in `app\`) to simulate the analyzer.

First Windows run (2026-10-22): the install failed with "unfilled placeholder" because the template's own header comment
contained a literal double-brace marker. Fixed; the same review also found WinSW 2.x does not know `<username>` (the
service would have run as LocalSystem) - now `<domain>/<user>`, and the installer verifies the registered account. A retry
after a partial install keeps a valid saved `connector.json` (no token rotation); `-ApiUrl` on a retry changes only the
address. Static/render tests: `node --test apps/connector/windows-service/install-template.test.mjs`.

### 1a. Installing, updating and checking (2026-10-23)

Unzip the whole package, then **double-click `install.bat`** (it asks Windows for administrator rights and runs
`install.ps1`). The prompts validate each answer and ask again instead of failing: analyzer name, this PC's IP, port,
the analyzer's IP (the only address the firewall admits - `0.0.0.0`, broadcast and multicast are refused), the API
address (`https://`, no credentials, no trailing `/api`) and the token (hidden). `install.ps1` first verifies every file
against `SHA256SUMS.txt` and prints the package fingerprint (also printed by `build-package.sh`): **compare the two**.

| Need                                                     | Do                                                                                                                                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Change only the API address (e.g. an expired dev tunnel) | `update-config.bat` - keeps the token, queued messages, logs and service; rewrites `connector.json` atomically as UTF-8 **without a BOM**; restarts the service; checks the new address |
| Replace the token                                        | `update-config.ps1 -ReplaceToken` (hidden prompt). The new token is checked against the API first; if the API refuses it, it is **not** saved and the old one stays                     |
| Upgrade the program files                                | run `install.bat` from the new package: settings, token, queue and logs are kept                                                                                                        |
| See state                                                | `status.bat`                                                                                                                                                                            |
| Remove                                                   | `uninstall.ps1 -Name <name>`: the data folder (queue, config, logs) is never deleted                                                                                                    |

An API address that is wrong, expired or offline does **not** abort the installation: the installer says why in plain words
(DNS failure / expired `trycloudflare.com` tunnel / nothing behind the address / not the KesherIO API / certificate / timeout),
carries on, and results are stored locally until `update-config.bat` fixes the address. If the service does not start, the
installer prints the service state, the tail of the newest logs, recent Windows service events and a likely cause
(adapter not plugged in, port in use, access denied, unreadable `connector.json`, missing file).

**Security review (installer)**

- _Elevation:_ the wrapper elevates only itself (`Start-Process -Verb RunAs`), takes no arguments, and passes its own path in
  an environment variable - never pasted into a command line - so odd folder names cannot change what runs. Residual risk:
  a package unzipped into a folder a non-admin can write to could be swapped between the UAC prompt and the run; the
  checksum check is done by the same scripts, so it guards against damage and casual tampering, not a local attacker.
  Unzip as an administrator into an admin-only folder and compare the fingerprint with the one you were sent.
- _Command injection:_ every value is checked against an allow-list before use (`-Name` `^[a-z0-9][a-z0-9-]{0,30}$` -
  also blocks path traversal; analyzer name letters/digits/space/`.()+_-`; IPv4 only; port 1-65535; URL parsed, `https`,
  no user-info/query/fragment). Values reach the service definition only through XML escaping, and native programs
  (`icacls`, `powercfg`, `sc.exe`, WinSW) are called with separate arguments - no `Invoke-Expression`, no `cmd /c`.
  A test fails the build if any of those appear.
- _Token:_ never a parameter, argument, log line or part of the service definition. Hidden prompt, or an environment
  variable that is removed right after it is read; held in memory only while it is written. It is sent only over HTTPS,
  and only to an address that has first answered the public health check. Residual risk: while an unattended install runs,
  the variable is visible to the launching process.
- _Files:_ the data folder has inheritance removed and only SYSTEM, Administrators and the service account (`LocalService`,
  chosen by SID so it works in any language) - set before the first file is written; the config file is written to a temp
  file in the same folder and renamed. Program files live under `%ProgramFiles%` (not writable by the service account).
- _Firewall:_ one inbound TCP rule, remote address = the analyzer IP, then read back and verified.
- _Found and fixed while testing:_ PowerShell's `-match` ignores case, so `VH30` passed as a service name and an
  upper-case token was accepted; both now use `-cmatch`.

**Tests**

- `node --test apps/connector/windows-service/installer.test.mjs` (17 tests) - wrapper (elevation, CRLF, no argument or
  path interpolation), security properties above, validation-before-change, firewall, no data deletion, package contents;
  and, when PowerShell is available, that every script parses, `run-tests.ps1` passes, and the config written or repaired
  by the installer is BOM-free JSON that **Node** parses.
- `powershell -File apps/connector/windows-service/run-tests.ps1` (106 checks) - validators, URL handling, config
  write/update/BOM repair, error messages, package integrity. Runs on Windows PowerShell 5.1 and PowerShell 7.
- `node --test apps/connector/windows-service/install-template.test.mjs` (8) - service XML rendering.
- Run on macOS with PowerShell 7.6.8; the network helpers were also exercised against the live dev API (healthy address,
  expired tunnel, wrong site, valid and wrong token).

**Real-world results (Biomet laboratory, reported 2026-10-23, Dev environment)** - Windows service installed and running; the
VH-30 connected over TCP; HL7 received and uploaded; offline storage and automatic upload after the connection returned;
automatic order matching; result import as draft (including orders with no tube records, see `INSTRUMENT_CONNECTOR.md`).
**Still pending on Windows:** reboot before login (the lab PC was busy with chemistry controls), and the new installer
flow itself (`install.bat`, `update-config.bat`, startup diagnostics, firewall verification, upgrade/uninstall keeping data)

- written and tested off-Windows only.

## 2. Production-safe mapping script

Dev rows came from `seed-instrument-dev.mjs`, which also creates a test order — **never run that on production**.
Use `instrument-mappings.mjs` instead; it only ever touches `instrument_parameter_mappings` (and the analyzer row with
`--create-analyzer`). No orders, patients, links or credentials.

```bash
# dry run (default) — read-only
DATABASE_URL=… node apps/api/prisma/seeds/instrument-mappings.mjs \
  --lab <lab id|slug> --analyzer "<analyzer name>" --profile vh30-cbc
# write
… --apply --confirm-host <the DB host it printed>   [--overwrite]   [--create-analyzer]
```

- **Dry-run by default**; `--apply` also needs `--confirm-host` equal to the database host (printed on every run).
- **Idempotent**: second apply writes 0 rows. **No overwrite** of a row that already maps differently unless `--overwrite`
  (differing rows are listed, left alone, and the exit code is 2).
- **Validated against the lab's active CBC template(s)** (lab template shadows platform for the same species/age band):
  every analyte code must exist, not be a header row, and be `NUMERIC`. Template formulas (MCV/MCH/MCHC) are allowed and
  reported as "computed by the template" — the processor records the analyzer's figure but never writes it. _(The original
  plan said "non-formula fields"; the dev mapping set deliberately includes those three, so they are allowed, not rejected.)_
- Profile `vh30-cbc` = the 11 dev rows: WBC RBC HGB HCT MCV MCH MCHC PLT MPV, plus HGB and MCHC in g/L ×0.1. The
  differential (Lym/Mid/Gran) is deliberately **not** mapped (smear count entered by hand). Other analyzers:
  `--mappings-file rows.json --catalog-code …`.
- Tests: `node --test apps/api/prisma/seeds/instrument-mappings.test.mjs`.

Validated against **dev** only: dry-run on the dev lab (7 applicable CBC definitions → 11 unchanged), missing analyzer,
`--create-analyzer` dry-run, bad analyte code, differing row (exit 2), `--apply` refused without `--confirm-host`, and an
`--apply` that wrote 0 rows. **The production dry-run is run by the owner.**

## 3. Blockers for production

1. **Production DB migrations are applied manually at the "final prod merge".** The backlog goes back to 2026-10-08 and
   includes `20261016000001_lab_roles_consolidation` (**data change**: moves TECHNICIAN/DATA_ENTRY lab members to ANALYST) and
   a one-time backfill, `node apps/api/prisma/seeds/backfill-clinic-report-pdfs.mjs`, after `20261016000004`; plus the
   instrument migrations `20261021000001`, `20261021000002`, `20261022000001`. Build the list from the repo and have the
   owner verify with `prisma migrate status` — **never from an agent session, and never connect to production from one.**
2. **No UI for parameter mappings** → §2 script, dry-run then apply by the owner after the analyzer exists.

## 4. Production rollout order

1. Matching PR (#83) — merged to `main`.
2. Prod merge: snapshot → `migrate status` (expect exactly the batch) → `migrate deploy` → backfill → deploy code.
3. Prod portal (pilot lab Owner): create the analyzer → mapping script (dry run, then apply) → create the connector token
   (shown once).
4. Lab PC: `install.ps1` with the production **https** API URL (no tunnel/proxy), analyzer ACK off; one real sample with
   matching **off**, link by hand.
5. Enable `autoMatchOrders` only if the device checks passed. If the analyzer **auto-increments** the sample number, do not
   enable it in production: disable auto-increment on the device or add a check digit.
6. Watch the first day.

## 5. Chemistry next

Reusable: matching, review rules, credentials, this Windows service, the mapping script (`--mappings-file`).
Device-specific: transport (HL7/TCP vs ASTM vs serial), parser, parameter codes. Needed: model + LIS protocol document,
ideally a raw capture.

## Appendix — the VH-30 dev test (independent of this work)

Remains the priority: order with Hemograma → accept EDTA tube → note the analyzer number → enable automatic matching for the
dev analyzer → device checks (8 digits in PID-3? auto-increment? empty field? clock) → draft import → rerun → wrong number.
It uses the existing `.bat` setup and the dev bundle, which this branch does not touch.
