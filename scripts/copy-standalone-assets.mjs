// next.config.mjs sets output: 'standalone', which bundles only the server
// and the node_modules subset it needs - public/ and .next/static are
// intentionally left out and must be copied in separately, or the app boots
// but 404s on every static asset and public file. Docker's own multi-stage
// build does this same copy at the image-layer level (see Dockerfile); this
// script exists so `npm run build && npm run start` produces a working
// server without Docker too, on any OS (fs.cpSync instead of a shell `cp`).
import { cpSync, existsSync } from 'node:fs';

const STANDALONE_DIR = '.next/standalone';

if (!existsSync(STANDALONE_DIR)) {
  console.error(
    `${STANDALONE_DIR} not found - expected after \`next build\` with output: 'standalone' set in next.config.mjs.`
  );
  process.exit(1);
}

cpSync('public', `${STANDALONE_DIR}/public`, { recursive: true });
cpSync('.next/static', `${STANDALONE_DIR}/.next/static`, { recursive: true });
