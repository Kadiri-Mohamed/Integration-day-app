/** Normalize identity consistently for imports and the domain API. */
export function normalizeIdentityKey({ fullName, year, className }) {
  const normalize = (value) => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("en-US");
  return JSON.stringify([normalize(fullName), year.toUpperCase(), normalize(className)]);
}
