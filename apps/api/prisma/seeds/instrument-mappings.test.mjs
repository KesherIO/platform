// Run: node --test apps/api/prisma/seeds/instrument-mappings.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROFILES,
  applicableDefinitions,
  normaliseRows,
  planChanges,
  validateAgainstTemplates,
} from './instrument-mappings.lib.mjs';

const an = (code, extra = {}) => ({
  code,
  isHeader: false,
  valueType: 'NUMERIC',
  formula: null,
  ...extra,
});
const def = (ownerKey, analytes, species = 'DOG') => ({
  species,
  ageMinWeeks: -1,
  ageMaxWeeks: -1,
  ownerKey,
  activeVersion: { analytes },
});

test('the vh30-cbc profile is well-formed and leaves the differential unmapped', () => {
  const rows = normaliseRows(PROFILES['vh30-cbc'].rows);
  assert.equal(rows.length, 11);
  assert.ok(!rows.some((r) => /^(lym|mid|gran)/i.test(r.parameterCode)));
});

test('normaliseRows rejects bad rows and duplicates', () => {
  assert.throws(() => normaliseRows([]), /empty/);
  assert.throws(() => normaliseRows([['A', 'u', 'A']]), /expected/);
  assert.throws(() => normaliseRows([['A', 'u', 'A', 0]]), /multiplier/);
  assert.throws(() => normaliseRows([['A', ' u', 'A', 1]]), /trimmed/);
  assert.throws(
    () =>
      normaliseRows([
        ['A', 'u', 'A', 1],
        ['A', 'u', 'B', 1],
      ]),
    /duplicate/
  );
});

test('a lab template shadows the platform one for the same band', () => {
  const out = applicableDefinitions(
    [def('platform', [an('X')]), def('lab1', [an('Y')])],
    'lab1'
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].ownerKey, 'lab1');
  assert.equal(
    applicableDefinitions(
      [def('platform', [an('X')], 'DOG'), def('platform', [an('X')], 'CAT')],
      'lab1'
    ).length,
    2
  );
});

test('validation: missing, header, non-numeric are errors; formulas are "computed"', () => {
  const rows = normaliseRows([
    ['A', 'u', 'A', 1],
    ['B', 'u', 'B', 1],
    ['C', 'u', 'C', 1],
    ['D', 'u', 'D', 1],
    ['E', 'u', 'E', 1],
  ]);
  const defs = [
    def('platform', [
      an('A'),
      an('B', { isHeader: true }),
      an('C', { valueType: 'TEXT' }),
      an('D', { formula: '[A]*2' }),
    ]),
  ];
  const { errors, computed } = validateAgainstTemplates(rows, defs);
  assert.equal(errors.length, 3);
  assert.deepEqual(computed, ['D']);
  assert.match(errors.join('\n'), /E: not in the active template/);
  assert.ok(validateAgainstTemplates(rows, []).errors.length > 0);
});

test('planChanges separates create / unchanged / differ', () => {
  const rows = normaliseRows([
    ['A', 'u', 'A', 1],
    ['B', 'u', 'B', 1],
    ['C', 'u', 'C', 0.1],
  ]);
  const plan = planChanges(rows, [
    { parameterCode: 'A', analyzerUnit: 'u', analyteCode: 'A', multiplier: 1 },
    { parameterCode: 'C', analyzerUnit: 'u', analyteCode: 'C', multiplier: 1 },
  ]);
  assert.deepEqual(
    plan.create.map((r) => r.parameterCode),
    ['B']
  );
  assert.deepEqual(
    plan.unchanged.map((r) => r.parameterCode),
    ['A']
  );
  assert.deepEqual(
    plan.differ.map((d) => d.row.parameterCode),
    ['C']
  );
});
