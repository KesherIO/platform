import { currentTests, latestNonAmendment } from './current-report.util';

describe('current-report.util', () => {
  const release = (
    releaseSequence: number,
    releaseType: string,
    tests: { sourceReportTestId: string; value: number }[]
  ) => ({
    releaseSequence,
    releaseType,
    releasedAt: new Date(`2026-10-1${releaseSequence}T10:00:00Z`),
    tests,
  });

  // CBC partial, then chemistry final, then the CBC amended
  const releases = [
    release(3, 'AMENDMENT', [{ sourceReportTestId: 'cbc', value: 2 }]),
    release(1, 'PARTIAL', [{ sourceReportTestId: 'cbc', value: 1 }]),
    release(2, 'FINAL', [{ sourceReportTestId: 'chem', value: 7 }]),
  ];

  describe('currentTests', () => {
    it('keeps the latest snapshot of each test, in the order first released', () => {
      expect(currentTests(releases)).toEqual([
        { sourceReportTestId: 'cbc', value: 2 },
        { sourceReportTestId: 'chem', value: 7 },
      ]);
    });

    it('is empty without releases', () => {
      expect(currentTests([])).toEqual([]);
    });
  });

  describe('latestNonAmendment', () => {
    it('skips amendments', () => {
      expect(latestNonAmendment(releases)?.releaseSequence).toBe(2);
    });

    it('is null when there are only amendments', () => {
      expect(latestNonAmendment([releases[0]])).toBeNull();
    });
  });
});
