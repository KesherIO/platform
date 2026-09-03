/**
 * One-off: update FECAL_DIRECTO and FECAL_FLOTACION analytes
 * from TEXT → LONG_TEXT and expand options with quick phrases.
 *
 * Run:  node apps/api/prisma/seeds/patch-fecal-microscopy.mjs
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const options = [
  'Negativo',
  'No se observan parásitos ni huevos en la muestra analizada.',
  'Se observan escasos huevos de ...',
  'Se observan moderados huevos de ...',
  'Se observan abundantes huevos de ...',
  'Se observan trofozoitos compatibles con ...',
  'Se observan larvas compatibles con ...',
  'Se observan ooquistes compatibles con ...',
  'Flora bacteriana aumentada.',
  'Flora bacteriana dentro de los límites normales.',
];

async function main() {
  const codes = ['FECAL_DIRECTO', 'FECAL_FLOTACION'];

  const result = await prisma.resultTemplateAnalyte.updateMany({
    where: { code: { in: codes } },
    data: { valueType: 'LONG_TEXT', options },
  });

  console.log(`Updated ${result.count} analyte(s).`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
