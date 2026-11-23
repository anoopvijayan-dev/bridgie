// An in-memory statement store: id -> { id, account_id, lines }.
export function makeDb(statements) {
  const byId = new Map(statements.map(s => [s.id, s]));
  return { getStatement: id => byId.get(id) ?? null };
}
