import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/modules/accounting-commerce-ui.ts', import.meta.url), 'utf8');
const start = source.indexOf('function buildInvoiceHtmlThermal(');
const end = source.indexOf('function resolveInvoiceForPrint()', start);
const pocket = source.slice(start, end);

test('thermal pocket invoice uses a shared store logo/name header row', () => {
  assert.match(pocket, /class="store-head"/);
  assert.match(pocket, /class="store-logo"/);
  assert.match(pocket, /class="store-name"/);
});

test('buyer or supplier details are grouped in a bordered two-column card', () => {
  assert.match(pocket, /class="party-card"/);
  assert.match(pocket, /class="party-grid"/);
  assert.match(pocket, /grid-template-columns:1fr 1fr/);
  assert.match(pocket, /class="party-field full"/);
});

test('invoice items expose requested columns and stack line amount with discount', () => {
  for (const heading of ['ردیف', 'عنوان کالا', 'تعداد', 'قیمت واحد', 'مبلغ \/ تخفیف']) {
    assert.ok(pocket.includes(heading), `missing column ${heading}`);
  }
  assert.match(pocket, /class="amount-cell"/);
  assert.match(pocket, /تخفیف:/);
});

test('invoice totals and payment details are arranged in two columns', () => {
  assert.match(pocket, /class="totals"/);
  assert.match(pocket, /class="more-info"/);
  assert.match(pocket, /grid-template-columns:1fr 1fr/);
  assert.match(pocket, /مبلغ نهایی فاکتور/);
});

test('80mm thermal invoice uses the same compact receipt hierarchy as pocket printing', () => {
  assert.match(pocket, /if\(widthMm===80\)return buildInvoiceHtmlThermal80\(invoiceId,80\)/);
  const start80 = source.indexOf('function buildInvoiceHtmlThermal80(');
  const end80 = source.indexOf('function buildInvoiceHtmlThermal(', start80);
  const thermal80 = source.slice(start80, end80);
  assert.match(thermal80, /class="store-head"/);
  assert.match(thermal80, /class="party-card"/);
  assert.match(thermal80, /class="totals"/);
  assert.match(thermal80, /line-height:1\.28/);
});

test('A5 invoice print applies a compact page box and fit scaling to reduce accidental second pages', () => {
  assert.match(source, /@page \{ size:\$\{a5\?'A5':'A4'\} portrait; margin:\$\{a5\?'5mm':'9mm'\}; \}/);
  assert.match(source, /body\.invoice-print \{ zoom:\.82!important; \}/);
});
