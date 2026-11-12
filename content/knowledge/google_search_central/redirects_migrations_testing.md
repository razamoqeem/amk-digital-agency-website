# Redirects, Migrations, and A/B Testing

## 1. Redirect Types
- **Permanent (301/308)**: Signal to Google that the target is the new canonical.
- **Temporary (302/303/307)**: Signal that the source should remain the canonical.
- **Meta Refresh**: Instant (0s) is treated as Permanent; Delayed (>0s) is treated as Temporary.
- **JS Redirects**: Interpreted by Web Rendering Service (WRS), but risky if rendering fails.
- **Crypto Redirects**: Adding a link ("We've moved!") as a fallback.

## 2. Site Moves & Migrations
- **Visible URL Changes**: Require 301 redirects for every page.
- **No URL Change (Hosting Change)**: Monitor TTL values, update DNS, and verify Googlebot access via URL Inspection Tool.
- **Crawl Rate**: Expect a temporary drop in crawl rate during moves, followed by an increase.
- **Soft 404 Prevention**: Don't redirect all old URLs to the homepage; redirect to the most relevant equivalent page.

## 3. A/B Testing Best Practices
- **No Cloaking**: Show the same variations to Googlebot as to users (or show the default).
- **rel="canonical"**: Use on all variants pointing back to the original URL.
- **302 Redirects**: Use temporary redirects for experiments.
- **Duration**: Run experiments only as long as necessary.

## 4. Redirect Chains
- Googlebot follows up to 10 hops.
- Recommended limit: < 3 hops for performance and reliability.
