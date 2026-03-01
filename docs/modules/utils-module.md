# Module: `src/utils.ts`

## Responsibility

Converts generic YES/NO direction into human-readable statements based on market question patterns.

## Key function

- `getDirectionLabel(market, direction)`
  - Handles common prediction-market phrasings:
    - `"Will X ...?"`
    - `"X to ..."`
    - `"A vs B"`
  - Returns a readable affirmative/negative prediction line.

## Internal helper

- `negateStatement(statement)`
  - Applies regex-based verb negation for common cases:
    - beat, win, pass, remain, score, and others

## Why it matters

Improves clarity of prediction output in dashboard and logs without changing underlying decision logic.

