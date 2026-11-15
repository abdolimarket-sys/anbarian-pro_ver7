/** Count-only health report for comparing a backup snapshot with restored data. */
/** @typedef {{generatedAt:string,products:number,invoices:number,invoiceRows:number,parties:number,accounts:number,journalEntries:number,inventoryCostLayers:number,inventoryCostMovements:number,auditEntries:number,inventoryDocuments:number}} BackupHealthReport */
/*
  generatedAt: string;
  products: number;
  invoices: number;
  invoiceRows: number;
  parties: number;
  accounts: number;
  journalEntries: number;
  inventoryCostLayers: number;
  inventoryCostMovements: number;
  auditEntries: number;
  inventoryDocuments: number;
*/

function arrayLength(value) {
  return Array.isArray(value) ? value.length : 0;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : {};
}

/** Creates a non-sensitive count summary; does not modify the backup or app data. */
export function createBackupHealthReport(payload, generatedAt = new Date().toISOString()) {
  const root = objectValue(payload);
  const app = objectValue(root.app);
  const commerce = objectValue(root.commerce);
  const accounting = objectValue(root.accounting);
  const costing = objectValue(root.costing);
  const invoices = Array.isArray(commerce.invoices) ? commerce.invoices : [];

  return {
    generatedAt,
    products: arrayLength(app.products),
    invoices: invoices.length,
    invoiceRows: invoices.reduce((sum, invoice) => sum + arrayLength(objectValue(invoice).items), 0),
    parties: arrayLength(commerce.parties),
    accounts: arrayLength(accounting.accounts),
    journalEntries: arrayLength(accounting.journalEntries),
    inventoryCostLayers: arrayLength(costing.layers),
    inventoryCostMovements: arrayLength(costing.movements),
    auditEntries: arrayLength(app.auditLog),
    inventoryDocuments: arrayLength(app.inventoryDocs),
  };
}

/** Compares only structural counts; it does not claim monetary or stock-value equality. */
export function compareBackupHealthReports(before, after) {
  const fields = [
    'products', 'invoices', 'invoiceRows', 'parties', 'accounts', 'journalEntries',
    'inventoryCostLayers', 'inventoryCostMovements', 'auditEntries', 'inventoryDocuments',
  ];
  const differences = fields
    .filter((field) => before[field] !== after[field])
    .map((field) => ({ field, before: before[field], after: after[field] }));
  return { matches: differences.length === 0, differences };
}
