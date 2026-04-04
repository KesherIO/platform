/** @type {import('jest').Config} */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        module: 'commonjs',
        moduleResolution: 'node',
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true,
        emitDecoratorMetadata: true,
        experimentalDecorators: true,
      },
    }],
  },
  moduleNameMapper: {
    '^@vet-ai/shared-types$': '<rootDir>/../../../libs/shared-types/src/lib/index.ts',
    // shared-types uses ESM-style .js extensions on internal imports; strip them so
    // ts-jest resolves the matching .ts source files instead.
    '^(\\.{1,2}/.+)\\.js$': '$1',
  },
  testEnvironment: 'node',
};
