export interface BackupHealthReport {
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
}
export interface BackupHealthComparison {
  matches: boolean;
  differences: Array<{ field: keyof Omit<BackupHealthReport, 'generatedAt'>; before: number; after: number }>;
}
export function createBackupHealthReport(payload: unknown, generatedAt?: string): BackupHealthReport;
export function compareBackupHealthReports(before: BackupHealthReport, after: BackupHealthReport): BackupHealthComparison;
