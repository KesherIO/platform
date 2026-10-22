/**
 * End to end, nothing mocked: the real bundled connector (apps/connector/dist) receives the
 * real VH-30 capture over TCP, saves it, uploads it over HTTP to the real Nest AppModule
 * (global JWT guard + ConnectorAuthGuard), which writes to a real Postgres and imports DRAFT
 * results into the order linked to the sample.
 *
 * Skipped unless INTEGRATION_DATABASE_URL is set AND the connector bundle exists:
 *   (cd apps/connector && node scripts/bundle.mjs)
 *   cd apps/api && INTEGRATION_DATABASE_URL=postgres://postgres@127.0.0.1:55433/postgres \
 *     node ../../node_modules/.bin/jest --config jest.config.js instruments.e2e.int
 *
 * SAFETY: apps/api/.env holds real dev credentials. This spec overrides every variable it needs
 * and refuses to start unless the database host is local.
 */
// jwks-rsa pulls in `jose` (ESM), which this Jest setup can't load. Only the signature-key fetch is
// stubbed: the routes under test must reject missing / non-JWT tokens before any key lookup.
jest.mock('jwks-rsa', () => ({ passportJwtSecret: () => (_req: unknown, _tok: unknown, done: (e: Error) => void) => done(new Error('no key')) }));

import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { type Server } from 'node:http';
import { createServer as netServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectorCredentialService } from './connector-credential.service';
import { InstrumentReviewService } from './instrument-review.service';
import { hasCapture, realFrames } from './test-frames';

const DATABASE_URL = process.env['INTEGRATION_DATABASE_URL'];
const CONNECTOR_DIST = resolve(__dirname, '../../../connector/dist');
const RECEIVER = join(CONNECTOR_DIST, 'vh30-receiver.cjs');
const REPLAY = join(CONNECTOR_DIST, 'vh30-replay.cjs');
const CAPTURE = resolve(__dirname, '../../../../docs/VH30-test.hl7');
const runnable = !!DATABASE_URL && hasCapture && existsSync(RECEIVER) && existsSync(REPLAY);
const describeE2e = runnable ? describe : describe.skip;

jest.setTimeout(120_000);

const freePort = () =>
  new Promise<number>((res) => {
    const s = netServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | false | null | undefined> | T | false | null | undefined, what: string, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(100);
  }
}

describeE2e('connector → API → Postgres, end to end', () => {
  let app: INestApplication;
  let httpServer: Server;
  let prisma: PrismaService;
  let apiPort: number;
  let rxPort: number;
  let dataDir: string;
  let receiver: ChildProcess | null = null;
  let receiverLog = '';
  const runId = randomUUID().slice(0, 8);
  const ids = { lab: '', clinic: '', user: '', def: '', orderA: '', orderB: '', testA: '', testB: '', analyzer: '', credential: '' };
  let token = '';
  const cases: string[] = [];

  const readStatus = () => {
    try {
      return JSON.parse(readFileSync(join(dataDir, 'status.json'), 'utf8'));
    } catch {
      return null;
    }
  };
  const files = (suffix: string) => (existsSync(dataDir) ? readdirSync(dataDir, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith(suffix)) : []);
  const messages = () => prisma.instrumentMessage.findMany({ where: { analyzerId: ids.analyzer }, orderBy: { createdAt: 'asc' } });
  const values = async (testId: string) =>
    Object.fromEntries((await prisma.resultReportAnalyte.findMany({ where: { reportTest: { orderedTestId: testId } }, select: { code: true, numericValue: true } })).map((a) => [a.code, a.numericValue]));

  const replay = (...args: string[]) =>
    new Promise<void>((res, rej) => {
      const p = spawn(process.execPath, [REPLAY, CAPTURE, '--port', String(rxPort), ...args], { stdio: 'pipe' });
      let out = '';
      p.stdout.on('data', (d) => (out += d));
      p.stderr.on('data', (d) => (out += d));
      p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`replay failed: ${out}`))));
    });

  const startReceiver = async (env: Record<string, string> = {}) => {
    receiverLog = '';
    receiver = spawn(process.execPath, [RECEIVER, '--host', '127.0.0.1', '--port', String(rxPort), '--data-dir', dataDir], {
      env: { ...process.env, VH30_API_URL: `http://127.0.0.1:${apiPort}`, VH30_API_TOKEN: token, ...env },
      stdio: 'pipe',
    });
    receiver.stdout!.on('data', (d) => (receiverLog += d));
    receiver.stderr!.on('data', (d) => (receiverLog += d));
    await until(() => receiverLog.includes('Listening on'), 'receiver to listen');
  };
  const stopReceiver = async () => {
    if (!receiver) return;
    const r = receiver;
    receiver = null;
    r.kill('SIGTERM');
    await new Promise((res) => r.on('exit', res));
  };

  beforeAll(async () => {
    // Everything the app reads is overridden here; apps/api/.env must not leak in.
    Object.assign(process.env, {
      DATABASE_URL,
      SUPABASE_URL: 'http://127.0.0.1:9',
      SUPABASE_SERVICE_ROLE_KEY: 'dummy',
      SUPABASE_ANON_KEY: 'dummy',
      NODE_ENV: 'test',
    });
    const { AppModule } = await import('../app/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const dbUrl = new URL(moduleRef.get(ConfigService).getOrThrow<string>('DATABASE_URL'));
    if (!['127.0.0.1', 'localhost'].includes(dbUrl.hostname)) {
      throw new Error(`Refusing to run: DATABASE_URL host is ${dbUrl.hostname}, not local.`);
    }
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    apiPort = await freePort();
    await app.listen(apiPort, '127.0.0.1');
    httpServer = app.getHttpServer();
    prisma = app.get(PrismaService);
    rxPort = await freePort();
    dataDir = mkdtempSync(join(tmpdir(), 'vh30-e2e-'));

    const lab = await prisma.tenant.create({ data: { name: `E2E lab ${runId}`, slug: `e2e-lab-${runId}`, type: 'LAB', timezone: 'America/Bogota' } });
    const clinic = await prisma.tenant.create({ data: { name: `E2E clinic ${runId}`, slug: `e2e-clinic-${runId}` } });
    const user = await prisma.user.create({ data: { id: randomUUID(), email: `e2e-${runId}@it.example.com` } });
    Object.assign(ids, { lab: lab.id, clinic: clinic.id, user: user.id });

    const CATALOG = `CBC-${runId}`;
    const def = await prisma.resultTemplateDefinition.create({ data: { catalogItemCode: CATALOG, species: 'DOG', scope: 'LABORATORY', labTenantId: lab.id, ownerKey: lab.id } });
    ids.def = def.id;
    const version = await prisma.resultTemplateVersion.create({ data: { definitionId: def.id, version: 1, title: 'CBC', status: 'PUBLISHED' } });
    await prisma.resultTemplateDefinition.update({ where: { id: def.id }, data: { activeVersionId: version.id } });
    let n = 0;
    for (const code of ['RBC', 'HGB', 'HCT', 'WBC', 'PLT', 'LYM', 'LYM_PCT']) {
      await prisma.resultTemplateAnalyte.create({ data: { versionId: version.id, code, name: code, valueType: 'NUMERIC', sortOrder: ++n } });
    }
    const analyzer = await prisma.analyzer.create({ data: { labTenantId: lab.id, name: `VH30 e2e ${runId}`, department: 'HEMATOLOGY' } });
    ids.analyzer = analyzer.id;
    for (const [code, unit, analyte] of [['WBC', '10^9/L', 'WBC'], ['RBC', '10^12/L', 'RBC'], ['HGB', 'g/dL', 'HGB'], ['HCT', '%', 'HCT'], ['PLT', '10^9/L', 'PLT'], ['Lym#', '10^9/L', 'LYM'], ['Lym%', '%', 'LYM_PCT']]) {
      await prisma.instrumentParameterMapping.create({ data: { labTenantId: lab.id, analyzerId: analyzer.id, parameterCode: code, analyzerUnit: unit, catalogItemCode: CATALOG, analyteCode: analyte } });
    }
    for (const key of ['A', 'B'] as const) {
      const kase = await prisma.case.create({ data: { tenantId: clinic.id, patientName: `E2E ${key}`, patientSpecies: 'DOG', ownerName: 'Owner', createdByUserId: user.id } });
      cases.push(kase.id);
      const order = await prisma.order.create({ data: { requisitionNumber: `E2E-${key}-${runId}`, caseId: kase.id, tenantId: clinic.id, labTenantId: lab.id, orderedItems: [] } });
      const test = await prisma.orderedTest.create({ data: { orderId: order.id, catalogItemName: 'Hemograma', catalogItemCode: CATALOG, status: 'READY' } });
      ids[key === 'A' ? 'orderA' : 'orderB'] = order.id;
      ids[key === 'A' ? 'testA' : 'testB'] = test.id;
    }
    // Explicit links only: analyzer sample 168 → order A, 1111 → order B; 169 deliberately unlinked.
    const review = app.get(InstrumentReviewService);
    const window = { validFrom: new Date('2026-10-19T00:00:00Z'), validUntil: new Date('2026-10-22T00:00:00Z') };
    await review.createLink(lab.id, { analyzerId: analyzer.id, sampleId: '168', orderId: ids.orderA, ...window }, user.id);
    await review.createLink(lab.id, { analyzerId: analyzer.id, sampleId: '1111', orderId: ids.orderB, ...window }, user.id);

    const cred = await app.get(ConnectorCredentialService).create(lab.id, analyzer.id, 'e2e connector', user.id);
    ids.credential = cred.id;
    token = cred.token;
  });

  afterAll(async () => {
    await stopReceiver();
    if (prisma) {
      await prisma.instrumentMessage.deleteMany({ where: { labTenantId: ids.lab } });
      await prisma.order.deleteMany({ where: { id: { in: [ids.orderA, ids.orderB] } } });
      await prisma.case.deleteMany({ where: { id: { in: cases } } });
      await prisma.resultTemplateDefinition.updateMany({ where: { id: ids.def }, data: { activeVersionId: null } });
      await prisma.resultTemplateVersion.deleteMany({ where: { definitionId: ids.def } });
      await prisma.resultTemplateDefinition.deleteMany({ where: { id: ids.def } });
      await prisma.tenant.deleteMany({ where: { id: { in: [ids.lab, ids.clinic] } } });
      await prisma.user.deleteMany({ where: { id: ids.user } });
    }
    await app?.close();
    if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  });

  it('refuses unauthenticated and wrongly authenticated callers on every route family', async () => {
    const base = `http://127.0.0.1:${apiPort}/api`;
    const post = (headers: Record<string, string>) =>
      fetch(`${base}/instrument-ingest/messages`, { method: 'POST', headers: { 'content-type': 'application/octet-stream', ...headers }, body: Buffer.from('x') });
    expect((await post({})).status).toBe(401);
    expect((await post({ authorization: 'Bearer nonsense' })).status).toBe(401);
    expect((await post({ authorization: `Bearer ${token.slice(0, -1)}x` })).status).toBe(401);
    expect((await fetch(`${base}/instrument-ingest/ping`)).status).toBe(401);
    expect((await fetch(`${base}/lab/instruments/summary`)).status).toBe(401); // Supabase JWT required
    expect((await fetch(`${base}/lab/instruments/summary`, { headers: { authorization: `Bearer ${token}` } })).status).toBe(401); // a connector token is not a user JWT
    const ping = await fetch(`${base}/instrument-ingest/ping`, { headers: { authorization: `Bearer ${token}` } });
    expect(ping.status).toBe(200);
    expect(await ping.json()).toMatchObject({ ok: true, analyzer: `VH30 e2e ${runId}` });
  });

  it('receives the capture, uploads it, and imports DRAFT results only for explicitly linked samples', async () => {
    await startReceiver();
    await replay('--random-chunks', '--new-connection');

    await until(async () => (await messages()).length === 5, 'all 5 messages in the database');
    await until(() => files('.uploaded.json').length === 5, 'connector upload markers');

    const rows = await messages();
    expect(rows.map((r) => [r.sampleId, r.controlId, r.status])).toEqual([
      ['168', '2577', 'IMPORTED'],
      ['169', '2574', 'UNMATCHED'],
      ['168', '2577', 'DUPLICATE'], // resend: same control ID, new MSH-7, same content
      ['1111', '2580', 'IMPORTED'],
      ['1111', '2580', 'DUPLICATE'],
    ]);
    // Raw bytes in the API are exactly what the analyzer sent
    const frames = realFrames();
    const review = app.get(InstrumentReviewService);
    for (let i = 0; i < 5; i++) expect((await review.raw(ids.lab, rows[i].id)).bytes.equals(frames[i])).toBe(true);

    expect(await values(ids.testA)).toMatchObject({ WBC: 13.23, HGB: expect.any(Number) });
    expect(await values(ids.testB)).toEqual({ WBC: 71.36, RBC: 2.77, HGB: 5.7, HCT: 19, PLT: 317, LYM: 7.64, LYM_PCT: 10.7 });
    const report = await prisma.resultReport.findUniqueOrThrow({ where: { orderId: ids.orderB } });
    expect(report.status).toBe('DRAFT'); // still needs review + release
    expect(await prisma.orderedTest.findUniqueOrThrow({ where: { id: ids.testB } })).toMatchObject({ status: 'IN_PROGRESS', entryMethod: 'INSTRUMENT', resultEntrySource: 'DIRECT_INTEGRATION' });

    // The unlinked sample 169 is waiting in the review queue — it never guessed an order
    const queue = await review.list(ids.lab, 'review');
    expect(queue.items.map((m) => [m.sampleId, m.status])).toEqual([['169', 'UNMATCHED']]);

    expect(readStatus().upload).toMatchObject({ state: 'idle', pending: 0, uploaded: 5, rejected: 0 });
  });

  it('while the API is unreachable the connector keeps capturing, then uploads everything, with interrupted transfers marked INCOMPLETE', async () => {
    const before = (await messages()).length;
    const draftA = await values(ids.testA);
    const draftB = await values(ids.testB);
    const uploadedBefore = files('.uploaded.json').length;
    await new Promise<void>((res) => httpServer.close(() => res())); // API goes down

    await replay('--frames', '3', '--random-chunks'); // 3 whole messages
    await replay('--frames', '2', '--cut-mid-frame'); // …and one cut mid-frame
    await until(() => files('.frame').length === 5 + 3 + 1 && files('.bin').length === 1, 'local capture while offline');
    await sleep(500);
    expect(await prisma.instrumentMessage.count({ where: { analyzerId: ids.analyzer } })).toBe(before); // nothing reached the API
    expect(readStatus().upload.pending).toBeGreaterThan(0);
    expect(readStatus().incompleteCount).toBe(1); // visible locally, too

    await new Promise<void>((res) => httpServer.listen(apiPort, '127.0.0.1', () => res())); // API back
    await until(() => readStatus()?.upload?.pending === 0 && files('.uploaded.json').length > uploadedBefore, 'queue to drain', 60_000);

    const all = await messages();
    // Identical bytes were already known (dedupe by sha256); only the cut-off one is new
    expect(all.length).toBe(before + 1);
    const incomplete = all.filter((m) => !m.isComplete);
    expect(incomplete).toHaveLength(1);
    expect(incomplete[0]).toMatchObject({ status: 'INCOMPLETE', reasons: ['INCOMPLETE_TRANSFER'] });
    expect(incomplete[0].incompleteReason).toBe('trailing-partial');
    expect(await values(ids.testA)).toEqual(draftA); // resent duplicates changed no draft
    expect(await values(ids.testB)).toEqual(draftB);
    expect((await app.get(InstrumentReviewService).summary(ids.lab)).incomplete).toBe(1);
  });

  it('a revoked credential stops uploads visibly and loses nothing', async () => {
    await app.get(ConnectorCredentialService).revoke(ids.lab, ids.credential, ids.user);
    const before = files('.uploaded.json').length;
    await replay('--frames', '1');
    await until(() => readStatus()?.upload?.state === 'auth-failed', 'connector to report the refused credential');
    expect(readStatus().upload.pending).toBeGreaterThan(0);
    expect(readStatus().upload.lastError).toMatch(/credential refused/);
    expect(files('.uploaded.json').length).toBe(before);
    expect(files('.frame').length).toBeGreaterThan(before - 1); // still saved locally
  });
});
