import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', '*.config.*'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    languageOptions: { parserOptions: { projectService: false } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'error',
    },
  },
  {
    // Only repositories and the database module may touch Prisma directly.
    files: ['src/**/*.ts'],
    ignores: [
      'src/database/**',
      'src/**/infrastructure/**',
      'src/**/*.spec.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@prisma/client',
              message: 'Import Prisma only from repositories (infrastructure/) or src/database.',
            },
          ],
        },
      ],
    },
  },
  { files: ['prisma/**/*.ts', 'test/**/*.ts'], rules: { 'no-console': 'off' } },
);
