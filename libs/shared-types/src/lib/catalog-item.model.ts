export type CatalogItemKind = 'TEST' | 'PACKAGE';

/** How the lab result value for this test should be interpreted. */
export type ResultType = 'NUMERIC' | 'TEXT' | 'POSITIVE_NEGATIVE';

export interface CatalogItemModel {
  id: string;
  kind: CatalogItemKind;
  name: string;
  code?: string;
  description?: string;
  category?: string;
  turnaroundHours?: number;
  /** TEST only. Null means the result structure is not yet defined for this test. */
  resultType?: ResultType;
  /** TEST only. Unit of measurement (e.g. "mg/dL"). Null for unitless or unstructured tests. */
  unit?: string;
  active: boolean;
  components?: CatalogItemModel[]; // PACKAGE only — constituent tests
}
