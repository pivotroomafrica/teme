export interface Progress {
  /** Stamps on the card currently being filled (0 .. required-1). */
  current: number;
  required: number;
  remaining: number;
  /** Cards completed so far (each earned one reward). */
  completedCards: number;
}

/**
 * Progress is a pure function of the number of effective (non-reversed) stamps and the program
 * threshold. Nothing is stored, so it cannot drift from the ledger and a reversal simply changes
 * the count. Staff have no way to set a total.
 */
export function progressFor(effectiveStamps: number, required: number): Progress {
  if (!Number.isInteger(required) || required < 1)
    throw new Error('required must be a positive integer');
  const total = Math.max(0, effectiveStamps);
  const current = total % required;
  return {
    current,
    required,
    remaining: required - current,
    completedCards: Math.floor(total / required),
  };
}

/** True when the stamp that brought the total to `totalAfter` completes a card. */
export function completesCard(totalAfter: number, required: number): boolean {
  return totalAfter > 0 && totalAfter % required === 0;
}
