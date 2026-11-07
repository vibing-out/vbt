/**
 * Canonical JSON: object keys sorted recursively (by UTF-16 code unit, the
 * default `Array.prototype.sort` order), arrays keep their order, no
 * whitespace. Only JSON values are accepted; anything else throws so two
 * machines can never serialise the same input differently.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalise(value, "$"));
}

function normalise(value: unknown, path: string): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`${path}: numbers must be finite`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, i) => normalise(item, `${path}[${i}]`));
  if (typeof value === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new TypeError(`${path}: only plain objects can be serialised`);
    }
    const out: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      out[key] = normalise((value as Record<string, unknown>)[key], `${path}.${key}`);
    }
    return out;
  }
  throw new TypeError(`${path}: ${typeof value} is not a JSON value`);
}
