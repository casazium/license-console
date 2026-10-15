/**
 * Boot-time hook (security review finding, third-party audit,
 * R3-CONSOLE-H1). lib/db.ts's own MULTI_TENANT-vs-accounts-table guard
 * only ever ran the first time something called getDb() - and on the
 * exact vulnerable path (MULTI_TENANT dropped while real SaaS accounts
 * still exist), *nothing* on the session-verification path calls
 * getDb() at all (see lib/session.ts's own comment on the new `mode`
 * check for the full mechanics), so the guard never actually fired. A
 * throw inside a lazily-invoked function is not "refusing to start" -
 * it's "erroring on whichever unlucky request happens to trigger it
 * first," and every other request kept being served in the meantime
 * (confirmed live by the audit).
 *
 * register() runs once, before this server accepts its first request,
 * in both `next dev` and the standalone `server.js` - calling getDb()
 * here eagerly forces that guard to run at actual boot time, and
 * process.exit(1) makes a thrown guard failure impossible to route
 * around, rather than relying on an uncaught rejection during Next's own
 * startup sequence to have the effect it's supposed to.
 *
 * NEXT_RUNTIME guard: Turbopack still compiles this file for the Edge
 * runtime too, although nothing here runs there - in Next 16, proxy.ts
 * runs on Node.js (CRASH_REPORTING_DESIGN.md §6.2) - so anything Node-only
 * (better-sqlite3 is a native addon, process.on) stays behind this check
 * and a dynamic import.
 *
 * It also reads `LICENSE_ADMIN_API_KEY_FILE` (lib/secret-files.ts) first,
 * for the same reason: an unreadable key file should stop the server at
 * boot, not surface as a 403 on whichever request first talks to License
 * Server. proxy.ts never reads the admin key, so reading it here alone
 * is enough too.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  try {
    const { applySecretFiles } = await import("./lib/secret-files");
    const fromFiles = applySecretFiles(process.env);
    if (fromFiles.length > 0) {
      console.log(
        `Read ${fromFiles.join(", ")} from the file(s) named by *_FILE.`,
      );
    }

    const { getDb } = await import("./lib/db");
    getDb();
  } catch (err) {
    console.error("Fatal error during startup:", err);
    process.exit(1);
  }

  // Crash reporting (CRASH_REPORTING_DESIGN.md §5): outside the block
  // above, whose catch exits, so a reporter bug can never stop the Console.
  // Off, and silent, unless CRASH_REPORT_HOSTED=true.
  try {
    const { startReporter } = await import("./lib/crash-reporter");
    startReporter();
  } catch (err) {
    console.error("crash reporting couldn't start; carrying on without it:", err);
  }
}

/**
 * Next calls this for an error thrown in a render, a route handler or a
 * server action (not the proxy: §6.2). Only the method is read from the
 * request: its path carries the query string and its headers the cookies
 * (§6). The reporter itself only enqueues, so nothing here waits.
 */
export async function onRequestError(
  error: unknown,
  request: Readonly<{ method: string }>,
  context: Readonly<{ routePath?: string; routeType?: string; routerKind?: string }>,
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }
  try {
    const { reportRequestError } = await import("./lib/crash-reporter");
    reportRequestError(error, request.method, context);
  } catch {
    // reporting must never break the request
  }
}
