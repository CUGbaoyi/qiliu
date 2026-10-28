import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
export default [
{ignores:['dist/**','node_modules/**','.data/**','public/sw.js']},
js.configs.recommended,
{files:['**/*.{js,jsx,mjs}'],languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:{...globals.browser,...globals.node},parserOptions:{ecmaFeatures:{jsx:true}}},plugins:{react},settings:{react:{version:'detect'}},rules:{'react/jsx-uses-react':'error','react/jsx-uses-vars':'error','no-unused-vars':['error',{argsIgnorePattern:'^_',varsIgnorePattern:'^_'}],'no-empty':['error',{allowEmptyCatch:true}]}}
];
