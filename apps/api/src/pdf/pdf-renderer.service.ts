import { Injectable } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const _pdfkit = require('pdfkit');
const PDFDocument: typeof import('pdfkit') = _pdfkit.default ?? _pdfkit;

export interface ReleaseForPdf {
  id: string;
  releaseSequence: number;
  releaseType: string;
  releasedAt: Date;
  requisitionNumber: string;
  orderId: string;
  labName: string;
  labAccreditationNumber: string | null;
  labDirectorName: string | null;
  labDirectorCredentials: string | null;
  labAddress: string | null;
  labCity: string | null;
  labPhones: Array<{ label: string; number: string }>;
  labEmail: string | null;
  reportDisclaimer: string | null;
  clinicName: string;
  clinicAddress: string | null;
  clinicPhone: string | null;
  patientName: string;
  patientSpecies: string;
  patientSex: string | null;
  patientBreed: string | null;
  patientAge: number | null;
  patientAgeUnit: string | null;
  ownerName: string;
  ownerPhone: string | null;
  orderPriority: string;
  orderCreatedAt: Date;
  orderClinicNotes: string | null;
  signerName: string;
  signerTitle: string | null;
  signerSpecialty: string | null;
  signerUniversity: string | null;
  signerRegistrationNumber: string | null;
  analystName: string | null;
  analystTitle: string | null;
  analystUniversity: string | null;
  orderingVetName: string | null;
  orderingVetLicenseNumber: string | null;
  observations: string | null;
  reviewNotes: string | null;
  logoBuffer: Buffer | null;
  signerSignatureBuffer: Buffer | null;
  analystSignatureBuffer: Buffer | null;
  tests: Array<{
    catalogItemName: string;
    catalogItemCode: string | null;
    department: string | null;
    specimenTypes: string[];
    specimenAccessionNumbers: string[];
    observations: string | null;
    analytes: Array<{
      name: string;
      sectionName: string | null;
      sortOrder: number;
      isHeader: boolean;
      valueType: string;
      numericValue: number | null;
      textValue: string | null;
      booleanValue: boolean | null;
      selectValue: string | null;
      unit: string | null;
      flag: string | null;
      referenceSnapshot: {
        displayText?: string;
        min?: number;
        max?: number;
      } | null;
    }>;
  }>;
}

type Doc = InstanceType<typeof PDFDocument>;

const MARGIN = 40;
// Space reserved at the bottom of every page for the lab footer + page number:
// name, address · city, phones, email
const FOOTER_HEIGHT = 64;
const CYAN = '#06D6A0';
const DARK = '#1a1a2e';
const GRAY = '#6b7280';
const LIGHT_GRAY = '#f3f4f6';
const RULE = '#e5e7eb';

const SPECIES: Record<string, string> = {
  CANINE: 'Canino',
  FELINE: 'Felino',
  AVIAN: 'Aviar',
  BIRD: 'Ave',
  BOVINE: 'Bovino',
  EQUINE: 'Equino',
  CAPRINE: 'Caprino',
  OVINE: 'Ovino',
  RABBIT: 'Conejo',
  RODENT: 'Roedor',
};
const SEX: Record<string, string> = { MALE: 'Macho', FEMALE: 'Hembra' };
const AGE_UNITS: Record<string, string> = {
  YEARS: 'años',
  MONTHS: 'meses',
  WEEKS: 'semanas',
  DAYS: 'días',
  HOURS: 'horas',
};
const PRIORITIES: Record<string, string> = {
  ROUTINE: 'Rutina',
  URGENT: 'Urgente',
  STAT: 'STAT',
  NORMAL: 'Normal',
};

type Analyte = ReleaseForPdf['tests'][number]['analytes'][number];

function displayValue(a: Analyte): string {
  switch (a.valueType) {
    case 'NUMERIC':
      return a.numericValue != null ? String(a.numericValue) : '—';
    case 'TEXT':
    case 'LONG_TEXT':
      return a.textValue || '—';
    case 'SELECT':
      return a.selectValue || '—';
    case 'POSITIVE_NEGATIVE':
      return a.booleanValue === true
        ? 'Positivo'
        : a.booleanValue === false
        ? 'Negativo'
        : '—';
    default:
      return '—';
  }
}

@Injectable()
export class PdfRendererService {
  async render(data: ReleaseForPdf): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const doc: Doc = new PDFDocument({
        size: 'A4',
        margins: {
          top: MARGIN,
          left: MARGIN,
          right: MARGIN,
          bottom: MARGIN + FOOTER_HEIGHT,
        },
        bufferPages: true,
        info: {
          Title: `Lab Report - ${data.requisitionNumber} - Release #${data.releaseSequence}`,
          Author: data.labName,
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const PAGE_WIDTH = doc.page.width - MARGIN * 2;
      const LEFT = MARGIN;
      const contentBottom = () => doc.page.height - MARGIN - FOOTER_HEIGHT;

      /** Start a new page if the next block of `height` points would not fit. */
      const ensureSpace = (height: number): boolean => {
        if (doc.y + height <= contentBottom()) return false;
        doc.addPage();
        return true;
      };

      const rule = (color = RULE, width = 0.5) => {
        doc
          .moveTo(LEFT, doc.y)
          .lineTo(LEFT + PAGE_WIDTH, doc.y)
          .strokeColor(color)
          .lineWidth(width)
          .stroke();
      };

      this.drawHeader(doc, data, LEFT, PAGE_WIDTH);
      this.drawPatientAndOrder(doc, data, LEFT, PAGE_WIDTH);

      // ── Tests ────────────────────────────────────────────────────────────
      for (const test of data.tests) {
        this.drawTest(doc, test, LEFT, PAGE_WIDTH, ensureSpace);
        doc.y += 6;
        rule(RULE, 0.3);
        doc.y += 8;
      }

      // ── General observations ──────────────────────────────────────────────
      if (data.observations) {
        doc.font('Helvetica').fontSize(8);
        ensureSpace(
          14 + doc.heightOfString(data.observations, { width: PAGE_WIDTH })
        );
        doc
          .font('Helvetica-Bold')
          .fontSize(7)
          .fillColor(GRAY)
          .text('OBSERVACIONES GENERALES:', LEFT, doc.y);
        doc
          .font('Helvetica')
          .fontSize(8)
          .fillColor(DARK)
          .text(data.observations, LEFT, doc.y + 2, { width: PAGE_WIDTH });
        doc.y += 8;
      }

      // ── Report note (lab disclaimer) — goes before the signatures ────────
      if (data.reportDisclaimer) {
        doc.font('Helvetica-Oblique').fontSize(7);
        ensureSpace(
          doc.heightOfString(data.reportDisclaimer, { width: PAGE_WIDTH }) + 8
        );
        doc
          .fillColor(GRAY)
          .text(data.reportDisclaimer, LEFT, doc.y, { width: PAGE_WIDTH });
        doc.y += 8;
      }

      // ── Signatures ──────────────────────────────────────────────────────
      ensureSpace(110);
      doc.y += 10;

      const sigColW = PAGE_WIDTH / 2 - 20;
      const sigTopY = doc.y;
      // Signature images sit above the line; reserve the same space in both
      // columns so the lines stay aligned.
      const hasAnySignature = !!(
        data.signerSignatureBuffer ||
        (data.analystName && data.analystSignatureBuffer)
      );
      const lineY = hasAnySignature ? sigTopY + 35 : sigTopY + 20;

      let analystBottom = sigTopY;
      if (data.analystName) {
        analystBottom = this.drawSigner(doc, {
          x: LEFT,
          width: sigColW,
          topY: sigTopY,
          lineY,
          signature: data.analystSignatureBuffer,
          name: data.analystName,
          details: [data.analystTitle, data.analystUniversity],
          role: 'ANALISTA',
        });
      }
      const signerBottom = this.drawSigner(doc, {
        x: LEFT + sigColW + 40,
        width: sigColW,
        topY: sigTopY,
        lineY,
        signature: data.signerSignatureBuffer,
        name: data.signerName,
        details: [
          data.signerTitle,
          data.signerSpecialty,
          data.signerUniversity,
          data.signerRegistrationNumber
            ? `Reg: ${data.signerRegistrationNumber}`
            : null,
        ],
        role: 'REVISOR',
      });
      doc.y = Math.max(analystBottom, signerBottom);

      // ── Lab footer + page numbers on every page ─────────────────────────
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        this.drawFooter(doc, data, LEFT, PAGE_WIDTH, i + 1, range.count);
      }

      doc.end();
    });
  }

  /** Clinic branding on the left, report type / sequence / date on the right. */
  private drawHeader(
    doc: Doc,
    data: ReleaseForPdf,
    LEFT: number,
    PAGE_WIDTH: number
  ) {
    const headerY = doc.page.margins.top;
    const LOGO = 48;
    const RIGHT_W = 140;

    let logoDrawn = false;
    if (data.logoBuffer) {
      try {
        doc.image(data.logoBuffer, LEFT, headerY, { fit: [LOGO, LOGO] });
        logoDrawn = true;
      } catch {
        /* skip if image fails */
      }
    }

    const textLeft = logoDrawn ? LEFT + LOGO + 10 : LEFT;
    const textWidth = PAGE_WIDTH - (textLeft - LEFT) - RIGHT_W - 10;
    doc
      .font('Helvetica-Bold')
      .fontSize(14)
      .fillColor(DARK)
      .text(data.clinicName, textLeft, headerY, { width: textWidth });
    doc.font('Helvetica').fontSize(8).fillColor(GRAY);
    for (const line of [data.clinicAddress, data.clinicPhone]) {
      if (line) doc.text(line, textLeft, doc.y + 1, { width: textWidth });
    }
    const leftBottom = Math.max(doc.y, logoDrawn ? headerY + LOGO : 0);

    const badgeText =
      data.releaseType === 'FINAL'
        ? 'REPORTE FINAL'
        : data.releaseType === 'AMENDMENT'
        ? 'ENMIENDA'
        : 'REPORTE PARCIAL';
    const badgeColor =
      data.releaseType === 'FINAL'
        ? '#16a34a'
        : data.releaseType === 'AMENDMENT'
        ? '#dc2626'
        : '#d97706';
    const rightX = LEFT + PAGE_WIDTH - RIGHT_W;
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(badgeColor)
      .text(badgeText, rightX, headerY, { width: RIGHT_W, align: 'right' });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor(GRAY)
      .text(`Informe #${data.releaseSequence}`, rightX, doc.y + 1, {
        width: RIGHT_W,
        align: 'right',
      })
      .text(
        new Date(data.releasedAt).toLocaleDateString('es-CO', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
        rightX,
        doc.y + 1,
        { width: RIGHT_W, align: 'right' }
      );

    doc.y = Math.max(doc.y, leftBottom) + 8;
    doc
      .moveTo(LEFT, doc.y)
      .lineTo(LEFT + PAGE_WIDTH, doc.y)
      .strokeColor(CYAN)
      .lineWidth(1.5)
      .stroke();
    doc.y += 8;
  }

  private drawPatientAndOrder(
    doc: Doc,
    data: ReleaseForPdf,
    LEFT: number,
    PAGE_WIDTH: number
  ) {
    const colW = PAGE_WIDTH / 2 - 10;
    const rightCol = LEFT + colW + 20;
    const infoTop = doc.y;

    const column = (left: number, title: string, lines: string[]) => {
      doc
        .font('Helvetica-Bold')
        .fontSize(7)
        .fillColor(GRAY)
        .text(title, left, infoTop, { width: colW });
      doc.font('Helvetica').fontSize(8).fillColor(DARK);
      doc.y += 2;
      for (const line of lines) doc.text(line, left, doc.y, { width: colW });
      return doc.y;
    };

    const speciesLine = [
      SPECIES[data.patientSpecies] ?? data.patientSpecies,
      data.patientBreed,
      data.patientSex ? SEX[data.patientSex] : null,
    ]
      .filter(Boolean)
      .join(' · ');
    const patientLines = [
      `Paciente: ${data.patientName}`,
      `Especie: ${speciesLine}`,
    ];
    if (data.patientAge != null)
      patientLines.push(
        `Edad: ${data.patientAge} ${
          AGE_UNITS[data.patientAgeUnit ?? ''] ?? data.patientAgeUnit ?? ''
        }`.trim()
      );
    patientLines.push(
      `Propietario: ${data.ownerName}${
        data.ownerPhone ? ` · ${data.ownerPhone}` : ''
      }`
    );

    const orderLines = [`Requisición: ${data.requisitionNumber}`];
    if (data.orderingVetName)
      orderLines.push(
        `Veterinario: ${data.orderingVetName}${
          data.orderingVetLicenseNumber
            ? ` (${data.orderingVetLicenseNumber})`
            : ''
        }`
      );
    orderLines.push(
      `Prioridad: ${PRIORITIES[data.orderPriority] ?? data.orderPriority}`
    );
    if (data.orderClinicNotes)
      orderLines.push(`Notas: ${data.orderClinicNotes}`);

    const leftBottom = column(LEFT, 'DATOS DEL PACIENTE', patientLines);
    const rightBottom = column(rightCol, 'DATOS DE LA ORDEN', orderLines);

    doc.y = Math.max(leftBottom, rightBottom) + 10;
    doc
      .moveTo(LEFT, doc.y)
      .lineTo(LEFT + PAGE_WIDTH, doc.y)
      .strokeColor(RULE)
      .lineWidth(0.5)
      .stroke();
    doc.y += 10;
  }

  private drawTest(
    doc: Doc,
    test: ReleaseForPdf['tests'][number],
    LEFT: number,
    PAGE_WIDTH: number,
    ensureSpace: (height: number) => boolean
  ) {
    const COL = {
      name: { x: LEFT + 4, w: PAGE_WIDTH * 0.38 - 8 },
      val: { x: LEFT + PAGE_WIDTH * 0.38, w: PAGE_WIDTH * 0.27 - 6 },
      unit: { x: LEFT + PAGE_WIDTH * 0.65, w: PAGE_WIDTH * 0.12 - 6 },
      ref: { x: LEFT + PAGE_WIDTH * 0.77, w: PAGE_WIDTH * 0.23 - 4 },
    };

    const columnHeaders = () => {
      const y = doc.y;
      doc.font('Helvetica-Bold').fontSize(7).fillColor(GRAY);
      doc.text('Analito', COL.name.x, y, {
        width: COL.name.w,
        lineBreak: false,
      });
      doc.text('Resultado', COL.val.x, y, {
        width: COL.val.w,
        lineBreak: false,
      });
      doc.text('Unidad', COL.unit.x, y, {
        width: COL.unit.w,
        lineBreak: false,
      });
      doc.text('Referencia', COL.ref.x, y, {
        width: COL.ref.w,
        lineBreak: false,
      });
      doc.y = y + 11;
      doc
        .moveTo(LEFT, doc.y)
        .lineTo(LEFT + PAGE_WIDTH, doc.y)
        .strokeColor(RULE)
        .lineWidth(0.3)
        .stroke();
      doc.y += 4;
    };

    // Keep the test title together with its column headers and first rows
    ensureSpace(70);

    // Title bar: test name on the left, catalog code on the right
    const barY = doc.y;
    doc.fillColor(LIGHT_GRAY).rect(LEFT, barY, PAGE_WIDTH, 18).fill();
    doc
      .font('Helvetica-Bold')
      .fontSize(9)
      .fillColor(DARK)
      .text(test.catalogItemName, LEFT + 6, barY + 5, {
        width: PAGE_WIDTH * 0.7,
        lineBreak: false,
        ellipsis: true,
      });
    if (test.catalogItemCode) {
      doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor(GRAY)
        .text(test.catalogItemCode, LEFT, barY + 6, {
          width: PAGE_WIDTH - 6,
          align: 'right',
          lineBreak: false,
        });
    }
    doc.y = barY + 22;

    if (test.specimenAccessionNumbers.length > 0) {
      const specimen = [
        test.specimenAccessionNumbers.join(', '),
        test.specimenTypes.join(', '),
      ]
        .filter(Boolean)
        .join(' · ');
      doc
        .font('Helvetica')
        .fontSize(7)
        .fillColor(GRAY)
        .text(`Muestra: ${specimen}`, COL.name.x, doc.y, {
          width: PAGE_WIDTH - 8,
        });
      doc.y += 4;
    }

    columnHeaders();

    let currentSection: string | null = null;
    const sectionCount = new Set(
      test.analytes.map((a) => a.sectionName).filter(Boolean)
    ).size;

    for (const analyte of test.analytes) {
      // Section label — skipped when the whole test is one section
      if (
        sectionCount > 1 &&
        analyte.sectionName &&
        analyte.sectionName !== currentSection
      ) {
        currentSection = analyte.sectionName;
        if (ensureSpace(24)) columnHeaders();
        doc
          .font('Helvetica-Bold')
          .fontSize(7)
          .fillColor(GRAY)
          .text(analyte.sectionName.toUpperCase(), COL.name.x, doc.y + 2, {
            width: PAGE_WIDTH - 8,
          });
        doc.y += 3;
      }

      if (analyte.isHeader) {
        // Template spacer rows ("-") are just visual gaps
        const label = analyte.name.trim();
        if (!label || /^-+$/.test(label)) {
          doc.y += 4;
          continue;
        }
        if (ensureSpace(24)) columnHeaders();
        doc
          .font('Helvetica-Bold')
          .fontSize(8)
          .fillColor(DARK)
          .text(label, COL.name.x, doc.y + 2, { width: PAGE_WIDTH - 8 });
        doc.y += 3;
        continue;
      }

      const value =
        displayValue(analyte) +
        (analyte.flag && analyte.flag !== 'N' ? ` ${analyte.flag}` : '');
      const refText = analyte.referenceSnapshot?.displayText ?? '';
      const unitText = analyte.unit ?? '';
      // Long free-text results use the unit/reference space too
      const isLong = analyte.valueType === 'LONG_TEXT' && !unitText && !refText;
      const valW = isLong ? LEFT + PAGE_WIDTH - COL.val.x - 4 : COL.val.w;

      // Measure every cell first so wrapped text never collides with the next row
      doc.font('Helvetica').fontSize(8);
      const nameH = doc.heightOfString(analyte.name, { width: COL.name.w });
      doc.font('Helvetica-Bold').fontSize(8);
      const valH = doc.heightOfString(value, { width: valW });
      doc.font('Helvetica').fontSize(7);
      const unitH = unitText
        ? doc.heightOfString(unitText, { width: COL.unit.w })
        : 0;
      const refH = refText
        ? doc.heightOfString(refText, { width: COL.ref.w })
        : 0;
      const rowH = Math.max(nameH, valH, unitH, refH) + 4;

      if (ensureSpace(rowH)) columnHeaders();
      const rowY = doc.y;

      if (analyte.flag === 'H' || analyte.flag === 'L') {
        doc
          .fillColor(analyte.flag === 'H' ? '#fef2f2' : '#eff6ff')
          .rect(LEFT, rowY - 1, PAGE_WIDTH, rowH)
          .fill();
      }

      const flagColor =
        analyte.flag === 'H'
          ? '#dc2626'
          : analyte.flag === 'L'
          ? '#2563eb'
          : DARK;

      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(DARK)
        .text(analyte.name, COL.name.x, rowY, { width: COL.name.w });
      doc
        .font('Helvetica-Bold')
        .fontSize(8)
        .fillColor(flagColor)
        .text(value, COL.val.x, rowY, { width: valW });
      if (unitText)
        doc
          .font('Helvetica')
          .fontSize(7)
          .fillColor(GRAY)
          .text(unitText, COL.unit.x, rowY + 0.5, { width: COL.unit.w });
      if (refText)
        doc
          .font('Helvetica')
          .fontSize(7)
          .fillColor(GRAY)
          .text(refText, COL.ref.x, rowY + 0.5, { width: COL.ref.w });

      doc.y = rowY + rowH;
    }

    if (test.observations) {
      doc.font('Helvetica').fontSize(8);
      const obsH = doc.heightOfString(test.observations, {
        width: PAGE_WIDTH - 8,
      });
      ensureSpace(obsH + 16);
      doc.y += 4;
      doc
        .font('Helvetica-Bold')
        .fontSize(7)
        .fillColor(GRAY)
        .text('OBSERVACIONES:', COL.name.x, doc.y, { width: PAGE_WIDTH - 8 });
      doc
        .font('Helvetica')
        .fontSize(8)
        .fillColor(DARK)
        .text(test.observations, COL.name.x, doc.y + 2, {
          width: PAGE_WIDTH - 8,
        });
    }
  }

  /** Draws one signature column and returns the y where it ends. */
  private drawSigner(
    doc: Doc,
    opts: {
      x: number;
      width: number;
      topY: number;
      lineY: number;
      signature: Buffer | null;
      name: string;
      details: Array<string | null>;
      role: string;
    }
  ): number {
    const { x, width, topY, lineY } = opts;
    if (opts.signature) {
      try {
        doc.image(opts.signature, x + width / 2 - 30, topY, { fit: [60, 30] });
      } catch {
        /* skip */
      }
    }
    doc
      .moveTo(x + 10, lineY)
      .lineTo(x + width - 10, lineY)
      .strokeColor(DARK)
      .lineWidth(0.5)
      .stroke();
    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(DARK)
      .text(opts.name, x, lineY + 3, { width, align: 'center' });
    doc.font('Helvetica').fontSize(7).fillColor(GRAY);
    for (const line of opts.details) {
      if (line) doc.text(line, x, doc.y, { width, align: 'center' });
    }
    doc
      .font('Helvetica-Bold')
      .fontSize(7)
      .fillColor(GRAY)
      .text(opts.role, x, doc.y + 2, { width, align: 'center' });
    return doc.y;
  }

  /** Lab identity + page number, drawn inside the reserved bottom band. */
  private drawFooter(
    doc: Doc,
    data: ReleaseForPdf,
    LEFT: number,
    PAGE_WIDTH: number,
    page: number,
    pageCount: number
  ) {
    // Writing below the bottom margin would make pdfkit add a page
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;

    const top = doc.page.height - MARGIN - FOOTER_HEIGHT + 10;
    doc
      .moveTo(LEFT, top)
      .lineTo(LEFT + PAGE_WIDTH, top)
      .strokeColor(CYAN)
      .lineWidth(1)
      .stroke();

    doc
      .font('Helvetica-Bold')
      .fontSize(8)
      .fillColor(DARK)
      .text(data.labName, LEFT, top + 6, {
        width: PAGE_WIDTH,
        align: 'center',
      });

    const addressLine = [data.labAddress, data.labCity]
      .filter(Boolean)
      .join(' · ');
    const phonesLine = data.labPhones
      .map((p) => (p.label ? `${p.label}: ${p.number}` : p.number))
      .join(' · ');
    doc.font('Helvetica').fontSize(7).fillColor(GRAY);
    for (const line of [addressLine, phonesLine, data.labEmail]) {
      if (line)
        doc.text(line, LEFT, doc.y + 1, { width: PAGE_WIDTH, align: 'center' });
    }

    doc
      .fontSize(6.5)
      .text(
        `Página ${page} de ${pageCount} · Req: ${data.requisitionNumber}`,
        LEFT,
        doc.page.height - MARGIN + 6,
        { width: PAGE_WIDTH, align: 'center', lineBreak: false }
      );

    doc.page.margins.bottom = bottomMargin;
  }
}
