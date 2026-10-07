export type ProgramStatus = 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
export type ProgramAction = 'activate' | 'pause' | 'archive';

/**
 * Lifecycle:  DRAFT -> ACTIVE <-> PAUSED,  any non-archived state -> ARCHIVED (terminal).
 * Returns the target status, 'NOOP' when already there (idempotent), or null when the move is invalid.
 */
export function transition(
  current: ProgramStatus,
  action: ProgramAction,
): ProgramStatus | 'NOOP' | null {
  switch (action) {
    case 'activate':
      if (current === 'ACTIVE') return 'NOOP';
      return current === 'DRAFT' || current === 'PAUSED' ? 'ACTIVE' : null;
    case 'pause':
      if (current === 'PAUSED') return 'NOOP';
      return current === 'ACTIVE' ? 'PAUSED' : null;
    case 'archive':
      return current === 'ARCHIVED' ? 'NOOP' : 'ARCHIVED';
  }
}

/** Fields that cannot change once customers hold memberships, because progress is derived from them. */
export const MEMBER_LOCKED_FIELDS = ['stampsRequired'] as const;

/** Only ACTIVE programs accept new members (and, later, stamps). */
export const isEnrollable = (status: ProgramStatus): boolean => status === 'ACTIVE';

export const STAMP_ICONS = ['coffee', 'star', 'heart', 'check', 'gift'] as const;
