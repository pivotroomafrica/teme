export {
  DEFAULT_RANGE_DAYS,
  MAX_RANGE_DAYS,
  resolveRange,
  type RangeResult,
  type ResolvedRange,
} from '../../../common/time/range';

/** Keys that identify devices and networks; only owners may see them. */
export const NETWORK_METADATA_KEYS = ['ip', 'userAgent', 'deviceLabel'] as const;

export function stripNetworkMetadata(metadata: unknown): unknown {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return metadata;
  const copy: Record<string, unknown> = { ...(metadata as Record<string, unknown>) };
  for (const key of NETWORK_METADATA_KEYS) delete copy[key];
  return copy;
}
