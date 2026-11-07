// JSON Schema subset validator. Supports: type (string or array), required,
// properties, additionalProperties (boolean), enum, items, minItems, pattern,
// $ref to "#/$defs/<name>". Returns an array of "path: message" strings.

function typeOf(v) {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function typeOk(expected, actual) {
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  return expected === actual;
}

function resolve(root, ref) {
  if (!ref.startsWith('#/')) throw new Error(`unsupported $ref: ${ref}`);
  return ref.slice(2).split('/').reduce((o, k) => (o ? o[k] : undefined), root);
}

export function validate(schema, value, path = '', root = schema) {
  const errs = [];
  const at = path || '$';
  if (schema.$ref) return validate(resolve(root, schema.$ref), value, path, root);

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    if (!types.some(t => typeOk(t, actual))) {
      errs.push(`${at}: expected ${types.join('|')}, got ${actual}`);
      return errs;
    }
  }
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${at}: must be one of ${schema.enum.join(', ')}`);
  if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) errs.push(`${at}: does not match pattern ${schema.pattern}`);

  if (typeOf(value) === 'object') {
    for (const k of schema.required || []) if (!(k in value)) errs.push(`${path ? path + '.' : ''}${k}: required`);
    const props = schema.properties || {};
    for (const [k, v] of Object.entries(value)) {
      if (k in props) errs.push(...validate(props[k], v, path ? `${path}.${k}` : k, root));
      else if (schema.additionalProperties === false) errs.push(`${path ? path + '.' : ''}${k}: unexpected property`);
    }
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${at}: expected at least ${schema.minItems} items`);
    if (schema.items) value.forEach((v, i) => errs.push(...validate(schema.items, v, `${path}[${i}]`, root)));
  }
  return errs;
}

export function assertValid(schema, value, label = 'document') {
  const errs = validate(schema, value);
  if (errs.length) throw new Error(`${label} invalid:\n  ${errs.join('\n  ')}`);
  return value;
}
