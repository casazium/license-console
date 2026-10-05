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
 * NEXT_RUNTIME guard: instrumentation registers for every runtime this
 * app uses (Node.js for routes/actions, Edge for proxy.ts's middleware)
 * - better-sqlite3 is a native addon that doesn't exist in the Edge
 * runtime, so this must only run once, in the Node.js runtime.
 *
 * It also reads `LICENSE_ADMIN_API_KEY_FILE` (lib/secret-files.ts) first,
 * for the same reason: an unreadable key file should stop the server at
 * boot, not surface as a 403 on whichever request first talks to License
 * Server. proxy.ts (Edge) never reads the admin key, so Node.js-only is
 * enough here too.
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
}
