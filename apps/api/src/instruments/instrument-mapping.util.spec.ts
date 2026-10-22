import { planMapping, type MappingRow } from './instrument-mapping.util';

const row = (
  parameterCode: string,
  analyzerUnit: string,
  analyteCode: string,
  multiplier = 1,
  catalogItemCode = 'CBC'
): MappingRow => ({
  parameterCode,
  analyzerUnit,
  analyteCode,
  multiplier,
  catalogItemCode,
});
const param = (
  code: string,
  value: string,
  unit: string,
  valueType = 'NM'
) => ({
  code,
  value,
  unit,
  valueType,
  referenceRange: '',
  abnormalFlag: '',
  userFlag: '',
});

describe('planMapping', () => {
  const mappings = [
    row('WBC', '10^9/L', 'WBC'),
    row('HGB', 'g/dL', 'HGB'),
    row('HGB', 'g/L', 'HGB', 0.1),
  ];

  it('imports mapped values, converting with the explicit multiplier and no float noise', () => {
    const r = planMapping(
      [param('WBC', '13.23', '10^9/L'), param('HGB', '57', 'g/L')],
      mappings
    );
    expect(r.plan.map((p) => [p.analyteCode, p.value])).toEqual([
      ['WBC', 13.23],
      ['HGB', 5.7],
    ]);
    expect(r.ignored).toEqual([]);
    expect(r.unitMismatches).toEqual([]);
  });

  it('PARTIAL mapping: unmapped parameters are listed as ignored, not silently dropped', () => {
    const r = planMapping(
      [
        param('WBC', '13', '10^9/L'),
        param('Mid#', '1.2', '10^9/L'),
        param('Gran#', '5', '10^9/L'),
        param('WBC Alarm', 'x', '', 'IS'),
        param('PLT', '', '10^9/L'),
      ],
      [...mappings, row('PLT', '10^9/L', 'PLT')]
    );
    expect(r.plan.map((p) => p.analyteCode)).toEqual(['WBC']);
    expect(
      Object.fromEntries(r.ignored.map((i) => [i.code, i.reason]))
    ).toEqual({
      'Mid#': 'NO_MAPPING',
      'Gran#': 'NO_MAPPING',
      'WBC Alarm': 'NOT_NUMERIC',
      PLT: 'EMPTY_OR_INVALID_VALUE',
    });
  });

  it('a mapped parameter in an unmapped unit is a unit mismatch that names the units that ARE mapped', () => {
    const r = planMapping([param('HGB', '5.7', 'mmol/L')], mappings);
    expect(r.plan).toEqual([]);
    expect(r.unitMismatches).toEqual([
      { code: 'HGB', unit: 'mmol/L', mappedUnits: ['g/dL', 'g/L'] },
    ]);
    expect(r.ignored).toEqual([]);
  });

  it('maps one parameter to several tests when mapped that way', () => {
    const r = planMapping(
      [param('WBC', '10', '10^9/L')],
      [row('WBC', '10^9/L', 'WBC'), row('WBC', '10^9/L', 'WBC_X', 1, 'OTHER')]
    );
    expect(r.plan.map((p) => `${p.catalogItemCode}:${p.analyteCode}`)).toEqual([
      'CBC:WBC',
      'OTHER:WBC_X',
    ]);
  });

  it('with no mappings at all everything is "not mapped"', () => {
    expect(planMapping([param('WBC', '1', 'x')], []).ignored).toEqual([
      { code: 'WBC', reason: 'NO_MAPPING' },
    ]);
  });
});
