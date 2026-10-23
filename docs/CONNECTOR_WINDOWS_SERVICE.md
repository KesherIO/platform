# Analyzer connector — Windows service, mapping script and production rollout

Plan written 2026-10-22. Companion to `docs/INSTRUMENT_CONNECTOR.md` (API side) and `apps/connector/README.md`
(receiver). The receiver's behaviour is **unchanged** by this work, and so are the dev test files
(`apps/connector/windows/*.bat`, the dev bundle/ZIP). No secrets in this file.

## Status at a glance

| Piece | Where | State |
| --- | --- | --- |
| Windows service package | `apps/connector/windows-service/` | written; **never run on Windows** (see §1 "Needs a Windows PC/VM") |
| Production-safe mapping script | `apps/api/prisma/seeds/instrument-mappings.mjs` (+ `.lib.mjs`, `.test.mjs`) | written; unit-tested; dry-run/apply exercised against **dev** only |
| Production migrations / rollout | §3–§4 | not started — manual, by the owner |

## 1. Windows service

**Package** (`windows-service/build-package.sh`, builds on macOS/Linux): pinned official Node 22 LTS `node.exe`
(v22.23.4, SHA-256 checked against the pin *and* nodejs.org's `SHASUMS256.txt`) + the unchanged
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
  reported as "computed by the template" — the processor records the analyzer's figure but never writes it. *(The original
  plan said "non-formula fields"; the dev mapping set deliberately includes those three, so they are allowed, not rejected.)*
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
