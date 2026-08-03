// APP_VERSION/GIT_SHA are computed once at build time in next.config.mjs's
// `env` block (see the comment there for why - the Docker runner stage has
// no .git to read from at request time). Fallbacks here are defensive only
// - next.config.mjs's env block runs for both `next dev` and `next build`,
// so these should always be present in practice.
export type AppVersion = {
  version: string;
  gitSha: string;
};

export function getAppVersion(): AppVersion {
  return {
    version: process.env.APP_VERSION || '0.0.0',
    gitSha: process.env.GIT_SHA || 'unknown',
  };
}
