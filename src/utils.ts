// ============================================================
// Utility functions
// ============================================================

import { TradeDirection, GammaMarket } from "./types.js";

/**
 * Converts a generic YES/NO direction into a human-readable prediction
 * label specific to the market question.
 *
 * "Will Cavaliers beat Pistons?" + YES → "Cavaliers beat Pistons"
 * "Will Cavaliers beat Pistons?" + NO  → "Cavaliers DON'T beat Pistons"
 * "Donald Trump to win 2024?"    + YES → "Donald Trump to win 2024"
 * "Donald Trump to win 2024?"    + NO  → "Donald Trump WON'T win 2024"
 */
export function getDirectionLabel(
  market: GammaMarket,
  direction: TradeDirection
): string {
  const q = market.question.trim().replace(/\?+$/, "").trim();

  // Pattern 1: "Will [subject] [verb] [rest]"
  const willMatch = q.match(/^Will\s+(.+)/i);
  if (willMatch) {
    const statement = willMatch[1]!;
    if (direction === "YES") return statement;

    // Try to negate: "Will X beat Y" → "X WON'T beat Y"
    // Find the first verb-like word after the subject
    const verbNeg = negateStatement(statement);
    if (verbNeg) return verbNeg;
    return `NOT: ${statement}`;
  }

  // Pattern 2: "[subject] to [verb] [rest]" (e.g., "Trump to win election")
  const toMatch = q.match(/^(.+?)\s+to\s+(.+)/i);
  if (toMatch) {
    const [, subject, rest] = toMatch;
    if (direction === "YES") return `${subject} to ${rest}`;
    return `${subject} WON'T ${rest}`;
  }

  // Pattern 3: "[A] vs [B]" or "[A] v [B]" — sports matchup event title
  // Direction YES typically means the first-named team/entity
  const vsMatch = q.match(/^(.+?)\s+(?:vs\.?|v\.?|versus)\s+(.+)/i);
  if (vsMatch) {
    const [, teamA, teamB] = vsMatch;
    if (direction === "YES") return `${teamA!.trim()} wins`;
    return `${teamB!.trim()} wins`;
  }

  // Fallback: show the question with clear direction context
  if (direction === "YES") return q;
  return `NOT: ${q}`;
}

/** Try to negate a statement like "X beat Y" → "X WON'T beat Y" */
function negateStatement(statement: string): string | null {
  // Common verb patterns in prediction markets
  const patterns: Array<{ regex: RegExp; replacement: string }> = [
    { regex: /^(.+?\s+)(beat|defeat)\s+/i, replacement: "$1WON'T beat " },
    { regex: /^(.+?\s+)(win)\s+/i, replacement: "$1WON'T win " },
    { regex: /^(.+?\s+)(win)$/i, replacement: "$1WON'T win" },
    { regex: /^(.+?\s+)(pass)\s+/i, replacement: "$1WON'T pass " },
    { regex: /^(.+?\s+)(reach)\s+/i, replacement: "$1WON'T reach " },
    { regex: /^(.+?\s+)(happen)/i, replacement: "$1WON'T happen" },
    { regex: /^(.+?\s+)(be\s+)/i, replacement: "$1WON'T be " },
    { regex: /^(.+?\s+)(go\s+)/i, replacement: "$1WON'T go " },
    { regex: /^(.+?\s+)(become\s+)/i, replacement: "$1WON'T become " },
    { regex: /^(.+?\s+)(sign\s+)/i, replacement: "$1WON'T sign " },
    { regex: /^(.+?\s+)(trade\s+)/i, replacement: "$1WON'T trade " },
    { regex: /^(.+?\s+)(drop\s+)/i, replacement: "$1WON'T drop " },
    { regex: /^(.+?\s+)(rise\s+)/i, replacement: "$1WON'T rise " },
    { regex: /^(.+?\s+)(close\s+)/i, replacement: "$1WON'T close " },
    { regex: /^(.+?\s+)(launch\s+)/i, replacement: "$1WON'T launch " },
    { regex: /^(.+?\s+)(announce\s+)/i, replacement: "$1WON'T announce " },
    { regex: /^(.+?\s+)(remain\s+)/i, replacement: "$1WON'T remain " },
    { regex: /^(.+?\s+)(stay\s+)/i, replacement: "$1WON'T stay " },
    { regex: /^(.+?\s+)(make\s+)/i, replacement: "$1WON'T make " },
    { regex: /^(.+?\s+)(score\s+)/i, replacement: "$1WON'T score " },
  ];

  for (const { regex, replacement } of patterns) {
    if (regex.test(statement)) {
      return statement.replace(regex, replacement);
    }
  }

  return null;
}
