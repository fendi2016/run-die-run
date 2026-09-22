// Wire contract for GET /api/currency — the signed-in player's current
// Shards balance (earn-only for now, spent by a shop that doesn't exist
// yet). A dedicated endpoint rather than folding it into another response
// since it needs to be readable from MainMenu, not just after a run.
export type CurrencyBalanceResponse = {
  balance: number;
};

export function isCurrencyBalanceResponse(
  value: unknown
): value is CurrencyBalanceResponse {
  return (
    typeof value === 'object' &&
    value !== null &&
    'balance' in value &&
    typeof value.balance === 'number'
  );
}
