# Google Crawling & Indexing Fundamentals

## 1. Overview of Crawling and Indexing
Googlebot must be able to find and parse your content. Key files include:
- **Indexable File Types**: Google can index most text-based files (HTML, PDF, Office, etc.).
- **User-Triggered Fetchers**: Tools like Site Verifier or RSS readers that ignore robots.txt because they are user-initiated.

## 2. URL Canonicalization
The process of selecting the representative URL for a piece of content. 
- **Duplicates**: Caused by regional variants, device variants (mobile/desktop), or protocol variants (HTTP/HTTPS).
- **Consolidation**: Use `rel="canonical"` or 301 redirects to tell Google which version to index.

## 3. AMP on Google Search
- AMP pages must follow the AMP HTML spec.
- Content parity is required between AMP and canonical pages.
- Bidirectional linkage: Canonical links to AMP, and AMP links back to Canonical.

## 4. Troubleshooting Crawling Errors
- **Availability Issues**: Check server capacity and firewall blocks.
- **Crawl Efficiency**: Use sitemaps and clean URL structures to help Googlebot focus on high-value pages.
- **Overcrawling**: Use `crawl-delay` (for some bots) or adjust crawl rate in Search Console if the server is struggling.

## 5. Pausing or Disabling a Site
- **Recommended**: Limit functionality (disable cart, show banner) instead of taking the site down.
- **Temporary Shutdown**: Use `503 Service Unavailable` with a `Retry-After` header.
- **Avoid**: Returning `404` or `noindex` for temporary issues, as it removes the URL from the index.
