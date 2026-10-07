import { ProgramAction, ProgramStatus, transition } from './program-lifecycle';

const S: ProgramStatus[] = ['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED'];

describe('program lifecycle', () => {
  const table: Record<ProgramAction, Record<ProgramStatus, ProgramStatus | 'NOOP' | null>> = {
    activate: { DRAFT: 'ACTIVE', ACTIVE: 'NOOP', PAUSED: 'ACTIVE', ARCHIVED: null },
    pause: { DRAFT: null, ACTIVE: 'PAUSED', PAUSED: 'NOOP', ARCHIVED: null },
    archive: { DRAFT: 'ARCHIVED', ACTIVE: 'ARCHIVED', PAUSED: 'ARCHIVED', ARCHIVED: 'NOOP' },
  };

  for (const action of Object.keys(table) as ProgramAction[]) {
    for (const status of S) {
      it(`${action} from ${status} -> ${String(table[action][status])}`, () => {
        expect(transition(status, action)).toBe(table[action][status]);
      });
    }
  }

  it('never leaves ARCHIVED', () => {
    expect(transition('ARCHIVED', 'activate')).toBeNull();
    expect(transition('ARCHIVED', 'pause')).toBeNull();
  });
});
