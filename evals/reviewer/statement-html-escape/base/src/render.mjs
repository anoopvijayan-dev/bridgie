export const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function renderHeader(customer) {
  return `<h1>Statement for ${esc(customer.name)}</h1>`;
}
