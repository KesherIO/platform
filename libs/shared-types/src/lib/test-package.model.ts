import { TestModel } from './test.model.js';

export interface TestPackageModel {
  id: string;
  name: string;
  description?: string;
  tests: TestModel[];
}
