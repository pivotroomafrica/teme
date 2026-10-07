import { isValidTimezone } from './timezone';

describe('isValidTimezone', () => {
  it.each(['Africa/Addis_Ababa', 'UTC', 'Europe/London', 'America/Argentina/Buenos_Aires'])(
    'accepts %s',
    (tz) => expect(isValidTimezone(tz)).toBe(true),
  );
  it.each(['', 'EAT', '+03:00', 'Mars/Olympus_Mons_X', 'Africa', 'africa/../etc', "x'; drop"])(
    'rejects %p',
    (tz) => expect(isValidTimezone(tz)).toBe(false),
  );
});
