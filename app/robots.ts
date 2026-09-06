import type { MetadataRoute } from 'next';

// Before this existed, GET /robots.txt fell through proxy.ts's catch-all
// matcher, failed its session check, and 307'd to /login - so both live
// instances (license.casazium.com and license-cloud.casazium.com) served
// no crawl directives at all, and a crawler asking for robots.txt got an
// HTML login page. proxy.ts's matcher now excludes robots.txt explicitly,
// the same way it already excluded favicon.ico.
//
// Crawling is deliberately left open. The console is kept out of search
// results by the `X-Robots-Tag: noindex` header in next.config.mjs, and a
// crawler has to be allowed to fetch a URL in order to see that header -
// a `Disallow: /` here would hide it and leave the already-indexed
// /login URLs sitting in the index indefinitely rather than dropping out.
// Once Search Console shows them gone, a Disallow could be added to save
// the crawl budget; until then it would be actively counterproductive.
//
// No sitemap is declared: this app has no public content to advertise.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
    },
  };
}
