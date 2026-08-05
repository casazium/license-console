// next.config.mjs sets output: 'standalone', which bundles only the server
// and the node_modules subset it needs - public/ and .next/static are
// intentionally left out and must be copied in separately, or the app boots
// but 404s on every static asset and public file. Docker's own multi-stage
// build does this same copy at the image-layer level (see Dockerfile); this
// script exists so `npm run build && npm run start` produces a working
// server without Docker too, on any OS (fs.cpSync instead of a shell `cp`).
//
// .next/standalone/server.js also does process.chdir(__dirname) before
// Next's own env-file loading runs, so .env.local etc at the project root
// are invisible to it - confirmed by reproducing a "Missing required
// environment variable" 500 with a real .env.local present. These are
// Next's own production env-file names (loadEnvConfig's precedence order,
// highest first); copy whichever exist so standalone mode sees the same
// values `next start` would have.
//
// lib/db/schema.sql (SaaS-B1a) needs the same treatment for the same
// underlying reason: the standalone tracer only follows the JS import
// graph, and a runtime fs.readFileSync() path to a non-JS file (lib/db.ts)
// is invisible to it.
import { cpSync, existsSync, mkdirSync } from 'node:fs';

const STANDALONE_DIR = '.next/standalone';

if (!existsSync(STANDALONE_DIR)) {
  console.error(
    `${STANDALONE_DIR} not found - expected after \`next build\` with output: 'standalone' set in next.config.mjs.`
  );
  process.exit(1);
}

cpSync('public', `${STANDALONE_DIR}/public`, { recursive: true });
cpSync('.next/static', `${STANDALONE_DIR}/.next/static`, { recursive: true });

// Unlike public/ and .next/static above, .next/standalone/lib/db/ doesn't
// exist yet at all - the standalone tracer compiles route/page code into
// .next/server/, it doesn't copy original lib/*.ts sources verbatim - so
// the destination directory needs creating before the file copy, not just
// the file itself.
mkdirSync(`${STANDALONE_DIR}/lib/db`, { recursive: true });
cpSync('lib/db/schema.sql', `${STANDALONE_DIR}/lib/db/schema.sql`);

const ENV_FILES = ['.env.production.local', '.env.local', '.env.production', '.env'];
for (const file of ENV_FILES) {
  if (existsSync(file)) {
    cpSync(file, `${STANDALONE_DIR}/${file}`);
  }
}
