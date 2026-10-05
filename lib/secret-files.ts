import { readFileSync } from "node:fs";

/**
 * Docker-secrets-style `<NAME>_FILE` support: when
 * `LICENSE_ADMIN_API_KEY_FILE=/path` is set and `LICENSE_ADMIN_API_KEY`
 * itself isn't, read the value from that file into the environment. The
 * same convention the official Postgres/MySQL images use, and the same
 * rules as casazium/license's own applySecretFiles()
 * (scripts/generate-secrets-lib.js), so the two sides of one shared key
 * behave identically:
 *
 * - A value set directly wins over its `_FILE`.
 * - A `_FILE` that can't be read, or holds nothing, throws - the caller
 *   stops the server rather than starting with no key.
 * - Only trailing line endings are stripped.
 *
 * casazium/license's self-hosted bundle generates one admin key into a
 * shared volume and points both services at it; before this, the bundle
 * had to replace this image's start command with a shell wrapper to get
 * the key into the environment. Called once, from instrumentation.ts's
 * register(), before the server handles any request - every reader of
 * LICENSE_ADMIN_API_KEY reads process.env at request time, so they all
 * see the file's value.
 */
export const FILE_BACKED_KEYS = ["LICENSE_ADMIN_API_KEY"] as const;

export function applySecretFiles(
  env: Record<string, string | undefined>,
  keys: readonly string[] = FILE_BACKED_KEYS,
  read: (path: string) => string = (path) => readFileSync(path, "utf8"),
): string[] {
  const applied: string[] = [];
  for (const key of keys) {
    const fileVar = `${key}_FILE`;
    const filePath = env[fileVar];
    if (!filePath || env[key]) continue;
    let contents: string;
    try {
      contents = read(filePath);
    } catch (err) {
      const reason =
        (err as NodeJS.ErrnoException).code ?? (err as Error).message;
      throw new Error(
        `${fileVar} is set to ${filePath}, but that file can't be read (${reason}).`,
      );
    }
    const value = contents.replace(/(\r?\n)+$/, "");
    if (!value) {
      throw new Error(
        `${fileVar} is set to ${filePath}, but that file is empty.`,
      );
    }
    env[key] = value;
    applied.push(key);
  }
  return applied;
}
