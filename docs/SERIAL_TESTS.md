# Serial tests (e.g. "Coprológico seriado")

A package whose samples arrive on different days, each with its own result and
release. There is no "quantity" on a package component, so each sample is its
own test.

## Setup (once, by an Owner/Admin)

1. **Catalog → three tests**: "Coprológico – muestra 1 (día 1)", "– muestra 2
   (día 3)", "– muestra 3 (día 5)". Tick **Only part of packages** on each, so
   clinics never see or order them alone (the lab still sees them).
2. **Settings → Test Config**, for each test: sample type `FECES` and a
   **different container label per test** (`FRASCO_COPRO_1`, `FRASCO_COPRO_2`,
   `FRASCO_COPRO_3`). The lab groups tests by sample type + container: if the
   three share a container, receiving the first sample readies all three.
3. **Templates**: publish a result template under each test's own code (copy
   the existing coprológico template three times).
4. **Catalog → package** "Coprológico seriado" with those three tests as
   components. Put the package's billing code (e.g. `COPS`) on the package; the
   components are not billed separately.

## Running an order

- **Day 1 — Accession samples.** For each sample choose **Accept**, **Reject**
  or **Not received yet**. Accept copro 1; mark copro 2 and 3 **Not received
  yet**. Nothing is rejected, the clinic is not notified, and copro 2 and 3
  stay pending. At least one sample must be received.
- **Day 3 / 5 — the order's Samples panel → Receive** on the awaited sample.
  Only that sample's test becomes ready. The clinic is not notified.
- **Release** each test when its result is done (partial release). The vet app
  accumulates the released results.
- The order stays open until the last test is released.

## Notes

- A sample already received cannot be turned back into "Not received yet".
- Re-opening the accession dialog while a sample is still awaited shows it as
  "Not received yet"; accepting it there receives it too.
- The "Only part of packages" flag applies to tests, not packages. It hides the
  test from the clinic's catalog list, from the AI triage suggestions and from
  selecting it by id; packages still carry it as a component. It is not part of
  the catalog file import (set it in the catalog form).
