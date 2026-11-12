# JavaScript SEO & Modern Rendering

## 1. JS SEO Basics
- Google uses an **evergreen Chromium** to render pages.
- **Rendering Workflow**: Crawl -> Render Queue -> Render -> Index.
- **Lazy-loading**: Google supports native lazy-loading (`loading="lazy"`). Ensure content is in the viewport when rendered.

## 2. Dynamic Rendering
- **Status**: Workaround, not a long-term solution.
- **Recommendation**: Use Server-Side Rendering (SSR), Static Rendering, or Hydration.

## 3. SPA & Routing
- Avoid hash-based routing (`#/`) for critical content as Google may not crawl fragments.
- Use the **History API** (Clean URLs) for Single Page Applications.

## 4. Web Components & Shadow DOM
- Google can index content in the Shadow DOM, but it's best to use Light DOM for critical SEO content to ensure maximum compatibility.

## 5. App Shell Architecture
- Avoid serving a generic App Shell for every URL if it delays content discovery. Ensure the meaningful content is available quickly.
