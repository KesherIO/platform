/**
 * Pure helpers for instrument-mappings.mjs (no database access, unit-tested in
 * instrument-mappings.test.mjs).
 */

/** [analyzer parameterCode, analyzer unit, template analyteCode, multiplier] */
export const PROFILES = {
  'vh30-cbc': {
    model: 'VH-30',
    manufacturer: 'Genrui',
    department: 'HEMATOLOGY',
    catalogCode: 'CBC',
    // The whole differential (Lym/Mid/Gran) is deliberately NOT mapped: the lab enters the smear count by hand,
    // and a 3-part differential does not match the template's NEU/MON/EOS/BAS. Unmapped parameters are held for
    // review by the processor, never guessed.
    rows: [
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
    ],
  },
};

/**
 * Validates and normalises a mapping table (built-in profile or --mappings-file).
 * Throws on the first malformed row or duplicate key.
 */
export function normaliseRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0)
    throw new Error('Mapping table is empty.');
  const seen = new Set();
  return rows.map((r, i) => {
    if (!Array.isArray(r) || r.length !== 4)
      throw new Error(
        `Row ${i + 1}: expected [parameterCode, unit, analyteCode, multiplier].`
      );
    const [parameterCode, analyzerUnit, analyteCode, multiplier] = r;
    for (const [label, v] of [
      ['parameterCode', parameterCode],
      ['unit', analyzerUnit],
      ['analyteCode', analyteCode],
    ])
      if (typeof v !== 'string' || v.trim() !== v || v === '')
        throw new Error(
          `Row ${i + 1}: ${label} must be a non-empty trimmed string.`
        );
    if (
      typeof multiplier !== 'number' ||
      !Number.isFinite(multiplier) ||
      multiplier <= 0
    )
      throw new Error(`Row ${i + 1}: multiplier must be a positive number.`);
    const key = `${parameterCode}\u0000${analyzerUnit}`;
    if (seen.has(key))
      throw new Error(
        `Row ${i + 1}: duplicate ${parameterCode} / ${analyzerUnit}.`
      );
    seen.add(key);
    return { parameterCode, analyzerUnit, analyteCode, multiplier };
  });
}

/**
 * The templates that apply to a lab for a catalog code: the lab's own active definitions win over the
 * platform's for the same species/age band.
 * `definitions`: [{ id, species, ageMinWeeks, ageMaxWeeks, ownerKey, activeVersion: { analytes: [...] } }]
 */
export function applicableDefinitions(definitions, labId) {
  const byBand = new Map();
  for (const d of definitions) {
    if (!d.activeVersion) continue;
    const band = `${d.species}|${d.ageMinWeeks}|${d.ageMaxWeeks}`;
    const cur = byBand.get(band);
    if (!cur || (d.ownerKey === labId && cur.ownerKey !== labId))
      byBand.set(band, d);
  }
  return [...byBand.values()];
}

/**
 * Checks every mapped analyte code against every applicable template.
 * errors:   code missing, is a header row, or is not NUMERIC  -> blocks the run
 * computed: code is a template formula -> allowed (the analyzer's figure is reported, not written)
 */
export function validateAgainstTemplates(rows, defs) {
  const errors = [];
  const computed = new Set();
  if (defs.length === 0)
    errors.push(
      'No active result template applies to this lab for the catalog code.'
    );
  for (const d of defs) {
    const label = `${d.species} ${d.ageMinWeeks}-${d.ageMaxWeeks}w (${
      d.ownerKey === 'platform' ? 'platform' : 'lab'
    } template)`;
    const byCode = new Map(d.activeVersion.analytes.map((a) => [a.code, a]));
    for (const code of new Set(rows.map((r) => r.analyteCode))) {
      const a = byCode.get(code);
      if (!a) errors.push(`${code}: not in the active template for ${label}`);
      else if (a.isHeader) errors.push(`${code}: is a header row in ${label}`);
      else if (a.valueType !== 'NUMERIC')
        errors.push(`${code}: is ${a.valueType}, not NUMERIC, in ${label}`);
      else if (a.formula) computed.add(code);
    }
  }
  return { errors: [...new Set(errors)], computed: [...computed].sort() };
}

/**
 * Compares the desired rows with what is stored.
 * existing: [{ parameterCode, analyzerUnit, analyteCode, multiplier }]
 * -> { create, unchanged, differ: [{ row, current }] }
 */
export function planChanges(rows, existing) {
  const key = (r) => `${r.parameterCode}\u0000${r.analyzerUnit}`;
  const stored = new Map(existing.map((e) => [key(e), e]));
  const out = { create: [], unchanged: [], differ: [] };
  for (const row of rows) {
    const cur = stored.get(key(row));
    if (!cur) out.create.push(row);
    else if (
      cur.analyteCode === row.analyteCode &&
      cur.multiplier === row.multiplier
    )
      out.unchanged.push(row);
    else out.differ.push({ row, current: cur });
  }
  return out;
}
