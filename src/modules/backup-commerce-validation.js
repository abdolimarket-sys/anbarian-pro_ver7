/** Runtime validation shared by both manual and external backup restore paths.
 * Intentionally has no invoice-line count ceiling: the 500-item limit belongs
 * only to the taxpayer draft API, never to full backup/restore.
 */
export function isValidCommerceBackup(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.schemaVersion !== 1 || !Array.isArray(value.invoices) || !Array.isArray(value.parties)) return false;
  return value.invoices.every((invoice) => {
    if (!invoice || typeof invoice !== 'object' || Array.isArray(invoice)) return false;
    if (invoice.items !== undefined && !Array.isArray(invoice.items)) return false;
    if (Array.isArray(invoice.items) && !invoice.items.every((item) => !!item && typeof item === 'object' && !Array.isArray(item))) return false;
    return true;
  });
}
