/**
 * Standalone script — generates 6 sample PDFs for visual review.
 * Run: npx tsx apps/api/src/pdf/generate-samples.ts
 * Output: /tmp/pdf-samples/
 */
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import { PdfRendererService } from './pdf-renderer.service';
import type { ReleaseForPdf } from './pdf-renderer.service';

// ── Minimal PNG builder ───────────────────────────────────────────────────────

function makePng(
  width: number,
  height: number,
  fillRgb: [number, number, number]
): Buffer {
  const crcTable = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c;
  }
  const crc32 = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer): Buffer => {
    const t = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crcBuf]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // 8-bit RGB

  const row = 1 + width * 3;
  const raw = Buffer.alloc(height * row);
  const [r, g, b] = fillRgb;
  for (let y = 0; y < height; y++) {
    raw[y * row] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      raw[y * row + 1 + x * 3] = r;
      raw[y * row + 2 + x * 3] = g;
      raw[y * row + 3 + x * 3] = b;
    }
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Logo: 120×48 cyan solid (#06D6A0)
const LOGO_PNG = makePng(120, 48, [6, 214, 160]);
// Signer sig: 140×45 dark-grey solid (simulates ink on white)
const SIGNER_SIG_PNG = makePng(140, 45, [30, 30, 60]);
// Analyst sig: 140×45 medium-grey
const ANALYST_SIG_PNG = makePng(140, 45, [100, 110, 130]);

const OUT_DIR = '/tmp/pdf-samples';

// ── Shared base ──────────────────────────────────────────────────────────────

const BASE: Omit<
  ReleaseForPdf,
  'releaseType' | 'releaseSequence' | 'tests' | 'observations'
> = {
  id: 'sample-release-id',
  releasedAt: new Date('2026-09-29T10:30:00Z'),
  requisitionNumber: 'REQ-2026-0042',
  orderId: 'order-001',
  labName: 'BioLab Diagnóstico Veterinario',
  labAccreditationNumber: 'ACRED-COL-2024-1234',
  labDirectorName: 'Dr. Carlos Méndez',
  labDirectorCredentials: 'MV, MSc Patología Clínica',
  labAddress: 'Calle 90 #14-72',
  labCity: 'Bogotá D.C.',
  labPhones: [
    { label: 'WhatsApp', number: '+57 300 123 4567' },
    { label: 'Fijo', number: '+57 601 234 5678' },
  ],
  labEmail: 'resultados@biomet.co',
  reportDisclaimer:
    'Este reporte es de uso exclusivo del médico veterinario solicitante. Los resultados deben interpretarse en conjunto con el cuadro clínico del paciente. No constituye diagnóstico definitivo.',
  clinicName: 'Clínica Veterinaria El Prado',
  clinicAddress: 'Carrera 11 #85-42, Bogotá',
  clinicPhone: '+57 601 987 6543',
  patientName: 'Luna',
  patientSpecies: 'CANINE',
  patientSex: 'Hembra',
  patientBreed: 'Golden Retriever',
  patientAge: 4,
  patientAgeUnit: 'YEARS',
  ownerName: 'María García',
  ownerPhone: '+57 300 111 2222',
  orderPriority: 'ROUTINE',
  orderCreatedAt: new Date('2026-09-29T08:00:00Z'),
  orderClinicNotes: 'Paciente con decaimiento y poliuria desde hace 3 días.',
  signerName: 'Dra. Ana Rodríguez',
  signerTitle: 'Médico Veterinario Patólogo',
  signerSpecialty: 'Patología Clínica Veterinaria',
  signerUniversity: 'Universidad Nacional de Colombia',
  signerRegistrationNumber: 'MV-2015-00842',
  analystName: 'Dr. Jorge Patiño',
  analystTitle: 'Bacteriólogo',
  analystUniversity: 'Universidad de Antioquia',
  orderingVetName: 'Dr. Luis Hernández',
  orderingVetLicenseNumber: 'MV-2010-01523',
  reviewNotes: 'Resultados revisados. Correlacionar con clínica.',
  logoBuffer: null,
  signerSignatureBuffer: null,
  analystSignatureBuffer: null,
};

const CBC_ANALYTES: ReleaseForPdf['tests'][0]['analytes'] = [
  {
    name: 'Eritrocitos',
    sectionName: 'Serie Roja',
    sortOrder: 1,
    isHeader: false,
    valueType: 'NUMERIC',
    numericValue: 6.8,
    textValue: null,
    booleanValue: null,
    selectValue: null,
    unit: '×10⁶/µL',
    flag: 'H',
    referenceSnapshot: { min: 5.5, max: 8.5, displayText: '5.5–8.5' },
  },
  {
    name: 'Hemoglobina',
    sectionName: 'Serie Roja',
    sortOrder: 2,
    isHeader: false,
    valueType: 'NUMERIC',
    numericValue: 15.2,
    textValue: null,
    booleanValue: null,
    selectValue: null,
    unit: 'g/dL',
    flag: 'N',
    referenceSnapshot: { min: 12.0, max: 18.0, displayText: '12.0–18.0' },
  },
  {
    name: 'Hematocrito',
    sectionName: 'Serie Roja',
    sortOrder: 3,
    isHeader: false,
    valueType: 'NUMERIC',
    numericValue: 46,
    textValue: null,
    booleanValue: null,
    selectValue: null,
    unit: '%',
    flag: 'N',
    referenceSnapshot: { min: 37, max: 55, displayText: '37–55' },
  },
  {
    name: 'VCM',
    sectionName: 'Serie Roja',
    sortOrder: 4,
    isHeader: false,
    valueType: 'NUMERIC',
    numericValue: 67.6,
    textValue: null,
    booleanValue: null,
    selectValue: null,
    unit: 'fL',
    flag: 'N',
    referenceSnapshot: { min: 60, max: 77, displayText: '60–77' },
  },
  {
    name: 'HCM',
    sectionName: 'Serie Roja',
    sortOrder: 5,
    isHeader: false,
    valueType: 'NUMERIC',
    numericValue: 22.4,
    textValue: null,
    booleanValue: null,
    selectValue: null,
    unit: 'pg',
    flag: 'N',
    referenceSnapshot: { min: 19.5, max: 24.5, displayText: '19.5–24.5' },
  },
  {
    name: 'CHCM',
    sectionName: 'Serie Roja',
    sortOrder: 6,
    isHeader: false,
    valueType: 'NUMERIC',
    numericValue: 33.1,
    textValue: null,
    booleanValue: null,
    selectValue: null,
    unit: 'g/dL',
    flag: 'N',
    referenceSnapshot: { min: 31, max: 37, displayText: '31–37' },
  },
  {
    name: 'Leucocitos',
    sectionName: 'Serie Blanca',
    sortOrder: 7,
    isHeader: false,
    valueType: 'NUMERIC',
    numericValue: 18.4,
    textValue: null,
    booleanValue: null,
    selectValue: null,
    unit: '×10³/µL',
    flag: 'H',
    referenceSnapshot: { min: 6, max: 17, displayText: '6–17' },
  },
  {
    name: 'Neutrófilos Segmentados',
    sectionName: 'Serie Blanca',
    sortOrder: 8,
    isHeader: false,
    valueType: 'NUMERIC',
    numericValue: 12.9,
    textValue: null,
    booleanValue: null,
    selectValue: null,
    unit: '×10³/µL',
    flag: 'H',
    referenceSnapshot: { min: 3, max: 11.5, displayText: '3–11.5' },
  },
  {
    name: 'Linfocitos',
    sectionName: 'Serie Blanca',
    sortOrder: 9,
    isHeader: false,
    valueType: 'NUMERIC',
    numericValue: 3.7,
    textValue: null,
    booleanValue: null,
    selectValue: null,
    unit: '×10³/µL',
    flag: 'N',
    referenceSnapshot: { min: 1, max: 4.8, displayText: '1–4.8' },
  },
  {
    name: 'Monocitos',
    sectionName: 'Serie Blanca',
    sortOrder: 10,
    isHeader: false,
    valueType: 'NUMERIC',
    numericValue: 1.1,
    textValue: null,
    booleanValue: null,
    selectValue: null,
    unit: '×10³/µL',
    flag: 'N',
    referenceSnapshot: { min: 0.15, max: 1.35, displayText: '0.15–1.35' },
  },
  {
    name: 'Eosinófilos',
    sectionName: 'Serie Blanca',
    sortOrder: 11,
    isHeader: false,
    valueType: 'NUMERIC',
    numericValue: 0.5,
    textValue: null,
    booleanValue: null,
    selectValue: null,
    unit: '×10³/µL',
    flag: 'N',
    referenceSnapshot: { min: 0.1, max: 1.25, displayText: '0.1–1.25' },
  },
  {
    name: 'Plaquetas',
    sectionName: 'Plaquetas',
    sortOrder: 12,
    isHeader: false,
    valueType: 'NUMERIC',
    numericValue: 245,
    textValue: null,
    booleanValue: null,
    selectValue: null,
    unit: '×10³/µL',
    flag: 'N',
    referenceSnapshot: { min: 200, max: 500, displayText: '200–500' },
  },
  {
    name: 'Morfología eritrocitaria: Anisocitosis leve. Sin hallazgos significativos en la morfología leucocitaria.',
    sectionName: null,
    sortOrder: 13,
    isHeader: false,
    valueType: 'TEXT',
    numericValue: null,
    textValue:
      'Anisocitosis leve. Sin hallazgos significativos en la morfología leucocitaria.',
    booleanValue: null,
    selectValue: null,
    unit: null,
    flag: null,
    referenceSnapshot: null,
  },
];

const CHEM_ANALYTES: ReleaseForPdf['tests'][0]['analytes'] = [
  {
    name: 'Glucosa',
    sectionName: 'Metabolismo',
    sortOrder: 1,
    isHeader: false,
    valueType: 'NUMERIC',
    numericValue: 95,
    textValue: null,
    booleanValue: null,
    selectValue: null,
    unit: 'mg/dL',
    flag: 'N',
    referenceSnapshot: { min: 65, max: 118, displayText: '65–118' },
  },
  {
    name: 'Urea (BUN)',
    sectionName: 'Función Renal',
    sortOrder: 2,
    isHeader: false,
    valueType: 'NUMERIC',
    numericValue: 38,
    textValue: null,
    booleanValue: null,
    selectValue: null,
    unit: 'mg/dL',
    flag: 'H',
    referenceSnapshot: { min: 7, max: 27, displayText: '7–27' },
  },
  {
    name: 'Creatinina',
    sectionName: 'Función Renal',
    sortOrder: 3,
    isHeader: false,
    valueType: 'NUMERIC',
    numericValue: 1.9,
    textValue: null,
    booleanValue: null,
    selectValue: null,
    unit: 'mg/dL',
    flag: 'H',
    referenceSnapshot: { min: 0.5, max: 1.5, displayText: '0.5–1.5' },
  },
  {
    name: 'Fósforo',
    sectionName: 'Función Renal',
    sortOrder: 4,
    isHeader: false,
    valueType: 'NUMERIC',
    numericValue: 5.2,
    textValue: null,
    booleanValue: null,
    selectValue: null,
    unit: 'mg/dL',
    flag: 'H',
    referenceSnapshot: { min: 2.5, max: 5, displayText: '2.5–5.0' },
  },
  {
    name: 'ALT (GPT)',
    sectionName: 'Función Hepática',
    sortOrder: 5,
    isHeader: false,
    valueType: 'NUMERIC',
    numericValue: 54,
    textValue: null,
    booleanValue: null,
    selectValue: null,
    unit: 'U/L',
    flag: 'N',
    referenceSnapshot: { min: 10, max: 100, displayText: '10–100' },
  },
  {
    name: 'AST (GOT)',
    sectionName: 'Función Hepática',
    sortOrder: 6,
    isHeader: false,
    valueType: 'NUMERIC',
    numericValue: 38,
    textValue: null,
    booleanValue: null,
    selectValue: null,
    unit: 'U/L',
    flag: 'N',
    referenceSnapshot: { min: 0, max: 50, displayText: '0–50' },
  },
  {
    name: 'Fosfatasa Alcalina',
    sectionName: 'Función Hepática',
    sortOrder: 7,
    isHeader: false,
    valueType: 'NUMERIC',
    numericValue: 142,
    textValue: null,
    booleanValue: null,
    selectValue: null,
    unit: 'U/L',
    flag: 'H',
    referenceSnapshot: { min: 0, max: 130, displayText: '0–130' },
  },
  {
    name: 'Proteínas Totales',
    sectionName: 'Proteínas',
    sortOrder: 8,
    isHeader: false,
    valueType: 'NUMERIC',
    numericValue: 6.8,
    textValue: null,
    booleanValue: null,
    selectValue: null,
    unit: 'g/dL',
    flag: 'N',
    referenceSnapshot: { min: 5.4, max: 7.5, displayText: '5.4–7.5' },
  },
  {
    name: 'Albúmina',
    sectionName: 'Proteínas',
    sortOrder: 9,
    isHeader: false,
    valueType: 'NUMERIC',
    numericValue: 3.1,
    textValue: null,
    booleanValue: null,
    selectValue: null,
    unit: 'g/dL',
    flag: 'N',
    referenceSnapshot: { min: 2.6, max: 4, displayText: '2.6–4.0' },
  },
  {
    name: 'Globulinas',
    sectionName: 'Proteínas',
    sortOrder: 10,
    isHeader: false,
    valueType: 'NUMERIC',
    numericValue: 3.7,
    textValue: null,
    booleanValue: null,
    selectValue: null,
    unit: 'g/dL',
    flag: 'N',
    referenceSnapshot: { min: 2, max: 3.9, displayText: '2.0–3.9' },
  },
];

// ── 1. Partial release — CBC only, chemistry pending ─────────────────────────

const PARTIAL: ReleaseForPdf = {
  ...BASE,
  releaseType: 'PARTIAL',
  releaseSequence: 1,
  observations:
    'Leucocitosis con neutrofilia. Elevación leve de parámetros renales. Se sugiere correlacionar con función renal completa (pendiente).',
  tests: [
    {
      catalogItemName: 'Hemograma Completo',
      catalogItemCode: 'CBC',
      department: 'HEMATOLOGY',
      specimenTypes: ['Sangre EDTA'],
      specimenAccessionNumbers: ['ACC-2026-0892'],
      observations: 'Leucocitosis neutrofílica. Morfología normal.',
      analytes: CBC_ANALYTES,
    },
  ],
};

// ── 2. Final release — chemistry added ───────────────────────────────────────

const FINAL: ReleaseForPdf = {
  ...BASE,
  releaseType: 'FINAL',
  releaseSequence: 2,
  observations:
    'Perfil bioquímico con hallazgos compatibles con enfermedad renal crónica estadio IRIS 2. Se recomienda seguimiento con uroanálisis.',
  tests: [
    {
      catalogItemName: 'Química Sanguínea',
      catalogItemCode: 'CHEM-14',
      department: 'CHEMISTRY',
      specimenTypes: ['Suero'],
      specimenAccessionNumbers: ['ACC-2026-0893'],
      observations: null,
      analytes: CHEM_ANALYTES,
    },
  ],
};

// ── 3. Amendment — corrected creatinine ──────────────────────────────────────

const AMENDMENT: ReleaseForPdf = {
  ...BASE,
  releaseType: 'AMENDMENT',
  releaseSequence: 3,
  observations:
    'Enmienda: corrección de valor de creatinina en química sanguínea del release #2. Error de transcripción identificado durante auditoría interna.',
  tests: [
    {
      catalogItemName: 'Química Sanguínea (Enmienda)',
      catalogItemCode: 'CHEM-14',
      department: 'CHEMISTRY',
      specimenTypes: ['Suero'],
      specimenAccessionNumbers: ['ACC-2026-0893'],
      observations:
        'Corrección: Creatinina corregida de 1.9 a 1.4 mg/dL. Valor anterior fue reportado incorrectamente.',
      analytes: CHEM_ANALYTES.map((a) =>
        a.name === 'Creatinina' ? { ...a, numericValue: 1.4, flag: 'N' } : a
      ),
    },
  ],
};

// ── 4. Sparse — minimal fields ───────────────────────────────────────────────

const SPARSE: ReleaseForPdf = {
  ...BASE,
  labAccreditationNumber: null,
  labDirectorName: null,
  labDirectorCredentials: null,
  labAddress: null,
  labCity: null,
  labPhones: [],
  labEmail: null,
  clinicAddress: null,
  clinicPhone: null,
  patientSex: null,
  patientBreed: null,
  patientAge: null,
  patientAgeUnit: null,
  ownerPhone: null,
  analystName: null,
  analystTitle: null,
  analystUniversity: null,
  orderingVetName: null,
  orderingVetLicenseNumber: null,
  orderClinicNotes: null,
  reportDisclaimer: null,
  reviewNotes: null,
  releaseType: 'FINAL',
  releaseSequence: 1,
  observations: null,
  tests: [
    {
      catalogItemName: 'Glucosa',
      catalogItemCode: 'GLU',
      department: 'CHEMISTRY',
      specimenTypes: [],
      specimenAccessionNumbers: [],
      observations: null,
      analytes: [
        {
          name: 'Glucosa',
          sectionName: null,
          sortOrder: 1,
          isHeader: false,
          valueType: 'NUMERIC',
          numericValue: 95,
          textValue: null,
          booleanValue: null,
          selectValue: null,
          unit: 'mg/dL',
          flag: 'N',
          referenceSnapshot: { min: 65, max: 118, displayText: '65–118' },
        },
      ],
    },
  ],
};

// ── 5. Multi-page — 30+ analytes across 3 tests ──────────────────────────────

const makeAnalytes = (
  prefix: string,
  count: number,
  offset = 0
): ReleaseForPdf['tests'][0]['analytes'] =>
  Array.from({ length: count }, (_, i) => ({
    name: `${prefix} ${i + 1 + offset}`,
    sectionName: i < count / 2 ? 'Panel A' : 'Panel B',
    sortOrder: i + 1 + offset,
    isHeader: false,
    valueType: 'NUMERIC' as const,
    numericValue: parseFloat((Math.random() * 100 + 10).toFixed(1)),
    textValue: null,
    booleanValue: null,
    selectValue: null,
    unit: 'U/L',
    flag: i % 5 === 0 ? 'H' : i % 7 === 0 ? 'L' : 'N',
    referenceSnapshot: { min: 10, max: 100, displayText: '10–100' },
  }));

const MULTIPAGE: ReleaseForPdf = {
  ...BASE,
  releaseType: 'FINAL',
  releaseSequence: 1,
  observations:
    'Perfil extendido completo. Múltiples parámetros evaluados. Revisar valores marcados con H/L. Hallazgos compatibles con estado inflamatorio sistémico.',
  tests: [
    {
      catalogItemName: 'Hemograma Completo Extendido',
      catalogItemCode: 'CBC-EXT',
      department: 'HEMATOLOGY',
      specimenTypes: ['Sangre EDTA'],
      specimenAccessionNumbers: ['ACC-2026-0900'],
      observations: 'Leucocitosis leve. Sin blastos.',
      analytes: [
        ...CBC_ANALYTES,
        ...makeAnalytes('Parámetro Hematológico', 8, 14),
      ],
    },
    {
      catalogItemName: 'Química Sanguínea Extendida',
      catalogItemCode: 'CHEM-28',
      department: 'CHEMISTRY',
      specimenTypes: ['Suero'],
      specimenAccessionNumbers: ['ACC-2026-0901'],
      observations: null,
      analytes: [...CHEM_ANALYTES, ...makeAnalytes('Enzima Sérica', 12, 10)],
    },
    {
      catalogItemName: 'Panel de Electrolitos y Gases',
      catalogItemCode: 'ELEC',
      department: 'CHEMISTRY',
      specimenTypes: ['Sangre Heparinizada'],
      specimenAccessionNumbers: ['ACC-2026-0902'],
      observations: 'Equilibrio ácido-base dentro de límites normales.',
      analytes: makeAnalytes('Electrolito', 12),
    },
  ],
};

// ── 6. Image-embedded — logo + both signatures as real PNG buffers ────────────

const WITH_IMAGES: ReleaseForPdf = {
  ...BASE,
  logoBuffer: LOGO_PNG,
  signerSignatureBuffer: SIGNER_SIG_PNG,
  analystSignatureBuffer: ANALYST_SIG_PNG,
  releaseType: 'FINAL',
  releaseSequence: 1,
  observations:
    'Muestra con imágenes embebidas. Verificar: logotipo en cabecera, firma del analista a la izquierda, firma del revisor a la derecha.',
  tests: [
    {
      catalogItemName: 'Hemograma Completo',
      catalogItemCode: 'CBC',
      department: 'HEMATOLOGY',
      specimenTypes: ['Sangre EDTA'],
      specimenAccessionNumbers: ['ACC-2026-0999'],
      observations: null,
      analytes: CBC_ANALYTES,
    },
  ],
};

// ── 7. Culture — text results with template spacer/header rows ───────────────

const txt = (
  name: string,
  sortOrder: number,
  textValue: string | null,
  isHeader = false
): ReleaseForPdf['tests'][0]['analytes'][0] => ({
  name,
  sectionName: 'Resultados',
  sortOrder,
  isHeader,
  valueType: 'TEXT',
  numericValue: null,
  textValue,
  booleanValue: null,
  selectValue: null,
  unit: null,
  flag: null,
  referenceSnapshot: null,
});

const CULTURE: ReleaseForPdf = {
  ...BASE,
  logoBuffer: LOGO_PNG,
  releaseType: 'FINAL',
  releaseSequence: 1,
  observations: null,
  reportDisclaimer: 'Nota en el footer del resultado',
  tests: [
    {
      catalogItemName: 'Cultivo y Antibiograma',
      catalogItemCode: 'CULTURE',
      department: 'MICROBIOLOGY',
      specimenTypes: [],
      specimenAccessionNumbers: [],
      observations: 'Tipo de muestra: general.',
      analytes: [
        txt('Gram', 0, 'NEGATIVE'),
        txt('-', 1, null, true),
        txt('Cultivo', 2, 'Escherichia coli > 100.000 UFC/mL'),
        txt('-', 3, null, true),
        txt('ANTIBIOGRAMA', 4, null, true),
        txt('-', 5, null, true),
        txt(
          'Sensible',
          6,
          'Amoxicilina/ácido clavulánico, Enrofloxacina, Gentamicina, Ceftriaxona'
        ),
        txt('-', 7, null, true),
        txt('Resistente', 8, 'Ampicilina, Trimetoprim/sulfametoxazol'),
      ],
    },
  ],
};

// ── Runner ────────────────────────────────────────────────────────────────────

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const renderer = new PdfRendererService();

  const samples: Array<[string, ReleaseForPdf]> = [
    ['1-partial.pdf', PARTIAL],
    ['2-final.pdf', FINAL],
    ['3-amendment.pdf', AMENDMENT],
    ['4-sparse.pdf', SPARSE],
    ['5-multipage.pdf', MULTIPAGE],
    ['6-with-images.pdf', WITH_IMAGES],
    ['7-culture.pdf', CULTURE],
  ];

  for (const [filename, data] of samples) {
    const buffer = await renderer.render(data);
    const outPath = path.join(OUT_DIR, filename);
    fs.writeFileSync(outPath, buffer);
    console.log(`✓  ${outPath}  (${(buffer.length / 1024).toFixed(0)} KB)`);
  }

  console.log(`\nOpen all: open ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
