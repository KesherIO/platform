/**
 * Seed script: creates a released CBC result report for Dominique's case.
 * Run with: node apps/api/prisma/seeds/seed-mock-result.mjs
 */

import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient();

const CASE_ID  = 'cmok9n2700003ljs5tcdrwlbc';
const ORDER_ID = 'cmok9rva70005ljs5dv99bc5x';
const TENANT_ID = 'cmnja2z0v0001ljircyhpc3lf';
const RELEASED_BY_USER_ID = 'b6ea573b-8964-46f6-95c7-b8d8da95ce09';

// Realistic CBC values — mild anemia matching Dominique's parasitic anorexia presentation
const VALUES = {
  RBC:     { num: 4.8,  flag: 'L' },
  HGB:     { num: 10.2, flag: 'L' },
  HCT:     { num: 30.5, flag: 'L' },
  MCV:     { num: 63.5, flag: 'N' },
  MCH:     { num: 21.3, flag: 'N' },
  MCHC:    { num: 33.4, flag: 'N' },
  WBC:     { num: 14.2, flag: 'N' },
  NEU_PCT: { num: 75,   flag: 'N' },
  NEU:     { num: 10.7, flag: 'N' },
  LYM_PCT: { num: 17,   flag: 'N' },
  LYM:     { num: 2.4,  flag: 'N' },
  MON_PCT: { num: 6,    flag: 'N' },
  MON:     { num: 0.85, flag: 'N' },
  EOS_PCT: { num: 2,    flag: 'N' },
  EOS:     { num: 0.28, flag: 'N' },
  BAS_PCT: { num: 0,    flag: 'N' },
  BAS:     { num: 0,    flag: 'N' },
  BAND_PCT:{ num: 0,    flag: 'N' },
  BAND:    { num: 0,    flag: 'N' },
  PLT:     { num: 312,  flag: 'N' },
  MPV:     { num: 8.4,  flag: 'N' },
  TP:      { num: 62,   flag: 'N' },
};

async function main() {
  // 1. Find the HEMOGRAMA catalog item
  const catalogItem = await prisma.catalogItem.findFirst({
    where: { code: 'HEMOGRAMA' },
  });
  if (!catalogItem) throw new Error('HEMOGRAMA catalog item not found.');
  console.log(`Found catalog item: ${catalogItem.name} (${catalogItem.id})`);

  // 2. Upsert the CBC template (sections + analytes)
  let template = await prisma.resultTemplate.findFirst({
    where: { catalogItemId: catalogItem.id, species: 'DOG' },
    include: { sections: { include: { analytes: true } } },
  });

  if (!template) {
    const tplJson = JSON.parse(
      readFileSync(join(__dirname, 'templates/cbc-dog-adult.json'), 'utf8')
    );

    // Create template first (no analytes yet)
    const tpl = await prisma.resultTemplate.create({
      data: {
        catalogItemId: catalogItem.id,
        species: 'DOG',
        title: tplJson.title,
        defaultObservations: tplJson.defaultObservations,
        version: 1,
        isActive: true,
      },
    });

    // Create sections + analytes separately so templateId is available
    for (const s of tplJson.sections) {
      const section = await prisma.resultTemplateSection.create({
        data: { templateId: tpl.id, name: s.name, sortOrder: s.sortOrder },
      });
      for (let i = 0; i < s.analytes.length; i++) {
        const a = s.analytes[i];
        await prisma.resultTemplateAnalyte.create({
          data: {
            templateId: tpl.id,
            sectionId: section.id,
            code: a.code,
            name: a.name,
            technique: a.technique ?? null,
            formula: a.formula ?? null,
            valueType: a.valueType,
            unit: a.unit ?? null,
            options: [],
            sortOrder: s.sortOrder * 100 + i,
            isHeader: a.isHeader ?? false,
            referenceRange: a.referenceRange ?? null,
          },
        });
      }
    }

    template = await prisma.resultTemplate.findUniqueOrThrow({
      where: { id: tpl.id },
      include: { sections: { include: { analytes: true } } },
    });
    console.log(`Created template: ${template.title} (${template.id})`);
  } else {
    console.log(`Template already exists: ${template.title} (${template.id})`);
  }

  // 3. Skip if report already exists
  const existing = await prisma.resultReport.findFirst({ where: { orderId: ORDER_ID } });
  if (existing) {
    console.log(`Report already exists (${existing.id}), skipping.`);
  } else {
    // 4. Flatten analytes from sections for the report rows
    const allAnalytes = template.sections.flatMap((s) =>
      s.analytes.map((a) => ({ ...a, sectionName: s.name }))
    );

    const analyteRows = allAnalytes.map((a) => {
      const val = VALUES[a.code];
      return {
        templateAnalyteId: a.id,
        code: a.code,
        name: a.name,
        technique: a.technique,
        unit: a.unit,
        valueType: a.valueType,
        sectionName: a.sectionName,
        sortOrder: a.sortOrder,
        isHeader: a.isHeader,
        numericValue: val?.num ?? null,
        flag: a.isHeader ? null : (val?.flag ?? null),
        referenceSnapshot: a.referenceRange ?? null,
      };
    });

    const report = await prisma.resultReport.create({
      data: {
        orderId: ORDER_ID,
        caseId: CASE_ID,
        tenantId: TENANT_ID,
        templateId: template.id,
        status: 'RELEASED',
        observations:
          'Tipo de muestra: sangre entera anticoagulada con EDTA. Se observa anemia normocítica normocrómica leve, compatible con anemia por enfermedad crónica o infestación parasitaria severa. Leucograma dentro de límites normales. Plaquetas normales.',
        processedByName: 'Vivian Andrea Plialonga Quintero',
        processedByRole: 'Analista de Laboratorio',
        processedByCredentials: 'Microbióloga — Universidad Santiago de Cali',
        approvedByName: 'Carlos Alberto Canaval Ocampo',
        approvedByRole: 'Jefe de Bacteriología y Laboratorio Clínico',
        approvedByCredentials:
          'Bacteriólogo y Laboratorista Clínico — Universidad del Valle — Registro No. 767658',
        releasedAt: new Date(),
        releasedByUserId: RELEASED_BY_USER_ID,
        analytes: { create: analyteRows },
      },
    });
    console.log(`Created report: ${report.id}`);
  }

  // 5. Mark the case and order as COMPLETED
  await prisma.case.update({ where: { id: CASE_ID }, data: { status: 'COMPLETED' } });
  await prisma.order.update({
    where: { id: ORDER_ID },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });
  console.log('Case and order marked COMPLETED. Done!');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
