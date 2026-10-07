import { REDACT_PATHS } from './logger.module';

describe('log redaction', () => {
  it('covers credentials and scanner secrets', () => {
    for (const path of [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.body.password',
      'req.body.refreshToken',
      'req.body.cardToken',
    ]) {
      expect(REDACT_PATHS).toContain(path);
    }
  });
});
