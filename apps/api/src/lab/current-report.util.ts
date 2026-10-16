/**
 * The clinic's "current report" when a lab keeps amendments silent
 * (LaboratoryProfile.showAmendmentsToClinic = false): every released test at
 * its latest values, in one PDF.
 */

/** Per-release PDF (lab history, and clinics of labs that show amendments). */
export const RELEASE_PDF_ARTIFACT = 'PDF';
/** Current report PDF, made on every release and amendment approval. */
export const CLINIC_REPORT_PDF_ARTIFACT = 'CLINIC_REPORT_PDF';

type ReleaseLike = {
  releaseSequence: number;
  releaseType: string;
  releasedAt: Date;
};

type ReleaseTestLike = { sourceReportTestId: string };

/**
 * Latest snapshot of each test across `releases`, in the order the clinic
 * first received them. Pass only the releases up to the report being built.
 */
export function currentTests<
  R extends ReleaseLike & { tests: ReleaseTestLike[] }
>(releases: R[]): R['tests'][number][] {
  const sorted = [...releases].sort(
    (a, b) => a.releaseSequence - b.releaseSequence
  );
  // Map keeps a key's first position when it's overwritten: first release,
  // then position in it
  const byTest = new Map<string, R['tests'][number]>();
  for (const release of sorted) {
    for (const test of release.tests) byTest.set(test.sourceReportTestId, test);
  }
  return [...byTest.values()];
}

/** Newest PARTIAL/FINAL release — its type and date head the current report. */
export function latestNonAmendment<R extends ReleaseLike>(
  releases: R[]
): R | null {
  return releases.reduce<R | null>(
    (latest, r) =>
      r.releaseType !== 'AMENDMENT' &&
      (!latest || r.releaseSequence > latest.releaseSequence)
        ? r
        : latest,
    null
  );
}
