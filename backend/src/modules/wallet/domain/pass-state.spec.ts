import { isLive, parseColor, pick, progressText, readableTextColor } from './pass-state';

describe('pass state helpers', () => {
  it('picks Amharic when requested and available, English otherwise', () => {
    const text = { en: 'Free coffee', am: 'ነጻ ቡና' };
    expect(pick(text, 'AM')).toBe('ነጻ ቡና');
    expect(pick(text, 'EN')).toBe('Free coffee');
    expect(pick({ en: 'Only English', am: null }, 'AM')).toBe('Only English');
  });

  it('formats progress', () => {
    expect(progressText({ currentStamps: 3, stampsRequired: 8 })).toBe('3 / 8');
  });

  it('knows which statuses are live', () => {
    expect(isLive('ACTIVE')).toBe(true);
    expect(isLive('PENDING')).toBe(true);
    expect(isLive('SUSPENDED')).toBe(false);
    expect(isLive('INVALIDATED')).toBe(false);
  });

  it('parses hex colours with a safe fallback', () => {
    expect(parseColor('#7A4B2A')).toEqual([122, 75, 42]);
    expect(parseColor(null)).toEqual([51, 51, 51]);
    expect(parseColor('red')).toEqual([51, 51, 51]);
  });

  it('chooses readable text colours', () => {
    expect(readableTextColor([0, 0, 0])).toEqual([255, 255, 255]);
    expect(readableTextColor([255, 255, 255])).toEqual([0, 0, 0]);
    expect(readableTextColor([122, 75, 42])).toEqual([255, 255, 255]);
    expect(readableTextColor([255, 220, 100])).toEqual([0, 0, 0]);
  });
});
