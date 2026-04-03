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
    '^@vet-ai/shared-types$': '<rootDir>/../../libs/shared-types/src/index.ts',
  },
  testEnvironment: 'node',
};
