// What counts as a voter-identity field name (CLAUDE.md "No voter identity"; locked-interfaces § Data
// model: "No table holds a voter's name, ID, date of birth, or signature").

/** A name fails if any of its tokens is one of these. */
export const IDENTITY_TOKENS: ReadonlySet<string> = new Set([
  "name",
  "first",
  "last",
  "full",
  "voter",
  "dob",
  "birth",
  "birthdate",
  "signature",
  "phone",
  "email",
  "address",
  "ssn",
]);

/** Splits snake_case, kebab-case and camelCase / PascalCase names into lower-case tokens. */
export function nameTokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((token) => token.toLowerCase());
}

export function isIdentityName(name: string): boolean {
  return nameTokens(name).some((token) => IDENTITY_TOKENS.has(token));
}
