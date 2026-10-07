import { hash, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';

@Injectable()
export class PasswordService {
  /** Verification target for unknown accounts so response timing does not reveal them. */
  private dummyHash: Promise<string> | undefined;

  /** argon2id with the library defaults (memory-hard). */
  hash(password: string): Promise<string> {
    return hash(password);
  }

  async verify(passwordHash: string, password: string): Promise<boolean> {
    try {
      return await verify(passwordHash, password);
    } catch {
      return false; // malformed hash must never authenticate
    }
  }

  async verifyAgainstDummy(password: string): Promise<void> {
    this.dummyHash ??= hash('dummy-password-for-timing-equalisation');
    await this.verify(await this.dummyHash, password);
  }
}
