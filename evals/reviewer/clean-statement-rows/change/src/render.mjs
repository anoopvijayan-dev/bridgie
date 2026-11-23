export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderHeader(customer) {
  return `<h1>Statement for ${esc(customer.name)}</h1>`;
}

const pounds = pence => `${pence < 0 ? '-' : ''}${Math.floor(Math.abs(pence) / 100)}.${String(Math.abs(pence) % 100).padStart(2, '0')}`;

export function renderRows(lines) {
  return lines.map(l =>
    `<tr><td>${esc(l.date)}</td><td>${esc(l.description)}</td><td>${esc(l.counterparty)}</td><td>${pounds(l.amount_pence)}</td></tr>`).join('\n');
}
