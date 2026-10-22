# VH-30 connector (`apps/connector`)

Runs on the lab's Windows computer next to the Genrui/Genvet VH-30. It **receives** every
result over TCP, **saves the exact bytes locally first**, and **uploads** them to the KesherIO
API whenever the internet is available. Needs only Node 18+ (no `npm install`).

```
VH-30 ──TCP 8001──▶ receiver ──▶ data\inbox\…frame     exact bytes, fsync'ed, read back
                        │         data\incomplete\…bin  interrupted transfers (never results)
                        └──▶ (ACK, optional) ──▶ VH-30
                    uploader ──HTTPS──▶ API  (revocable per-analyzer token, retries, dedupe)
```

Capture never depends on the network. Backend design: `docs/INSTRUMENT_CONNECTOR.md`.

## Wire protocol (verified on `docs/VH30-test.hl7`)

```
[uint32 big-endian L] [0x0B] [HL7 2.3.1 ORU^R01 ...] [0x1C] [0x0D]
```

`L` = bytes after the prefix (0x0B … 0x0D); frames are back to back. Sample ID = PID-3 (the
analyzer's own counter, **not** an order number). Segments end with CR only (a value may contain
LF). Histograms are OBX `ED` segments whose "Base64" is further hex-encoded ASCII. A resend keeps
MSH-10 and changes MSH-7. OBX-13 (per the vendor VH-30 LIS protocol PDF, kept outside this public repo): `E`/`e` =
edited on the analyzer, `O` = expired reagent.

## Guarantees

- **Exact bytes.** `*.frame` is the frame as received, prefix included. Its sidecar `*.json` has
  size, sha-256, remote address, parsed sample / control IDs.
- **Durable before anything else happens.** A message counts as saved (and may be ACKed) only after
  it is written, fsync'ed, renamed, **read back from disk and compared**, and the folder fsync'ed
  (Windows can't fsync a folder; NTFS journals the rename). If any step fails nothing is left
  behind, no ACK is sent, and the error is shown.
- **Interrupted transfers are never results.** A connection cut mid-frame, or bytes that don't form
  a valid frame, go to `data\incomplete\` with a `complete:false` sidecar, are counted and shown as
  **INCOMPLETE** in the console and `status.json`, are uploaded flagged incomplete, and the API
  refuses to import them whatever happens.
- **Upload survives everything.** State is on disk next to each file (`*.uploaded.json` /
  `*.rejected.json`); a restart, crash or reboot resumes where it stopped. Offline → exponential
  backoff (2 s … 5 min). A refused credential (401/403) pauses visibly and re-checks every 5 min.
  Only repeated 400/413/422 for the *same* file reject it for good (kept locally); 404/5xx/network
  never reject. **One bad file never blocks the queue:** when the server is healthy (a `/ping` check)
  but a particular file keeps failing, that file backs off on its own and the files behind it upload;
  the console shows `N FILE(S) FAILING on their own`. When the server itself is down, everything waits. Sending a file twice is harmless: the server keys on sha-256 of the bytes.

## Set up the Windows folder

On the dev machine:

    npx nx run @vet-ai/connector:bundle      # or: cd apps/connector && node scripts/bundle.mjs

Copy `apps/connector/dist/` to the lab PC.

1. `start-receiver.bat` — edit the settings at the top (this PC's analyzer-facing IP, port, the
   analyzer's IP, `VH30_ACK`). Messages are saved with or without internet.
2. `configure-upload.bat` — paste the API address and the **connector token** (an admin creates it
   in the lab portal → *Analyzer results → Connectors*; it is shown once). Saved to
   `data\connector.json`, not in the .bat. Until then the connector runs capture-only and uploads
   later. Environment overrides: `VH30_API_URL`, `VH30_API_TOKEN`.

The console shows connection state, last sample ID, saved / INCOMPLETE / ACK counts, upload state
(`up to date`, `OFFLINE – retrying`, `CREDENTIAL REFUSED`) and errors; `data\status.json` mirrors it.

## ACK (`VH30_ACK` / `--ack off|length-mllp|mllp`, default **off**)

Per the PDF (§2.3.1, §3.6) the LIS answers each `ORU^R01` with an `ACK^R01`: an MSH plus
`MSA|AA|<ORU control ID>||||`. With *ACK Synchronous Transmission* on, the analyzer waits (timeout
configurable on the device, manual p.78) and resends the ORU if no ACK arrives. The receiver ACKs
only after the durability check above; if saving fails it sends nothing, so the analyzer's own retry
covers it. Duplicates (same control ID) are saved and ACKed again.

**The PDF does not say how the ACK is framed.** Two modes are implemented and unit-tested but **not
confirmed on hardware**: `length-mllp` (mirror the analyzer: `<u32 BE L><0B>…<1C><0D>`) and plain
`mllp`. Do not rely on ACK until the checklist below (Phase C) has passed.

## Develop without the device

    node dist/vh30-receiver.cjs --host 127.0.0.1 --port 8001 --data-dir ./data [--ack length-mllp]
    node dist/vh30-replay.cjs docs/VH30-test.hl7 --random-chunks --new-connection
    node dist/vh30-replay.cjs docs/VH30-test.hl7 --expect-ack      # behave like an analyzer waiting for ACKs

Replay options: `--chunk`, `--random-chunks`, `--chunk-delay-ms`, `--new-connection`, `--repeat`,
`--frames`, `--cut-mid-frame`, `--expect-ack`, `--ack-timeout-ms`, `--max-resends`.
Tests: `npx vitest run --root apps/connector`. Against the real API + database:
`apps/api/src/instruments/instruments.e2e.int.spec.ts` (see its header).

---

# Hardware checklist

Analyzer 192.168.5.14 → PC 192.168.5.13:8001. **Use only test records for everything below — never a
real patient's sample for edit, resend, cable-pull or ACK experiments.** Write results on paper as you go.

### Prepare a dedicated test record
Run one blood sample (a control or a spare tube) and give it a clearly fake identity: **sample ID
`9001`, name `ZZ-TEST-EDIT`**. This is the *only* record used for edit and resend tests. In the dev
environment, link it to the development order:
`node apps/api/prisma/seeds/seed-instrument-dev.mjs --lab <lab> --clinic <clinic> --sample-id 9001`.

## Phase A — capture only (no internet needed, ACK unchecked on the analyzer)

1. PC adapter is 192.168.5.13/24; start `start-receiver.bat`; allow it through Windows Firewall (private network).
2. Console shows `Listening on 192.168.5.13:8001`; the analyzer's Comm button turns enabled; console shows `Analyzer connected`.
3. Select `9001` and click Comm: console shows sample `9001`; `data\inbox` has a `.frame` + `.json`; size ≈ 680 KB; matches the analyzer screen.
4. Select 3 test records, Comm: all saved, `INCOMPLETE` stays 0.
5. Resend `9001`: second file, **same control ID, different MSH-7**.
6. Tick *Comunicación automática*, run a new test sample: saved with no button press.
7. Unplug the cable ~10 s, replug: disconnect then reconnect shown; manual resend works.
8. Close and reopen the receiver: counts are restored; note whether the analyzer reconnects by itself.
9. **Interrupted transfer:** select ~20 test records, Comm, and pull the cable mid-send. Expect console `INCOMPLETE transfer kept`, the `INCOMPLETE` counter up, and a file in `data\incomplete\`. Replug and resend. The incomplete item must never become a result.
10. **Edit test (on `9001` only):** edit one value on the analyzer, save, resend. Record: does MSH-10 change? OBR-7? the `OBX-13` flag on the edited value (`E`/`e`)? Save the `.frame` files as a dated capture.
11. Switch the histogram mode to *Not transmitted* and *Data* (manual p.78); send `9001` each time and keep one capture of each.
12. Turn the PC's Wi-Fi/internet off: steps 3–5 still work.

## Phase B — upload (needs the token from the lab admin)

13. Run `configure-upload.bat`; restart. Console shows `Uploading to …`; the upload line shows `as <analyzer> (<connector name>)`.
14. Send `9001`: `Uploaded message -> …`; in the portal it appears under *Analyzer results* (**No linked order** unless pre-linked), or imports as a **draft** into the linked dev order. Nothing is released.
15. Resend `9001`: portal shows it as a duplicate (nothing new queued).
16. Edit-and-resend `9001` (step 10): portal shows **The result changed** with the before/after values; the draft is untouched until a reviewer approves. If the analyzer marked the edit, **Edited on analyzer** is shown; it is separate from **Expired reagent**.
17. Go offline (Wi-Fi off), run/send two test records: console `OFFLINE – retrying`, files saved, `pending` grows. Reconnect: they upload in order without duplicates.
18. Restart the receiver while offline with pending files: after reconnecting it still uploads them.
19. Interrupted-transfer item from step 9 appears in the portal under *Interrupted transfers*, marked incomplete, with no import action.
20. Admin revokes the token: within one upload attempt the console shows `CREDENTIAL REFUSED`, new results keep being saved locally. A new token + `configure-upload.bat` resumes the backlog.

## Phase C — ACK (only after A and B pass). One variable at a time.

On the analyzer tick *ACK Synchronous Transmission* and note the *ACK Timeout* (screenshot it). Always use test record `9001`, and restart the receiver between runs so each starts clean.

21. **Baseline 1 — no ACK ever.** Receiver `VH30_ACK=off`. Send `9001` once. For ~2 minutes record: does the analyzer retransmit? how many times, how long between tries, does it stop? (Count the new `.frame` files and their times; they share one control ID.) This is what "the analyzer got no ACK" looks like.
22. **Test `length-mllp`.** Set `VH30_ACK=length-mllp`, restart, send `9001` once. Console should show `ACK sent for control …`. Compare with Baseline 1:
    - **no retransmission** → this framing is accepted;
    - retransmits like the baseline, or an ACK/communication error appears on the analyzer → rejected.
23. **Baseline 2 — repeat step 21** (`VH30_ACK=off`, same record). It must match Baseline 1. If it doesn't, the device's behaviour drifted (e.g. after a rejected attempt) and step 22's conclusion is unreliable — repeat both.
24. **Test `mllp`.** Set `VH30_ACK=mllp`, restart, send `9001`; compare with Baseline 2 exactly as in step 22.
25. If neither framing is accepted: untick ACK on the analyzer, keep `VH30_ACK=off`, and send me the `.frame` files plus a Wireshark capture (`tcp.port==8001`) covering one attempt.
26. **Durable-before-ACK check** (with the accepted framing): make the inbox unwritable, e.g. in a Command Prompt `icacls "data\inbox" /deny "%USERNAME%:(OI)(CI)(WD,AD)" /T` (a folder's read-only *attribute* does not block new files on Windows; this ACL does — I could not try this exact syntax on Windows, any way of making the folder unwritable works). Send `9001`. Expect `ERROR: Could not save message`, **no `ACK sent`**, and the analyzer retrying as in Baseline 1. Undo with `icacls "data\inbox" /remove:d "%USERNAME%" /T`; the next retry is saved and ACKed.
27. With ACK working: pull the cable right after Comm. Nothing may be lost or silently duplicated (resends are extra files sharing one control ID; the API treats them as duplicates).
