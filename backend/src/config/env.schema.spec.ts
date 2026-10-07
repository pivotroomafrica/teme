import { validateEnv } from './env.schema';

const valid = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  JWT_ACCESS_SECRET: 'x'.repeat(40),
};

describe('validateEnv', () => {
  it('applies defaults', () => {
    const env = validateEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.SWAGGER_ENABLED).toBe(false);
    expect(env.CORS_ORIGINS).toEqual([]);
  });

  it('parses comma-separated CORS origins', () => {
    const env = validateEnv({ ...valid, CORS_ORIGINS: 'http://a.test, http://b.test' });
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('rejects a missing or non-PostgreSQL DATABASE_URL', () => {
    expect(() => validateEnv({ JWT_ACCESS_SECRET: valid.JWT_ACCESS_SECRET })).toThrow(
      /DATABASE_URL/,
    );
    expect(() => validateEnv({ ...valid, DATABASE_URL: 'mysql://u:p@h/db' })).toThrow(/PostgreSQL/);
  });

  it('rejects a wildcard CORS origin in production', () => {
    expect(() => validateEnv({ ...valid, NODE_ENV: 'production', CORS_ORIGINS: '*' })).toThrow(
      /wildcard/,
    );
  });

  describe('production safeguards', () => {
    const prod = {
      ...valid,
      NODE_ENV: 'production',
      JWT_ACCESS_SECRET: 'Zq8vN3tK1xW6pL9sD2fG5hJ7mB4cR0yU',
    };

    it('accepts a sound production configuration', () => {
      expect(() => validateEnv({ ...prod, CORS_ORIGINS: 'https://app.example.org' })).not.toThrow();
    });

    it('rejects placeholder secrets and default database passwords', () => {
      expect(() =>
        validateEnv({ ...prod, JWT_ACCESS_SECRET: 'replace_with_long_random_string_min_32_chars' }),
      ).toThrow(/placeholder/);
      expect(() =>
        validateEnv({ ...prod, DATABASE_URL: 'postgresql://temelash:change_me@db:5432/app' }),
      ).toThrow(/DATABASE_URL/);
    });

    it('requires https origins', () => {
      expect(() => validateEnv({ ...prod, CORS_ORIGINS: 'http://app.example.org' })).toThrow(
        /https/,
      );
    });

    it('bounds the trusted proxy count', () => {
      expect(validateEnv({ ...valid, TRUST_PROXY: '1' }).TRUST_PROXY).toBe(1);
      expect(validateEnv(valid).TRUST_PROXY).toBe(0);
      expect(() => validateEnv({ ...valid, TRUST_PROXY: '-1' })).toThrow(/TRUST_PROXY/);
    });
  });

  it('requires a JWT secret', () => {
    expect(() => validateEnv({ DATABASE_URL: valid.DATABASE_URL })).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('rejects a short JWT secret', () => {
    expect(() => validateEnv({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  describe('wallet configuration', () => {
    const secret = 's'.repeat(40);

    it('needs nothing when no provider is enabled', () => {
      const env = validateEnv(valid);
      expect(env.WALLET_MODE).toBe('fake');
      expect(env.WALLET_APPLE_ENABLED).toBe(false);
      expect(env.OUTBOX_WORKER_ENABLED).toBe(true);
    });

    it('requires a barcode secret as soon as a provider is enabled', () => {
      expect(() => validateEnv({ ...valid, WALLET_APPLE_ENABLED: 'true' })).toThrow(
        /WALLET_BARCODE_SECRET/,
      );
      expect(() =>
        validateEnv({ ...valid, WALLET_GOOGLE_ENABLED: 'true', WALLET_BARCODE_SECRET: 'short' }),
      ).toThrow(/WALLET_BARCODE_SECRET/);
      expect(() =>
        validateEnv({ ...valid, WALLET_GOOGLE_ENABLED: 'true', WALLET_BARCODE_SECRET: secret }),
      ).not.toThrow();
    });

    it('treats blank values as unset', () => {
      const env = validateEnv({ ...valid, APPLE_TEAM_ID: '  ', WALLET_BARCODE_SECRET: '' });
      expect(env.APPLE_TEAM_ID).toBeUndefined();
      expect(env.WALLET_BARCODE_SECRET).toBeUndefined();
    });

    it('does not demand Apple or Google credentials in fake mode', () => {
      expect(() =>
        validateEnv({
          ...valid,
          WALLET_APPLE_ENABLED: 'true',
          WALLET_GOOGLE_ENABLED: 'true',
          WALLET_BARCODE_SECRET: secret,
        }),
      ).not.toThrow();
    });

    it('forbids fake adapters in production', () => {
      expect(() =>
        validateEnv({
          ...valid,
          NODE_ENV: 'production',
          WALLET_APPLE_ENABLED: 'true',
          WALLET_BARCODE_SECRET: secret,
        }),
      ).toThrow(/fake wallet adapters/);
    });

    it('requires Apple credentials only when Apple is enabled in live mode', () => {
      const live = {
        ...valid,
        WALLET_MODE: 'live',
        WALLET_BARCODE_SECRET: secret,
        WALLET_PUBLIC_BASE_URL: 'https://api.example.test',
      };
      expect(() => validateEnv(live)).not.toThrow(); // nothing enabled
      expect(() =>
        validateEnv({
          ...live,
          WALLET_GOOGLE_ENABLED: 'true',
          GOOGLE_WALLET_ISSUER_ID: '1',
          GOOGLE_WALLET_SERVICE_ACCOUNT_KEY_PATH: '/k.json',
          GOOGLE_WALLET_DEFAULT_LOGO_URL: 'https://x/y.png',
        }),
      ).not.toThrow();
      const err = (() => {
        try {
          validateEnv({ ...live, WALLET_APPLE_ENABLED: 'true' });
        } catch (e) {
          return (e as Error).message;
        }
        return '';
      })();
      for (const key of [
        'APPLE_PASS_TYPE_ID',
        'APPLE_TEAM_ID',
        'APPLE_PASS_CERT_PATH',
        'APPLE_PASS_KEY_PATH',
        'APPLE_WWDR_CERT_PATH',
      ]) {
        expect(err).toContain(key);
      }
      expect(err).not.toContain('GOOGLE_');
    });

    it('requires https links in live mode', () => {
      expect(() =>
        validateEnv({
          ...valid,
          WALLET_MODE: 'live',
          WALLET_GOOGLE_ENABLED: 'true',
          WALLET_BARCODE_SECRET: secret,
          WALLET_PUBLIC_BASE_URL: 'http://api.example.test',
          GOOGLE_WALLET_ISSUER_ID: '1',
          GOOGLE_WALLET_SERVICE_ACCOUNT_KEY_PATH: '/k.json',
          GOOGLE_WALLET_DEFAULT_LOGO_URL: 'https://x/y.png',
        }),
      ).toThrow(/https/);
    });
  });
});
