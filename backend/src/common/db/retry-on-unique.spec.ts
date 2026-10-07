import { retryOnUniqueViolation } from './retry-on-unique';

const unique = () => Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

describe('retryOnUniqueViolation', () => {
  it('returns the first success without retrying', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(retryOnUniqueViolation(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries after a unique violation and returns the later result', async () => {
    const fn = jest.fn().mockRejectedValueOnce(unique()).mockResolvedValue('second');
    await expect(retryOnUniqueViolation(fn)).resolves.toBe('second');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after the retry budget and rethrows', async () => {
    const fn = jest.fn().mockRejectedValue(unique());
    await expect(retryOnUniqueViolation(fn, 2)).rejects.toMatchObject({ code: 'P2002' });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('never retries other errors', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('boom'));
    await expect(retryOnUniqueViolation(fn)).rejects.toThrow('boom');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
