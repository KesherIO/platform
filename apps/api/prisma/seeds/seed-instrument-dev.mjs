/**
 * Development setup for the VH-30 connector: ONE analyzer, its parameter mappings, ONE
 * development order with a CBC test ready for results, an explicit analyzer-sample link
 * to it, and (optionally) a connector credential. Idempotent where it can be.
 *
 *   DATABASE_URL=… node apps/api/prisma/seeds/seed-instrument-dev.mjs \
 *     --lab <lab tenant id or slug> --clinic <clinic tenant id or slug> \
 *     [--catalog-code CBC] [--sample-id 1111] [--analyzer "VH-30 (dev)"] \
 *     [--from 2026-10-19T00:00:00Z --until 2026-10-23T00:00:00Z] [--no-credential]
 *     [--token-file ./token.txt]   write the token to an owner-only file instead of the terminal
 *     [--dry-run]                  look everything up and print the plan; write NOTHING
 *
 * Point DATABASE_URL at DEV only. Never resets or edits existing data; it only adds rows. The lab must already have the CBC result template (the
 * platform CBC templates use analyte codes RBC, HGB, HCT, MCV, MCH, MCHC, WBC, LYM, LYM_PCT,
 * PLT, MPV …). `--catalog-code` is the code on the lab's CBC *ordered test* / template.
 *
 * Mapping decisions (explicit, per the analyzer's own units — edit via the API/UI to change):
 *   mapped:   WBC RBC HGB HCT MCV MCH MCHC PLT MPV   (MCV/MCH/MCHC are template formulas: reported, not written)
 *             HGB / MCHC also accepted in g/L with ×0.1 (the PDF's default units)
 *   NOT mapped (lab decision: the whole differential is entered from the manual smear count; the VH-30 is a 3-part
 *             analyzer): Lym#/Lym%/Mid#/Mid%/Gran#/Gran%
 *             (3-part differential ≠ the template's NEU/MON/EOS/BAS), RDW-CV/SD, PDW, PCT, P-LCC, P-LCR
 *   A parameter that arrives in a unit with no row here is held for review, never guessed.
 */
import { PrismaClient } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: a } = parseArgs({
  options: {
    lab: { type: 'string' },
    clinic: { type: 'string' },
    'catalog-code': { type: 'string', default: 'CBC' },
    'sample-id': { type: 'string', default: '1111' },
    analyzer: { type: 'string', default: 'VH-30 (dev)' },
    from: { type: 'string' },
    until: { type: 'string' },
    'no-credential': { type: 'boolean' },
    'token-file': { type: 'string' },
    'dry-run': { type: 'boolean' },
  },
});
if (!a.lab || !a.clinic) {
  console.error(
    'Usage: --lab <id|slug> --clinic <id|slug> [--catalog-code CBC] [--sample-id 1111] [--no-credential]'
  );
  process.exit(1);
}
const url = new URL(process.env.DATABASE_URL ?? 'postgres://missing');
console.log(`Database host: ${url.hostname}`);

const prisma = new PrismaClient();
const tenant = (key) =>
  prisma.tenant.findFirst({ where: { OR: [{ id: key }, { slug: key }] } });

const MAPPINGS = [
  ['WBC', '10^9/L', 'WBC', 1],
  ['RBC', '10^12/L', 'RBC', 1],
  ['HGB', 'g/dL', 'HGB', 1],
  ['HGB', 'g/L', 'HGB', 0.1],
  ['HCT', '%', 'HCT', 1],
  ['MCV', 'fL', 'MCV', 1],
  ['MCH', 'pg', 'MCH', 1],
  ['MCHC', 'g/dL', 'MCHC', 1],
  ['MCHC', 'g/L', 'MCHC', 0.1],
  ['PLT', '10^9/L', 'PLT', 1],
  ['MPV', 'fL', 'MPV', 1],
];

try {
  const lab = await tenant(a.lab);
  const clinic = await tenant(a.clinic);
  if (!lab || lab.type === 'CLINIC')
    throw new Error(`Lab tenant not found (or is a clinic): ${a.lab}`);
  if (!clinic) throw new Error(`Clinic tenant not found: ${a.clinic}`);
  const code = a['catalog-code'];

  const DRY = !!a['dry-run'];
  const say = (m) => console.log(DRY ? `[dry-run] would: ${m}` : m);
  const existingAnalyzer = await prisma.analyzer.findFirst({
    where: { labTenantId: lab.id, name: a.analyzer },
  });
  const creator = await prisma.userTenantMembership.findFirst({
    where: { tenantId: clinic.id, status: 'ACTIVE' },
    select: { userId: true },
  });
  if (!creator)
    throw new Error(
      'The clinic has no active members to own the development case.'
    );
  const template = await prisma.resultTemplateDefinition.count({
    where: { catalogItemCode: code, activeVersionId: { not: null } },
  });
  if (template === 0)
    throw new Error(
      `No active result template for catalog code "${code}" — results could not be saved.`
    );
  const connection = await prisma.clinicLabConnection.findFirst({
    where: { clinicId: clinic.id, labId: lab.id },
  });
  console.log(
    `Lab:     ${lab.name} (${lab.id})\nClinic:  ${clinic.name} (${
      clinic.id
    }); connection to the lab: ${connection?.status ?? 'NONE'}`
  );
  console.log(`Catalog: "${code}" — ${template} active template definition(s)`);
  console.log(
    `Analyzer: ${
      existingAnalyzer
        ? `reuse existing "${existingAnalyzer.name}"`
        : `create "${a.analyzer}"`
    }`
  );

  const validFrom = a.from
    ? new Date(a.from)
    : new Date(Date.now() - 12 * 3_600_000);
  const validUntil = a.until
    ? new Date(a.until)
    : new Date(Date.now() + 48 * 3_600_000);
  if (!(validUntil > validFrom))
    throw new Error('--until must be after --from');
  say(
    `create ${
      MAPPINGS.length
    } parameter mappings for "${code}", 1 development order (patient "ZZ VH-30 DEV"), 1 accepted EDTA specimen, a link analyzer sample "${
      a['sample-id']
    }" -> that order (${validFrom.toISOString()} … ${validUntil.toISOString()})${
      a['no-credential'] ? '' : ', and 1 connector credential'
    }`
  );
  if (DRY) {
    console.log('[dry-run] nothing written.');
    process.exit(0);
  }

  const analyzer =
    existingAnalyzer ??
    (await prisma.analyzer.create({
      data: {
        labTenantId: lab.id,
        name: a.analyzer,
        model: 'VH-30',
        manufacturer: 'Genrui',
        department: 'HEMATOLOGY',
        connectionType: 'CONNECTOR',
      },
    }));
  console.log(`Analyzer: ${analyzer.name} (${analyzer.id})`);

  for (const [
    parameterCode,
    analyzerUnit,
    analyteCode,
    multiplier,
  ] of MAPPINGS) {
    await prisma.instrumentParameterMapping.upsert({
      where: {
        analyzerId_parameterCode_analyzerUnit_catalogItemCode: {
          analyzerId: analyzer.id,
          parameterCode,
          analyzerUnit,
          catalogItemCode: code,
        },
      },
      create: {
        labTenantId: lab.id,
        analyzerId: analyzer.id,
        parameterCode,
        analyzerUnit,
        catalogItemCode: code,
        analyteCode,
        multiplier,
      },
      update: { analyteCode, multiplier },
    });
  }
  console.log(`Mappings: ${MAPPINGS.length} rows for catalog code "${code}"`);

  // The development order: a clearly-labelled test patient, received at the lab, CBC ready for results.
  const now = new Date();
  const suffix = randomBytes(3).toString('hex').toUpperCase();
  const kase = await prisma.case.create({
    data: {
      tenantId: clinic.id,
      patientName: 'ZZ VH-30 DEV (test patient)',
      patientSpecies: 'DOG',
      ownerName: 'Development',
      createdByUserId: creator.userId,
    },
  });
  const order = await prisma.order.create({
    data: {
      requisitionNumber: `DEV-VH30-${suffix}`,
      caseId: kase.id,
      tenantId: clinic.id,
      labTenantId: lab.id,
      status: 'RECEIVED_BY_LAB',
      receivedByLabAt: now,
      orderedItems: [],
      labNotes: 'Development order for the VH-30 connector. Safe to delete.',
    },
  });
  const test = await prisma.orderedTest.create({
    data: {
      orderId: order.id,
      catalogItemName: 'Hemograma (dev)',
      catalogItemCode: code,
      status: 'READY',
      department: 'HEMATOLOGY',
      receivedAt: now,
    },
  });
  const specimen = await prisma.specimen.create({
    data: {
      orderId: order.id,
      labTenantId: lab.id,
      accessionNumber: `SPEC-DEV-${suffix}`,
      specimenType: 'EDTA_BLOOD',
      containerType: 'EDTA_TUBE',
      status: 'ACCEPTED',
      receivedAt: now,
    },
  });
  await prisma.orderedTestSpecimen.create({
    data: { orderedTestId: test.id, specimenId: specimen.id },
  });
  console.log(
    `Order: ${order.requisitionNumber} (${order.id}); CBC test ${test.id} is READY; specimen ${specimen.accessionNumber} accepted`
  );

  await prisma.instrumentSampleLink.create({
    data: {
      labTenantId: lab.id,
      analyzerId: analyzer.id,
      sampleId: a['sample-id'],
      orderId: order.id,
      validFrom,
      validUntil,
      createdVia: 'MANUAL',
    },
  });
  console.log(
    `Link: analyzer sample "${a['sample-id']}" -> ${
      order.requisitionNumber
    }, valid ${validFrom.toISOString()} … ${validUntil.toISOString()}`
  );

  if (!a['no-credential']) {
    const prefix = randomBytes(4).toString('hex');
    const token = `kvc_${prefix}_${randomBytes(32).toString('base64url')}`;
    await prisma.connectorCredential.create({
      data: {
        labTenantId: lab.id,
        analyzerId: analyzer.id,
        name: 'dev connector',
        tokenPrefix: prefix,
        tokenHash: createHash('sha256').update(token).digest('hex'),
      },
    });
    if (a['token-file']) {
      writeFileSync(a['token-file'], token + '\n', { mode: 0o600 });
      console.log(
        `\nConnector token kvc_${prefix}_… written to ${a['token-file']} (owner-only). It exists nowhere else — keep it.`
      );
    } else {
      console.log(
        `\nConnector token (shown once — store it with: vh30-receiver --configure --api-url <url> --token <token>):\n${token}`
      );
    }
  }
} catch (err) {
  console.error(`Seed failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
