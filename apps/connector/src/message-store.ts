import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { join } from 'node:path';
import type { Hl7Summary } from './hl7-summary';

export interface ReceivedFrameMeta {
  id: string;
  receivedAt: string;
  remoteAddress: string | null;
  remotePort: number | null;
  bytes: number;
  sha256: string;
  /** true: a whole, validly framed message. */
  complete: true;
  hl7: Hl7Summary;
  frameFile: string;
}

/** Bytes that are NOT a complete message: cut-off transfers and unframeable data. */
export interface IncompleteMeta {
  id: string;
  receivedAt: string;
  remoteAddress: string | null;
  remotePort: number | null;
  bytes: number;
  sha256: string;
  complete: false;
  /** e.g. trailing-partial, invalid-header, invalid-trailer, oversize */
  reason: string;
  dataFile: string;
}

export interface SaveContext {
  remoteAddress: string | null;
  remotePort: number | null;
}

export interface StoreIo {
  /** Reads a just-written file back. Overridable so tests can simulate a bad disk. */
  readBack: (path: string) => Buffer;
}

/**
 * Durable, local, internet-independent storage.
 *
 *   <dataDir>/inbox/YYYY-MM-DD/<time>-<seq>-<sha8>.frame   complete message, exact wire bytes
 *   <dataDir>/inbox/YYYY-MM-DD/<time>-<seq>-<sha8>.json    metadata sidecar
 *   <dataDir>/incomplete/<time>-<seq>-<reason>.bin         INCOMPLETE transfer, exact bytes
 *   <dataDir>/incomplete/<time>-<seq>-<reason>.json        sidecar (complete:false)
 *
 * Anything in `incomplete/` is, by construction, never a result: it is uploaded
 * flagged incomplete and can never be imported.
 *
 * saveFrame returns only once the frame is written, fsync'ed, renamed, read
 * back and compared with the bytes in memory, so the caller (the ACK) can treat
 * a normal return as "durably stored". Any failure throws and leaves nothing
 * behind that would be counted as saved.
 */
export class MessageStore {
  readonly inboxDir: string;
  readonly incompleteDir: string;
  private seq = 0;
  private saved: number;
  private incomplete: number;

  constructor(
    readonly dataDir: string,
    private readonly io: StoreIo = { readBack: (p) => readFileSync(p) }
  ) {
    this.inboxDir = join(dataDir, 'inbox');
    this.incompleteDir = join(dataDir, 'incomplete');
    mkdirSync(this.inboxDir, { recursive: true });
    mkdirSync(this.incompleteDir, { recursive: true });
    this.saved = this.countExisting();
    this.incomplete = readdirSync(this.incompleteDir).filter((f) =>
      f.endsWith('.bin')
    ).length;
  }

  get savedCount(): number {
    return this.saved;
  }

  get incompleteCount(): number {
    return this.incomplete;
  }

  saveFrame(
    frame: Buffer,
    hl7: Hl7Summary,
    ctx: SaveContext,
    now = new Date()
  ): ReceivedFrameMeta {
    const sha256 = sha(frame);
    const day = now.toISOString().slice(0, 10);
    const dayDir = join(this.inboxDir, day);
    mkdirSync(dayDir, { recursive: true });

    const base = this.uniqueBase(
      dayDir,
      `${timeOfDay(now)}-${String(++this.seq).padStart(4, '0')}-${sha256.slice(
        0,
        8
      )}`
    );
    const frameFile = join(dayDir, `${base}.frame`);
    const metaFile = join(dayDir, `${base}.json`);
    const meta: ReceivedFrameMeta = {
      id: `${day}/${base}`,
      receivedAt: now.toISOString(),
      remoteAddress: ctx.remoteAddress,
      remotePort: ctx.remotePort,
      bytes: frame.length,
      sha256,
      complete: true,
      hl7,
      frameFile: `${base}.frame`,
    };
    try {
      writeDurably(frameFile, frame);
      if (sha(this.io.readBack(frameFile)) !== sha256) {
        throw new Error(
          `read-back of ${base}.frame does not match the bytes received`
        );
      }
      writeDurably(metaFile, Buffer.from(JSON.stringify(meta, null, 2)));
      fsyncDir(dayDir);
    } catch (err) {
      // Leave nothing that would later be counted or uploaded as a saved message.
      for (const f of [frameFile, metaFile]) {
        try {
          unlinkSync(f);
        } catch {
          /* not created */
        }
      }
      throw err;
    }
    this.saved++;
    return meta;
  }

  /** Bytes that never formed a valid frame (garbage, or a connection cut mid-frame). */
  saveIncomplete(
    bytes: Buffer,
    reason: string,
    ctx: SaveContext = { remoteAddress: null, remotePort: null },
    now = new Date()
  ): IncompleteMeta {
    const sha256 = sha(bytes);
    const stamp = now
      .toISOString()
      .replace(/[-:.]/g, '')
      .replace('T', '-')
      .slice(0, 18);
    const base = this.uniqueBase(
      this.incompleteDir,
      `${stamp}-${String(++this.seq).padStart(4, '0')}-${reason}`
    );
    const dataFile = join(this.incompleteDir, `${base}.bin`);
    const meta: IncompleteMeta = {
      id: `incomplete/${base}`,
      receivedAt: now.toISOString(),
      remoteAddress: ctx.remoteAddress,
      remotePort: ctx.remotePort,
      bytes: bytes.length,
      sha256,
      complete: false,
      reason,
      dataFile: `${base}.bin`,
    };
    writeDurably(dataFile, bytes);
    writeDurably(
      join(this.incompleteDir, `${base}.json`),
      Buffer.from(JSON.stringify(meta, null, 2))
    );
    fsyncDir(this.incompleteDir);
    this.incomplete++;
    return meta;
  }

  private uniqueBase(dir: string, base: string): string {
    let candidate = base;
    for (
      let n = 1;
      existsSync(join(dir, `${candidate}.frame`)) ||
      existsSync(join(dir, `${candidate}.bin`));
      n++
    ) {
      candidate = `${base}-${n}`;
    }
    return candidate;
  }

  private countExisting(): number {
    let count = 0;
    for (const day of readdirSync(this.inboxDir, { withFileTypes: true })) {
      if (!day.isDirectory()) continue;
      count += readdirSync(join(this.inboxDir, day.name)).filter((f) =>
        f.endsWith('.frame')
      ).length;
    }
    return count;
  }
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const timeOfDay = (d: Date) =>
  d.toISOString().slice(11, 23).replace(/[:.]/g, '');

function writeDurably(path: string, data: Buffer): void {
  const tmp = `${path}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    let offset = 0;
    while (offset < data.length) offset += writeSync(fd, data, offset);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

/** Make the rename itself durable. Windows cannot fsync a directory; NTFS journals the rename. */
function fsyncDir(dir: string): void {
  if (process.platform === 'win32') return;
  const fd = openSync(dir, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
