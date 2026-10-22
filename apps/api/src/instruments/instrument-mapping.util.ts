import type { ParsedParameter } from './hl7-oru';

/** One explicit row of instrument_parameter_mappings. */
export interface MappingRow {
  parameterCode: string;
  analyzerUnit: string;
  catalogItemCode: string;
  analyteCode: string;
  multiplier: number;
}

export interface PlannedValue {
  analyzerCode: string;
  analyzerUnit: string;
  rawValue: string;
  catalogItemCode: string;
  analyteCode: string;
  multiplier: number;
  value: number;
}

export interface MappingPlan {
  /** Values that WILL be imported (converted with the explicit multiplier). */
  plan: PlannedValue[];
  /** Parameters that will NOT be imported, with why: NO_MAPPING | NOT_NUMERIC | EMPTY_OR_INVALID_VALUE */
  ignored: Array<{ code: string; reason: string }>;
  /** Mapped parameters that arrived in a unit with no mapping — blocks import until a mapping row exists. */
  unitMismatches: Array<{ code: string; unit: string; mappedUnits: string[] }>;
}

/** 0.1 * 5.7 = 0.5700000000000001 — keep what the analyzer actually measured. */
const clean = (n: number) => Number(n.toPrecision(12));

/**
 * The single place that decides, for each analyzer parameter, whether it is imported, ignored or a unit
 * problem. Used by the importer AND by the review screen, so what a reviewer sees is what would happen.
 */
export function planMapping(parameters: Array<ParsedParameter & { valueType: string }>, mappings: MappingRow[]): MappingPlan {
  const byKey = new Map<string, MappingRow[]>();
  const unitsByCode = new Map<string, Set<string>>();
  for (const m of mappings) {
    const k = `${m.parameterCode}\u0000${m.analyzerUnit}`;
    byKey.set(k, [...(byKey.get(k) ?? []), m]);
    unitsByCode.set(m.parameterCode, (unitsByCode.get(m.parameterCode) ?? new Set()).add(m.analyzerUnit));
  }
  const out: MappingPlan = { plan: [], ignored: [], unitMismatches: [] };
  for (const p of parameters) {
    if (p.valueType !== 'NM') {
      out.ignored.push({ code: p.code, reason: 'NOT_NUMERIC' });
      continue;
    }
    const rows = byKey.get(`${p.code}\u0000${p.unit}`);
    if (!rows) {
      const mapped = unitsByCode.get(p.code);
      if (mapped) out.unitMismatches.push({ code: p.code, unit: p.unit, mappedUnits: [...mapped] });
      else out.ignored.push({ code: p.code, reason: 'NO_MAPPING' });
      continue;
    }
    const num = p.value === '' ? NaN : Number(p.value);
    if (!Number.isFinite(num)) {
      out.ignored.push({ code: p.code, reason: 'EMPTY_OR_INVALID_VALUE' });
      continue;
    }
    for (const m of rows) {
      out.plan.push({
        analyzerCode: p.code,
        analyzerUnit: p.unit,
        rawValue: p.value,
        catalogItemCode: m.catalogItemCode,
        analyteCode: m.analyteCode,
        multiplier: m.multiplier,
        value: clean(num * m.multiplier),
      });
    }
  }
  return out;
}
