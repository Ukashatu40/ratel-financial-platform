// eslint.config.mjs
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['dist/**', 'coverage/**', 'node_modules/**', 'generated/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      // This codebase uses a leading underscore to mark a parameter as
      // deliberately unused — e.g. `requiresApproval(amountMinorUnits, _reason)`
      // in ExpenseAdjustmentApprovalPolicy, where the prefix IS the signal that
      // ignoring it is intentional. Without these patterns the rule flags the
      // convention itself as a violation, which inflated TECH_DEBT #46's count
      // with non-defects and buried the real ones.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
);
