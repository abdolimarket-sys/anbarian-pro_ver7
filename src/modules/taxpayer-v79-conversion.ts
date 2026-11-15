/**
 * Convert an explicit Jalali invoice date + local clock time to Unix milliseconds.
 * The clock is interpreted in the browser/device local timezone; no time is invented.
 */
const toLatinDigits = (value: string): string =>
  value.replace(/[۰-۹]/g, d => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
       .replace(/[٠-٩]/g, d => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));

export function jalaliDateTimeToUnixMs(jalaliDate: string, localTime: string): number | null {
  const dateText = toLatinDigits(jalaliDate.trim()).replace(/-/g, '/');
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(dateText);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(toLatinDigits(localTime.trim()));
  if (!match || !timeMatch) return null;
  const jy = Number(match[1]), jm = Number(match[2]), jd = Number(match[3]);
  const hh = Number(timeMatch[1]), mm = Number(timeMatch[2]);
  if (jm < 1 || jm > 12 || jd < 1 || jd > 31 || hh > 23 || mm > 59) return null;

  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
      year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC'
    });
  } catch { return null; }

  // A Jalali year starts around March 20/21. Search that Gregorian year
  // with Intl's Persian calendar, avoiding a hand-maintained leap-year table.
  const cursor = new Date(Date.UTC(jy + 621, 2, 1));
  let found: { year: number; month: number; day: number } | null = null;
  for (let i = 0; i < 370; i++) {
    const parts = formatter.formatToParts(cursor);
    const get = (type: string) => Number(parts.find(part => part.type === type)?.value);
    if (get('year') === jy && get('month') === jm && get('day') === jd) {
      found = { year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1, day: cursor.getUTCDate() };
      break;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  if (!found) return null;
  const local = new Date(found.year, found.month - 1, found.day, hh, mm, 0, 0);
  if (local.getFullYear() !== found.year || local.getMonth() !== found.month - 1 ||
      local.getDate() !== found.day || local.getHours() !== hh || local.getMinutes() !== mm) return null;
  const timestamp = local.getTime();
  return Number.isSafeInteger(timestamp) && timestamp >= 0 ? timestamp : null;
}

