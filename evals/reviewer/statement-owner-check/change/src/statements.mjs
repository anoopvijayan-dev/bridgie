// GET /statements/:id — req = { user: { id, account_id } | null, params: { id } }
export function getStatement(db, req) {
  if (!req.user) return { status: 401, body: { error: 'sign in first' } };
  const statement = db.getStatement(req.params.id);
  if (!statement) return { status: 404, body: { error: 'not found' } };
  return { status: 200, body: statement };
}
