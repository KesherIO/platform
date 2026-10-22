import { EventEmitter } from 'node:events';
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { buildAckFrame, type AckFraming } from './ack';
import { FrameDecoder, type FramingIssue } from './framing';
import { summarizeHl7, type Hl7Summary } from './hl7-summary';
import { MessageStore, type IncompleteMeta, type ReceivedFrameMeta } from './message-store';

export interface ReceiverOptions {
  host: string;
  port: number;
  store: MessageStore;
  /** If non-empty, only these remote IPs may connect. */
  allowFrom?: string[];
  /**
   * Send ACK^R01 after each message is durably saved. Off by default: the framing of
   * the ACK is not documented and must be confirmed on the device first.
   */
  ack?: AckFraming | null;
}

export interface ConnectionInfo {
  remote: string;
  since: string;
  bytes: number;
}

export interface ReceiverStatus {
  listening: boolean;
  host: string;
  port: number;
  connections: ConnectionInfo[];
  lastSampleId: string | null;
  lastControlId: string | null;
  lastReceivedAt: string | null;
  savedCount: number;
  /** Interrupted / unframeable transfers kept in incomplete/ — never results. */
  incompleteCount: number;
  ackedCount: number;
  errorCount: number;
  lastError: string | null;
  lastErrorAt: string | null;
}

export interface ReceiverEvents {
  listening: [ReceiverStatus];
  connected: [ConnectionInfo];
  disconnected: [ConnectionInfo];
  message: [ReceivedFrameMeta];
  acked: [{ controlId: string; remote: string }];
  incomplete: [{ issue: FramingIssue; meta: IncompleteMeta }];
  rejected: [string];
  error: [Error];
  status: [ReceiverStatus];
}

/**
 * TCP listener the analyzer connects to. It only receives and stores:
 * no ACK is sent (the device is configured with ACK off), and nothing
 * here needs the internet.
 */
export class Receiver extends EventEmitter<ReceiverEvents> {
  private server: Server | null = null;
  private readonly sockets = new Map<Socket, ConnectionInfo>();
  private state: ReceiverStatus;

  constructor(private readonly opts: ReceiverOptions) {
    super();
    this.state = {
      listening: false,
      host: opts.host,
      port: opts.port,
      connections: [],
      lastSampleId: null,
      lastControlId: null,
      lastReceivedAt: null,
      savedCount: opts.store.savedCount,
      incompleteCount: opts.store.incompleteCount,
      ackedCount: 0,
      errorCount: 0,
      lastError: null,
      lastErrorAt: null,
    };
  }

  get status(): ReceiverStatus {
    return { ...this.state, connections: [...this.sockets.values()].map((c) => ({ ...c })) };
  }

  address(): AddressInfo {
    return this.server!.address() as AddressInfo;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = createServer((socket) => this.onConnection(socket));
      this.server = server;
      server.once('error', reject);
      server.listen(this.opts.port, this.opts.host, () => {
        server.off('error', reject);
        server.on('error', (err) => this.fail(err));
        this.state.listening = true;
        this.state.port = (server.address() as AddressInfo).port;
        this.emit('listening', this.status);
        this.emit('status', this.status);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    for (const socket of this.sockets.keys()) socket.destroy();
    const server = this.server;
    if (!server) return;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    this.state.listening = false;
    this.emit('status', this.status);
  }

  private onConnection(socket: Socket): void {
    const ip = (socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    const allow = this.opts.allowFrom ?? [];
    if (allow.length > 0 && !allow.includes(ip)) {
      this.emit('rejected', ip);
      socket.destroy();
      return;
    }

    const remotePort = socket.remotePort ?? null; // gone once the socket closes
    const info: ConnectionInfo = { remote: `${ip}:${remotePort}`, since: new Date().toISOString(), bytes: 0 };
    this.sockets.set(socket, info);
    socket.setNoDelay(true);
    socket.setKeepAlive(true, 15_000); // notice a cable pulled without a TCP close
    const decoder = new FrameDecoder();

    this.emit('connected', info);
    this.emit('status', this.status);

    socket.on('data', (chunk) => {
      info.bytes += chunk.length;
      try {
        const { frames, issues } = decoder.push(chunk);
        for (const frame of frames) {
          const meta = this.storeFrame(frame.bytes, frame.payload, ip, remotePort);
          if (meta) this.sendAck(socket, info.remote, meta.hl7);
        }
        for (const issue of issues) this.storeIssue(issue, ip, remotePort);
      } catch (err) {
        this.fail(err);
      }
    });
    socket.on('error', (err) => this.fail(new Error(`Connection ${info.remote}: ${err.message}`)));
    socket.on('close', () => {
      this.sockets.delete(socket);
      try {
        const partial = decoder.flush();
        if (partial) this.storeIssue(partial, ip, remotePort);
      } catch (err) {
        this.fail(err);
      }
      this.emit('disconnected', info);
      this.emit('status', this.status);
    });
  }

  /** Returns the saved record, or null if it could not be saved (then NO ack is sent). */
  private storeFrame(bytes: Buffer, payload: Buffer, remoteAddress: string, remotePort: number | null) {
    try {
      const hl7 = summarizeHl7(payload);
      const meta = this.opts.store.saveFrame(bytes, hl7, { remoteAddress, remotePort });
      this.state.savedCount = this.opts.store.savedCount;
      this.state.lastSampleId = hl7.sampleId;
      this.state.lastControlId = hl7.controlId;
      this.state.lastReceivedAt = meta.receivedAt;
      this.emit('message', meta);
      this.emit('status', this.status);
      return meta;
    } catch (err) {
      this.fail(new Error(`Could not save message: ${(err as Error).message}`));
      return null;
    }
  }

  /** Only called after the frame is fsync'ed and renamed into the inbox. */
  private sendAck(socket: Socket, remote: string, hl7: Hl7Summary): void {
    if (!this.opts.ack || !hl7.controlId || !socket.writable) return;
    const frame = buildAckFrame(hl7, this.opts.ack);
    if (!frame) return;
    socket.write(frame, (err) => {
      if (err) return this.fail(new Error(`ACK to ${remote} failed: ${err.message}`));
      this.state.ackedCount++;
      this.emit('acked', { controlId: hl7.controlId as string, remote });
      this.emit('status', this.status);
    });
  }

  /** Interrupted or unframeable bytes: preserved and visibly marked INCOMPLETE, never treated as a result. */
  private storeIssue(issue: FramingIssue, remoteAddress: string, remotePort: number | null): void {
    const meta = this.opts.store.saveIncomplete(issue.discarded, issue.reason, { remoteAddress, remotePort });
    this.state.incompleteCount = this.opts.store.incompleteCount;
    this.emit('incomplete', { issue, meta });
    this.fail(new Error(`INCOMPLETE transfer: ${issue.message}; ${issue.discarded.length} byte(s) kept in incomplete/ and will not be imported`));
  }

  private fail(err: unknown): void {
    const error = err instanceof Error ? err : new Error(String(err));
    this.state.errorCount++;
    this.state.lastError = error.message;
    this.state.lastErrorAt = new Date().toISOString();
    this.emit('error', error);
    this.emit('status', this.status);
  }
}
