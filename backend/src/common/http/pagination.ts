import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export class PageQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_SIZE, default: DEFAULT_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number;

  @ApiPropertyOptional({ description: 'Opaque cursor from a previous response (`nextCursor`).' })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  cursor?: string;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Keyset cursor over (time DESC, id DESC): stable under concurrent inserts. */
export function encodeCursor(at: Date, id: string): string {
  return Buffer.from(JSON.stringify([at.toISOString(), id])).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): { at: Date; id: string } | null {
  if (!cursor) return null;
  try {
    const [at, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as [
      string,
      string,
    ];
    const date = new Date(at);
    if (Number.isNaN(date.getTime()) || typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) {
      return null;
    }
    return { at: date, id };
  } catch {
    return null;
  }
}
