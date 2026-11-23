const cell = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
export const toCsv = rows => rows.map(r => r.map(cell).join(',')).join('\n') + '\n';
