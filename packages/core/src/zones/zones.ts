import { join } from 'node:path';
import { asCheckId, type CheckId, type Tier } from '@sentiness/check-sdk';
import type { CatalogCheckEntry, ResolvedConfig, ZoneCheckOverride } from '../config/config.js';

/**
 * One check placed inside one zone, with its tier and options already resolved
 * from the catalog entry plus any per-zone override.
 */
export type ResolvedCheckPlacement = {
  readonly id: CheckId;
  /** Catalog tier, overridden by the zone entry; `'standard'` if neither sets one. */
  readonly tier: Tier;
  /** Check-specific options (catalog merged with the zone override, zone winning). */
  readonly options: Readonly<Record<string, unknown>>;
};

/** A resolved zone: a repo subdirectory and the checks rooted at it. */
export type ResolvedZone = {
  readonly path: string; // repo-relative ('.' for the root zone)
  readonly absRoot: string; // repoRoot joined with path
  readonly checks: readonly ResolvedCheckPlacement[];
};

// Keys on a catalog entry that drive package/tier resolution rather than the
// check's runtime behavior; they must never leak into a placement's `options`.
const RESOLUTION_KEYS: ReadonlySet<string> = new Set(['version', 'path', 'tier']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Recursively merges plain objects; arrays and primitives are replaced wholesale. */
function deepMerge(
  base: Readonly<Record<string, unknown>>,
  override: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    result[key] =
      isPlainObject(existing) && isPlainObject(value) ? deepMerge(existing, value) : value;
  }
  return result;
}

function catalogOptions(entry: CatalogCheckEntry): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (!RESOLUTION_KEYS.has(key)) {
      out[key] = value;
    }
  }
  return out;
}

function overrideOptions(override: ZoneCheckOverride): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(override)) {
    if (key !== 'id' && key !== 'tier') {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Pure resolution of a v2 config's zones into rooted, option-merged placements.
 *
 * A single-root config (no `zones`) is already normalized by `resolveConfig` to
 * one zone at `'.'` carrying every catalog check, so this function does not need
 * a special case for it. A check id may appear in several zones — each yields its
 * own placement; the same catalog version applies (one version per repo by
 * design). The function never touches the filesystem.
 */
export function resolveZones(config: ResolvedConfig, repoRoot: string): readonly ResolvedZone[] {
  return config.zones.map((zone) => {
    const checks = zone.checks.map((entry): ResolvedCheckPlacement => {
      const isBareId = typeof entry === 'string';
      const id = isBareId ? entry : entry.id;
      const catalogEntry = config.checks[id];
      const base = catalogEntry ? catalogOptions(catalogEntry) : {};
      const override = isBareId ? {} : overrideOptions(entry);
      const tier: Tier = (isBareId ? undefined : entry.tier) ?? catalogEntry?.tier ?? 'standard';
      return {
        id: asCheckId(id),
        tier,
        options: deepMerge(base, override),
      };
    });
    return {
      path: zone.path,
      absRoot: join(repoRoot, zone.path),
      checks,
    };
  });
}
