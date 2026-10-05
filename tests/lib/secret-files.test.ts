import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { applySecretFiles } from "@/lib/secret-files";

// applySecretFiles: `LICENSE_ADMIN_API_KEY_FILE` support. casazium/license's
// self-hosted bundle hands one generated admin key to License Server and
// this console through a shared file, so a missing or empty file must stop
// startup - a console with no key (or a different one) would 403 on every
// call while looking healthy. Mirrors casazium/license's own tests for its
// identical function (tests/generate-secrets-lib.test.js).
describe("applySecretFiles (lib/secret-files.ts)", () => {
  const files: Record<string, string> = {
    "/run/key": "abc123",
    "/run/key-newline": "abc123\n",
    "/run/empty": "\n",
  };
  const read = (p: string) => {
    if (!(p in files))
      throw Object.assign(new Error("no such file"), { code: "ENOENT" });
    return files[p];
  };

  it("reads LICENSE_ADMIN_API_KEY from the file when only _FILE is set", () => {
    const env: Record<string, string | undefined> = {
      LICENSE_ADMIN_API_KEY_FILE: "/run/key",
    };
    expect(applySecretFiles(env, undefined, read)).toEqual([
      "LICENSE_ADMIN_API_KEY",
    ]);
    expect(env.LICENSE_ADMIN_API_KEY).toBe("abc123");
  });

  it("strips a trailing newline", () => {
    const env: Record<string, string | undefined> = {
      LICENSE_ADMIN_API_KEY_FILE: "/run/key-newline",
    };
    applySecretFiles(env, undefined, read);
    expect(env.LICENSE_ADMIN_API_KEY).toBe("abc123");
  });

  it("a value set directly wins over its _FILE", () => {
    const env: Record<string, string | undefined> = {
      LICENSE_ADMIN_API_KEY: "explicit",
      LICENSE_ADMIN_API_KEY_FILE: "/run/key",
    };
    expect(applySecretFiles(env, undefined, read)).toEqual([]);
    expect(env.LICENSE_ADMIN_API_KEY).toBe("explicit");
  });

  it("an empty direct value (a blank .env line) does not block the file", () => {
    const env: Record<string, string | undefined> = {
      LICENSE_ADMIN_API_KEY: "",
      LICENSE_ADMIN_API_KEY_FILE: "/run/key",
    };
    applySecretFiles(env, undefined, read);
    expect(env.LICENSE_ADMIN_API_KEY).toBe("abc123");
  });

  it("throws when the file cannot be read", () => {
    const env: Record<string, string | undefined> = {
      LICENSE_ADMIN_API_KEY_FILE: "/run/missing",
    };
    expect(() => applySecretFiles(env, undefined, read)).toThrow(
      /LICENSE_ADMIN_API_KEY_FILE is set to \/run\/missing.*ENOENT/,
    );
    expect(env.LICENSE_ADMIN_API_KEY).toBeUndefined();
  });

  it("throws when the file is empty", () => {
    const env: Record<string, string | undefined> = {
      LICENSE_ADMIN_API_KEY_FILE: "/run/empty",
    };
    expect(() => applySecretFiles(env, undefined, read)).toThrow(/is empty/);
  });

  it("does nothing when no _FILE is set", () => {
    const env: Record<string, string | undefined> = {
      LICENSE_ADMIN_API_KEY: "x",
    };
    expect(applySecretFiles(env, undefined, read)).toEqual([]);
    expect(env).toEqual({ LICENSE_ADMIN_API_KEY: "x" });
  });

  it("reads a real file with the default reader", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "secret-files-"));
    try {
      writeFileSync(path.join(dir, "admin-api-key"), "from-disk");
      const env: Record<string, string | undefined> = {
        LICENSE_ADMIN_API_KEY_FILE: path.join(dir, "admin-api-key"),
      };
      applySecretFiles(env);
      expect(env.LICENSE_ADMIN_API_KEY).toBe("from-disk");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
