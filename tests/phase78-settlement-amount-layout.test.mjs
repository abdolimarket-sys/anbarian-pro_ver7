import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css=readFileSync(new URL('../src/styles/main.css',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/modules/accounting-commerce-ui.ts',import.meta.url),'utf8');
test('settlement amount uses a full-width row above the remove button',()=>{
  assert.match(ui,/settlement-amount-field settlement-field-box/);
  assert.match(ui,/data-settle-remove/);
  assert.match(css,/\.settlement-stage-card \.settlement-stage-top\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(css,/\.settlement-stage-card \.settlement-amount-field input\s*\{[^}]*width:\s*100%/s);
  assert.match(css,/\.settlement-stage-card \.settlement-remove-btn\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/s);
});
