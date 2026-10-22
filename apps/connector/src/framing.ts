/**
 * Wire framing observed on the Genrui VH-30 (see docs/VH30-test.hl7):
 *
 *   [uint32 big-endian L] [0x0B] [HL7 message ...] [0x1C] [0x0D]
 *
 * L counts every byte after the 4-byte prefix, i.e. the whole MLLP block
 * (0x0B through the trailing 0x0D). Verified against all captured frames:
 * 4 + L == frame size and frames follow each other with no gap.
 *
 * The decoder never alters bytes: `bytes` is the exact frame as received
 * (prefix included) and is what gets persisted.
 */

export const LENGTH_PREFIX_BYTES = 4;
export const MLLP_START = 0x0b;
export const MLLP_END = 0x1c;
export const MLLP_CR = 0x0d;
/** Captured frames are ~0.7 MB; anything far beyond that is garbage. */
export const DEFAULT_MAX_FRAME_BYTES = 32 * 1024 * 1024;

const RESYNC_MARKER = Buffer.from([MLLP_START, 0x4d, 0x53, 0x48, 0x7c]); // 0x0B "MSH|"

export interface DecodedFrame {
  /** Exact bytes on the wire: length prefix + 0x0B + HL7 + 0x1C 0x0D. */
  bytes: Buffer;
  /** HL7 text between 0x0B and 0x1C (a view into `bytes`). */
  payload: Buffer;
}

export interface FramingIssue {
  reason:
    | 'invalid-header'
    | 'invalid-trailer'
    | 'oversize'
    | 'trailing-partial';
  message: string;
  /** Bytes that could not be framed; persisted separately, never dropped. */
  discarded: Buffer;
}

export interface DecodeResult {
  frames: DecodedFrame[];
  issues: FramingIssue[];
}

export class FrameDecoder {
  private chunks: Buffer[] = [];
  private pendingLength = 0;
  /** Length L of the frame currently being assembled, once its header is valid. */
  private expected: number | null = null;

  constructor(private readonly maxFrameBytes = DEFAULT_MAX_FRAME_BYTES) {}

  get bufferedBytes(): number {
    return this.pendingLength;
  }

  push(chunk: Buffer): DecodeResult {
    const result: DecodeResult = { frames: [], issues: [] };
    if (chunk.length === 0) return result;
    this.chunks.push(chunk);
    this.pendingLength += chunk.length;

    for (;;) {
      if (this.expected === null) {
        if (this.pendingLength < LENGTH_PREFIX_BYTES + 1) break;
        const head = this.peek(LENGTH_PREFIX_BYTES + 1);
        const length = head.readUInt32BE(0);
        const minimum = 1 + 1 + 1 + 1; // 0B + at least one byte + 1C 0D
        if (head[LENGTH_PREFIX_BYTES] !== MLLP_START || length < minimum) {
          this.resync(
            result,
            'invalid-header',
            'Frame header is not <length><0x0B>'
          );
          continue;
        }
        if (length > this.maxFrameBytes) {
          this.resync(
            result,
            'oversize',
            `Frame length ${length} exceeds limit ${this.maxFrameBytes}`
          );
          continue;
        }
        this.expected = length;
      }

      const total = LENGTH_PREFIX_BYTES + this.expected;
      if (this.pendingLength < total) break;

      const all = this.flatten();
      const bytes = Buffer.from(all.subarray(0, total)); // own copy
      const rest = all.subarray(total);
      this.chunks = rest.length ? [Buffer.from(rest)] : [];
      this.pendingLength = rest.length;
      this.expected = null;

      if (bytes[total - 2] !== MLLP_END || bytes[total - 1] !== MLLP_CR) {
        result.issues.push({
          reason: 'invalid-trailer',
          message: 'Frame does not end with 0x1C 0x0D',
          discarded: bytes,
        });
        continue;
      }
      result.frames.push({
        bytes,
        payload: bytes.subarray(LENGTH_PREFIX_BYTES + 1, total - 2),
      });
    }
    return result;
  }

  /** Call when the connection closes. Returns any incomplete frame so it can be saved. */
  flush(): FramingIssue | null {
    if (this.pendingLength === 0) return null;
    const discarded = this.flatten();
    const expected = this.expected;
    this.chunks = [];
    this.pendingLength = 0;
    this.expected = null;
    return {
      reason: 'trailing-partial',
      message:
        expected === null
          ? `Connection closed with ${discarded.length} unframed byte(s) pending`
          : `Connection closed mid-frame (${discarded.length} of ${
              LENGTH_PREFIX_BYTES + expected
            } bytes)`,
      discarded,
    };
  }

  /**
   * Discard bytes up to the next plausible frame start (<4 byte prefix> 0x0B "MSH|").
   * Discarded bytes are reported so the caller can persist them.
   */
  private resync(
    result: DecodeResult,
    reason: FramingIssue['reason'],
    message: string
  ): void {
    const all = this.flatten();
    let at = all.indexOf(RESYNC_MARKER, 1);
    while (at !== -1 && at < LENGTH_PREFIX_BYTES)
      at = all.indexOf(RESYNC_MARKER, at + 1);
    // No marker: keep a short tail in case the next frame header is split across reads.
    // Always advance by at least one byte so a bad header can never loop forever.
    const keepTail = LENGTH_PREFIX_BYTES + RESYNC_MARKER.length - 1;
    const cut = Math.max(
      1,
      at === -1 ? all.length - keepTail : at - LENGTH_PREFIX_BYTES
    );
    result.issues.push({
      reason,
      message,
      discarded: Buffer.from(all.subarray(0, cut)),
    });
    const rest = all.subarray(cut);
    this.chunks = rest.length ? [Buffer.from(rest)] : [];
    this.pendingLength = rest.length;
    this.expected = null;
  }

  private peek(n: number): Buffer {
    return this.chunks[0].length >= n ? this.chunks[0] : this.flatten();
  }

  private flatten(): Buffer {
    if (this.chunks.length > 1)
      this.chunks = [Buffer.concat(this.chunks, this.pendingLength)];
    return this.chunks[0] ?? Buffer.alloc(0);
  }
}
