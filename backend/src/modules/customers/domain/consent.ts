/** Version of the terms / privacy / marketing wording shown on the join form. Bump on any change. */
export const CURRENT_CONSENT_VERSION = '2026-10-v1';

export type ConsentType = 'LOYALTY_TERMS' | 'MARKETING';
export type ConsentAction = 'GRANTED' | 'WITHDRAWN';

export interface ConsentRow {
  type: ConsentType;
  action: ConsentAction;
  occurredAt: Date;
}

/** Current state = the latest row per type. No row means never granted. */
export function isGranted(rows: ConsentRow[], type: ConsentType): boolean {
  let latest: ConsentRow | undefined;
  for (const row of rows) {
    if (row.type !== type) continue;
    if (!latest || row.occurredAt.getTime() >= latest.occurredAt.getTime()) latest = row;
  }
  return latest?.action === 'GRANTED';
}

export type ConsentSource = 'JOIN_FORM' | 'STAFF_ASSISTED' | 'PRIVACY_REQUEST' | 'IMPORT';
