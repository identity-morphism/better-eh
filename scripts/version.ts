/** Shared version helpers for the release tooling. */

export const DIST_PATH = "dist/better-eh.user.js";

export type Bump = "major" | "minor" | "patch";

export const BUMPS: readonly Bump[] = ["major", "minor", "patch"];

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

interface Parts {
  major: number;
  minor: number;
  patch: number;
}

function parse(version: string): Parts {
  const match = SEMVER.exec(version);
  if (!match) {
    throw new Error(`not a semver version: ${version}`);
  }
  const [, major = "0", minor = "0", patch = "0"] = match;
  return { major: Number(major), minor: Number(minor), patch: Number(patch) };
}

/** The `@version` value of a built userscript, or null when the header has none. */
export function readHeaderVersion(code: string): string | null {
  return /^\/\/\s*@version\s+(\S+)\s*$/m.exec(code)?.[1] ?? null;
}

export function isBump(value: string): value is Bump {
  return BUMPS.some((bump) => bump === value);
}

export function isSemver(value: string): boolean {
  return SEMVER.test(value);
}

/** -1, 0 or 1 for `a` sorted against `b`. */
export function compareVersions(a: string, b: string): number {
  const left = parse(a);
  const right = parse(b);
  for (const key of ["major", "minor", "patch"] as const) {
    if (left[key] !== right[key]) {
      return left[key] < right[key] ? -1 : 1;
    }
  }
  return 0;
}

export function bumpVersion(current: string, bump: Bump): string {
  const { major, minor, patch } = parse(current);
  switch (bump) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

/**
 * The highest `vX.Y.Z` tag among `tags`, or null when none is a release tag.
 *
 * Compares versions, not names, so `v1.10.0` outranks `v1.9.0`; tags that are not strict semver
 * releases are ignored. Both the release script and the drift check use this one rule.
 */
export function newestReleaseTag(tags: readonly string[]): string | null {
  let newest: string | null = null;
  for (const tag of tags) {
    const version = tag.startsWith("v") ? tag.slice(1) : "";
    if (!isSemver(version)) {
      continue;
    }
    if (newest === null || compareVersions(version, newest.slice(1)) > 0) {
      newest = tag;
    }
  }
  return newest;
}
