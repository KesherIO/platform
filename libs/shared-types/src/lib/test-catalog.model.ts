import { TestModel } from './test.model.js';
import { TestPackageModel } from './test-package.model.js';

export interface TestCatalogModel {
  tests: TestModel[];
  packages: TestPackageModel[];
}
