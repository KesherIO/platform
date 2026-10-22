import { formatStatus, uploadTransition } from './status-format';
import type { UploaderStatus } from './uploader';

const up = (over: Partial<UploaderStatus> = {}): UploaderStatus => ({
  enabled: true,
  state: 'idle',
  pending: 0,
  uploaded: 0,
  rejected: 0,
  failing: 0,
  lastUploadAt: null,
  lastError: null,
  nextAttemptAt: null,
  authenticatedAs: null,
  ...over,
});
const rx = {
  listening: true,
  host: '0.0.0.0',
  port: 8001,
  connections: [],
  lastSampleId: null,
  lastControlId: null,
  lastReceivedAt: null,
  savedCount: 0,
  incompleteCount: 0,
  ackedCount: 0,
  errorCount: 0,
  lastError: null,
  lastErrorAt: null,
};

describe('uploadTransition: the operator must SEE upload problems, not just find them in status.json', () => {
  it('says so when the credential is refused', () => {
    expect(uploadTransition(up(), up({ state: 'auth-failed' }))).toMatch(
      /CREDENTIAL REFUSED.*still being saved/
    );
  });
  it('says so when the server cannot be reached, with the retry time', () => {
    expect(
      uploadTransition(
        up(),
        up({ state: 'offline', nextAttemptAt: '2026-10-22T10:00:00Z' })
      )
    ).toMatch(/UPLOAD OFFLINE.*retrying at/);
  });
  it('says when one file is failing on its own, and when everything recovers', () => {
    expect(
      uploadTransition(up(), up({ failing: 1, lastError: 'HTTP 500' }))
    ).toMatch(/1 file\(s\) failing.*HTTP 500/);
    expect(uploadTransition(up({ state: 'offline' }), up())).toMatch(
      /OK AGAIN/
    );
    expect(uploadTransition(up({ state: 'auth-failed' }), up())).toMatch(
      /OK AGAIN/
    );
  });
  it('stays quiet during normal uploading and when nothing changed', () => {
    expect(uploadTransition(null, up())).toBeNull();
    expect(
      uploadTransition(up(), up({ state: 'uploading', pending: 3 }))
    ).toBeNull();
    expect(uploadTransition(up({ state: 'uploading' }), up())).toBeNull();
    expect(
      uploadTransition(
        up({ state: 'offline' }),
        up({ state: 'offline', pending: 5 })
      )
    ).toBeNull(); // no repeat spam
  });
});

describe('formatStatus', () => {
  it('shows the upload line states in plain words', () => {
    expect(formatStatus(rx, up({ state: 'auth-failed' }))).toMatch(
      /CREDENTIAL REFUSED/
    );
    expect(
      formatStatus(
        rx,
        up({ state: 'offline', nextAttemptAt: '2026-10-22T10:00:00Z' })
      )
    ).toMatch(/OFFLINE - retrying/);
    expect(formatStatus(rx, null)).toMatch(/Upload\s+: OFF \(capture only/);
    expect(formatStatus(rx, up({ failing: 2 }))).toMatch(/2 FILE\(S\) FAILING/);
    expect(formatStatus({ ...rx, incompleteCount: 1 }, null)).toMatch(
      /INCOMPLETE\s+: 1.*NOT results/
    );
  });
});
