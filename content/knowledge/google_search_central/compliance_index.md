# Ahmad SEO Suite: Google Search Central Compliance Index

This document maps official Google Search Central regulations to the automated forensics implemented in the Ahmad SEO Suite.

## ⚖️ Forensics Compliance Matrix

| Regulation | Implementation in Suite | Module |
| :--- | :--- | :--- |
| **Robots Meta Directives** | `noindex`, `nofollow`, `nosnippet` detection | `on_page_seo.py` |
| **Snippet Control** | Scans for `max-snippet`, `max-image-preview`, and `data-nosnippet` attributes. | `on_page_seo.py` |
| **Link Qualification** | Audits `rel="sponsored"`, `rel="ugc"`, and `rel="nofollow"`. | `on_page_seo.py` |
| **Redirect Logic** | Detects 301/302/307/308, Instant vs Delayed Meta Refresh, and JS Redirects. | `on_page_seo.py` |
| **A/B Testing** | Verifies `rel="canonical"` on experiment variants and uses 302 detection. | `on_page_seo.py` |
| **Privacy & PII** | Scans URLs for email/PII patterns and identifies unflattened PDF/SVG risks. | `on_page_seo.py` |
| **JS Rendering** | SPA detection, Hash-route risk mapping, and Shadow DOM discovery. | `technical_seo.py` |
| **Mobile-First Parity** | Audits Heading/Meta parity and Responsive Viewport status. | `on_page_seo.py` |
| **AMP Discovery** | Validates bidirectional linkage and HTML-level AMP detection. | `on_page_seo.py` |
| **Availability (503)** | Monitors for 503 status codes and `Retry-After` header requirements. | `audit_orchestrator.py` |
| **Traffic Drop Debug** | Pattern analysis for algorithmic vs technical vs seasonality drops. | `performance_engine.py` |
| **Security & Spam** | User-generated spam detection and Safe Browsing/Malware heuristics. | `technical_seo.py` |
| **Operator Forensics** | Support for `site:`, `src:`, and `filetype:` simulation for deep debugging. | `audit_orchestrator.py` |
| **Spam Heuristics** | Detection for Cloaking, Sneaky Redirects, and Hidden Links. | `technical_seo.py` |
| **Canonical Health** | Verification of `rel="canonical"` and directory-level topical grouping. | `on_page_seo.py` |
| **Status Monitoring** | Real-time monitoring for `200 OK` vs `404/500/Soft 404`. | `audit_orchestrator.py` |

## 🛠️ Usage for Auditing
When performing a forensic audit, refer to the **🛰️ Indexing & Links**, **🔐 Privacy & Security**, and **📦 Migration & Redirects** tabs in the dashboard. These tabs are built specifically to flag violations of the rules documented in the `knowledge_base/`.

## 📚 Reference Documentation
- [Crawling & Indexing Basics](./crawling_indexing_basics.md)
- [Content Control & Privacy](./removal_privacy_content_control.md)
- [Redirects & Migrations](./redirects_migrations_testing.md)
- [JS SEO & Rendering](./js_seo_mobile_rendering.md)
- [Traffic & Analytics Debug](./traffic_debug_analytics.md)
- [Search Operators Forensics](./search_operators_debug.md)
- [Security & Abuse Prevention](./security_abuse_prevention.md)
- [SEO Starter Guide (Basics)](./seo_starter_guide.md)
- [Spam Policies Dictionary](./spam_policies.md)
- [Technical Requirements](./technical_requirements.md)
