// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/*'] },
  {
    // New React Compiler-oriented rules: reported as warnings until the flagged hooks are refactored.
    rules: { 'react-hooks/set-state-in-effect': 'warn', 'react-hooks/refs': 'warn' }
  }
]);
