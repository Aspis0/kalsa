/**
 * Entity containment check for privacy guard.
 * Blocks if query contains:
 * 1. A distinctive token from fact (contains digit, @, or starts uppercase AND is not first token)
 * 2. Two or more consecutive content tokens from fact
 * Case-insensitive, same normalization as existing rule.
 */

export function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

function tokenizeOriginal(s: string): string[] {
  return s.trim().split(/\s+/).filter((t) => t.length > 0);
}

function tokenizeNormalized(s: string): string[] {
  return normalize(s).split(/\s+/).filter((t) => t.length > 0);
}

function isDistinctive(token: string, isFirst: boolean): boolean {
  // Contains digit
  if (/\d/.test(token)) return true;
  // Contains @
  if (/@/.test(token)) return true;
  // Starts with uppercase letter AND is not the first token (excludes sentence-initial capitalization)
  if (!isFirst) {
    const first = token.charAt(0);
    if (first !== first.toLowerCase() && first === first.toUpperCase()) return true;
  }
  return false;
}

/**
 * Check if query contains private data from fact.
 * Returns true if query should be blocked.
 */
export function containsPrivateData(query: string, fact: string): boolean {
  const queryTokens = tokenizeNormalized(query);
  const factTokensOriginal = tokenizeOriginal(fact);
  const factTokensNormalized = tokenizeNormalized(fact);

  if (queryTokens.length === 0 || factTokensNormalized.length === 0) return false;

  // Rule 1: query contains a distinctive token from fact
  for (let i = 0; i < factTokensOriginal.length; i++) {
    const factToken = factTokensOriginal[i];
    if (isDistinctive(factToken, i === 0)) {
      const factTokenNorm = normalize(factToken);
      if (queryTokens.includes(factTokenNorm)) return true;
    }
  }

  // Rule 2: query contains 2+ consecutive content tokens from fact
  if (factTokensNormalized.length >= 2) {
    for (let i = 0; i < factTokensNormalized.length - 1; i++) {
      const pair = [factTokensNormalized[i], factTokensNormalized[i + 1]];
      for (let j = 0; j < queryTokens.length - 1; j++) {
        if (queryTokens[j] === pair[0] && queryTokens[j + 1] === pair[1]) {
          return true;
        }
      }
    }
  }

  return false;
}
