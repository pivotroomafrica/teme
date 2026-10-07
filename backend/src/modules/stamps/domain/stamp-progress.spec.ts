import { completesCard, progressFor } from './stamp-progress';

describe('progressFor', () => {
  it('starts empty', () => {
    expect(progressFor(0, 5)).toEqual({ current: 0, required: 5, remaining: 5, completedCards: 0 });
  });
  it('counts within a card', () => {
    expect(progressFor(3, 5)).toEqual({ current: 3, required: 5, remaining: 2, completedCards: 0 });
    expect(progressFor(4, 5).remaining).toBe(1);
  });
  it('rolls over exactly at the threshold and keeps counting completed cards', () => {
    expect(progressFor(5, 5)).toEqual({ current: 0, required: 5, remaining: 5, completedCards: 1 });
    expect(progressFor(12, 5)).toEqual({
      current: 2,
      required: 5,
      remaining: 3,
      completedCards: 2,
    });
  });
  it('works for a one-stamp program', () => {
    expect(progressFor(3, 1)).toEqual({ current: 0, required: 1, remaining: 1, completedCards: 3 });
  });
  it('never goes negative', () => {
    expect(progressFor(-2, 5).current).toBe(0);
  });
  it('rejects an invalid threshold', () => {
    expect(() => progressFor(1, 0)).toThrow();
    expect(() => progressFor(1, 2.5)).toThrow();
  });
});

describe('completesCard', () => {
  it('is true only on multiples of the threshold', () => {
    expect([1, 2, 3, 4, 5, 6, 10, 11].map((n) => completesCard(n, 5))).toEqual([
      false,
      false,
      false,
      false,
      true,
      false,
      true,
      false,
    ]);
    expect(completesCard(0, 5)).toBe(false);
  });
});
