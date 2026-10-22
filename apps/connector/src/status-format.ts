import type { ReceiverStatus } from './receiver';
import type { UploaderStatus } from './uploader';

const clock = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString() : '-';

function uploadLine(u: UploaderStatus | null): string {
  if (!u) return 'OFF (capture only - run with --configure to enable)';
  const state =
    u.state === 'auth-failed'
      ? 'CREDENTIAL REFUSED - ask the lab admin for a new token'
      : u.state === 'offline'
      ? `OFFLINE - retrying ${
          u.nextAttemptAt ? `at ${clock(u.nextAttemptAt)}` : 'soon'
        }`
      : u.state === 'uploading'
      ? 'uploading'
      : 'up to date';
  return `${state}; pending ${u.pending}, uploaded ${u.uploaded}${
    u.rejected ? `, REJECTED ${u.rejected}` : ''
  }${
    u.failing
      ? `, ${u.failing} FILE(S) FAILING on their own (others keep uploading)`
      : ''
  }${u.authenticatedAs ? `, as ${u.authenticatedAs}` : ''}`;
}

/** Plain-ASCII block so it renders in any Windows console. */
export function formatStatus(
  s: ReceiverStatus,
  u: UploaderStatus | null = null
): string {
  const conn = s.connections.length
    ? `CONNECTED  (${s.connections.map((c) => c.remote).join(', ')})`
    : 'WAITING for analyzer';
  const last = s.lastSampleId
    ? `${s.lastSampleId}  (control ID ${
        s.lastControlId ?? '?'
      }, received ${clock(s.lastReceivedAt)})`
    : '-';
  return [
    '----------------------------------------------------------',
    ` VH-30 receiver   ${
      s.listening ? `listening on ${s.host}:${s.port}` : 'NOT LISTENING'
    }`,
    ` Connection     : ${conn}`,
    ` Last sample ID : ${last}`,
    ` Saved messages : ${s.savedCount}${
      s.ackedCount ? `   ACKs sent: ${s.ackedCount}` : ''
    }`,
    ` INCOMPLETE     : ${s.incompleteCount}${
      s.incompleteCount
        ? '  <- interrupted transfers kept in incomplete\\, NOT results; resend from the analyzer'
        : ''
    }`,
    ` Upload         : ${uploadLine(u)}`,
    ` Errors         : ${s.errorCount}${
      s.lastError ? `  (last ${clock(s.lastErrorAt)}: ${s.lastError})` : ''
    }`,
    '----------------------------------------------------------',
  ].join('\n');
}

/**
 * A one-line message when the UPLOAD side changes in a way the operator must see, else null.
 * The receiver only redraws the console on receiver events, so without this a refused token or a lost
 * connection would be silent until the next message arrived.
 */
export function uploadTransition(
  prev: UploaderStatus | null,
  next: UploaderStatus
): string | null {
  const key = (u: UploaderStatus) => `${u.state}|${u.failing > 0}`;
  if (prev && key(prev) === key(next)) return null;
  const was = prev?.state;
  if (next.state === 'auth-failed')
    return 'UPLOAD STOPPED: CREDENTIAL REFUSED (token revoked, mistyped or for another server). Messages are still being saved here. Ask the lab admin for a new token, then run configure-upload.bat.';
  if (next.state === 'offline')
    return `UPLOAD OFFLINE: cannot reach the server${
      next.nextAttemptAt
        ? ` — retrying at ${new Date(next.nextAttemptAt).toLocaleTimeString()}`
        : ''
    }. Messages are still being saved here and will upload when it is back.`;
  if (next.failing > 0 && !(prev && prev.failing > 0))
    return `UPLOAD: ${
      next.failing
    } file(s) failing on their own (the server is reachable); the rest keep uploading. Last error: ${
      next.lastError ?? '?'
    }`;
  if (next.state === 'idle' && (was === 'offline' || was === 'auth-failed'))
    return 'UPLOAD OK AGAIN: connection restored, queue is up to date.';
  return null;
}
