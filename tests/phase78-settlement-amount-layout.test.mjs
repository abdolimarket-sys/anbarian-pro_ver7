import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css=readFileSync(new URL('../src/styles/main.css',import.meta.url),'utf8');
const ui=readFileSync(new URL('../src/modules/accounting-commerce-ui.ts',import.meta.url),'utf8');
test('settlement keeps payment method on the right and full-width amount above delete on the left',()=>{
  assert.match(ui,/settlement-amount-field settlement-field-box/);
  assert.match(ui,/data-settle-remove/);
  assert.match(css,/\.settlement-stage-card \.settlement-stage-top\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*0\.9fr\)\s+minmax\(0,\s*1\.1fr\)/s);
  assert.match(css,/\.settlement-stage-card \.settlement-payment-controls\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)[^}]*grid-template-rows:\s*auto\s+auto/s);
  assert.match(css,/\.settlement-stage-card \.settlement-amount-field input\s*\{[^}]*width:\s*100%[^}]*min-height:\s*52px/s);
  assert.match(css,/\.settlement-stage-card \.settlement-remove-btn\s*\{[^}]*grid-column:\s*1[^}]*grid-row:\s*2/s);
});
test('settlement cheque details remain in their independent block',()=>{
  assert.match(ui,/settlement-cheque-fields settlement-cheque-stack/);
  assert.match(css,/\.settlement-cheque-fields\[style\*="display: none"\]/);
});
