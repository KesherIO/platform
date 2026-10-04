# PDF Result Reports — Implementation Specification

## Goal

Generate a downloadable PDF for every partial, final, and amended result release. The NestJS API generates the PDF from that release's immutable snapshot. The React lab app and Angular clinic app download the same stored artifact.

## Release semantics

- Each release has its own PDF containing only the tests in that release snapshot.
- A FINAL release PDF may contain only the last newly released tests. Label it “Final release,” never “Complete order report.”
- An amendment has its own PDF and identifies the earlier release or tests it corrects.
- Both apps show release history so users can find earlier partial reports and later amendments.
- Do not render unreleased tests or read mutable result records when generating a PDF.

## Image assets

The current snapshot stores URLs for logos and signatures. A URL does not preserve the image bytes.

Before committing a release, resolve each image needed for its PDF and save its bytes in private, release-specific storage objects. Record their immutable object paths with the release, using a schema migration or an existing suitable model verified in the repo. The PDF processor reads only those release-specific objects.

Define the policy for an image that cannot be resolved at release time: a missing optional logo may be omitted; an expected signer signature must produce a visible error or block the release according to the existing signing rules. Do not silently omit an expected signature. Do not fetch current Tenant or LabSigner images during background generation.

Avoid remote URL fetching unless the URL is validated against the application's own storage locations. Use the existing storage client where possible.

## Artifact lifecycle

The release transaction creates one `ResultReportReleaseArtifact` with status `PENDING`. This must happen for ordinary releases and approved amendments. The server-side processor starts automatically and is part of the initial implementation. Frontend polling only reads status; it does not trigger work.

The processor:

1. Atomically claims a bounded number of `PENDING` artifacts using a conditional update or database locking. Concurrent API instances must not claim the same artifact.
2. Loads the release, its test and analyte snapshots, and its release-specific image assets.
3. Generates the PDF and uploads it to a deterministic private path, such as `{labTenantId}/{orderId}/{releaseId}.pdf`, with overwrite disabled.
4. Confirms that the stored object exists and is a valid PDF before setting the artifact to `COMPLETED`.
5. Records failures, retries with a bounded delay, and recovers jobs abandoned after a worker crash.

If an upload succeeds but the worker crashes before updating the database, recovery verifies and reuses that existing object. Do not treat any “already exists” error alone as proof of a valid PDF.

Prevent a timed-out worker from marking an artifact complete after another worker has reclaimed it. Use a claim token, lease, or equivalent conditional state transition. Keep the stored object path in `storageUrl`; never persist an expiring signed URL there.

The release remains valid if PDF generation fails. The artifact shows `FAILED`, and an authorized lab admin can retry it.

## PDF content

Use the fields actually present in `ResultReportRelease`, `ResultReportReleaseTest`, and `ResultReportReleaseAnalyte`. Include available lab and clinic details, patient and ordering vet details, requisition number, release type and time, specimens, department headings, test names, analyte results, units, frozen reference ranges and flags, observations, signer details, and disclaimer.

Handle absent optional fields without inventing values. Support long names, multiline text results, multiple pages, repeated table headers, page numbers, Unicode characters, and signatures. Use the reference range and flag saved in the analyte snapshot; do not recalculate them from today's templates.

Generate an A4 sample for partial, final, amended, sparse, and long multi-page releases. Review the rendered pages visually.

## API

Keep JSON status routes separate from binary download routes. Both apps use authenticated API clients with bearer tokens and tenant headers.

Lab:

- `GET /lab/releases/:releaseId/artifacts/pdf` — artifact status.
- `GET /lab/releases/:releaseId/artifacts/pdf/download` — PDF bytes.
- `POST /lab/releases/:releaseId/artifacts/pdf/retry` — retry a failed artifact, restricted to an authorized lab administrator.

Clinic:

- `GET /results/by-order/:orderId/releases` — accessible release history with test names and PDF status.
- `GET /results/by-order/:orderId/pdf?releaseSequence=N` — PDF bytes for the requested release.

Each endpoint must verify access to the specific release and order, not just membership in the tenant supplied by a request header. Downloads return `Content-Type: application/pdf`, a safe release-specific filename in `Content-Disposition`, and appropriate `404`, `403`, or “not ready” responses. Do not expose storage paths or signed URLs to either frontend.

The generation trigger route is unnecessary for normal operation because the release transaction creates the pending artifact. Add an administrative repair route only if a real recovery case requires it.

## Frontend behavior

Lab: show PDF status and a download action for each release in release history. Poll while status is `PENDING` or `GENERATING`; stop on `COMPLETED` or `FAILED`. Offer retry to authorized users when appropriate.

Clinic: show every release with its type, date, included tests, amendment relationship, and PDF status. Download the selected release through Angular `HttpClient` with its normal authorization and tenant headers.

Both clients fetch the binary response as a Blob and initiate a browser download. Show a useful error if a download fails. Use filenames that include the requisition number and release sequence.

## Storage and retention

Use a private Supabase bucket accessed by the API's existing server-side storage client. The object path is for organization, not authorization; access checks belong in the API. Do not add an automatic deletion policy until a retention requirement is decided.

## Verification

Add tests for tenant isolation; ordinary, partial, final, and amended release creation; concurrent job claims; crash recovery after upload; stale worker protection; failed and retried jobs; frozen snapshot content; and download authorization. Inspect generated sample PDFs visually, especially page breaks, Unicode, missing optional fields, and signatures.
