// lib/auth/vaildateNames.ts

const BANNED_NAME_TOKENS = new Set([
  "noname",
  "test",
  "na",
  "firstname",
  "lastname",
  "first",
  "last",
  "one",
  "two",
  "user",
  "customer",
  "unknown",
]);

function normalizeNameToken(name: string): string {
  return name.toLowerCase().replace(/[^a-z\u00c0-\u024f]+/gi, "");
}

export function validateSignupNames(
  firstName: string,
  lastName: string
): string | null {
  const fn = firstName.trim();
  const ln = lastName.trim();

  if (!fn || !ln) {
    return "First and last name are required.";
  }

  if (fn.length < 2 || ln.length < 2) {
    return "First and last name must be at least 2 characters each.";
  }

  const nameChars = /^[\p{L}\s'\u2019-]+$/u;
  if (!nameChars.test(fn) || !nameChars.test(ln)) {
    return "Names can only contain letters (A–Z) plus spaces, hyphens, or apostrophes.";
  }

  const isNumericOnly = (s: string) => /^\d+$/.test(s.replace(/\s+/g, ""));
  if (isNumericOnly(fn) || isNumericOnly(ln)) {
    return "Names cannot be only numbers.";
  }

  const nf = normalizeNameToken(fn);
  const nl = normalizeNameToken(ln);

  if (!nf || !nl) {
    return "Please enter a valid first and last name.";
  }

  if (BANNED_NAME_TOKENS.has(nf) || BANNED_NAME_TOKENS.has(nl)) {
    return 'Please enter your real first and last name (not a placeholder like "Test" or "No Name").';
  }

  if (nf === nl) {
    return "First and last name cannot be the same.";
  }

  return null;
}
