# Google Search Technical Requirements

## 1. Googlebot Access
- **No Blocks**: Robots.txt must not block Googlebot from the target URLs.
- **Public Accessibility**: No login/password protection on content intended for search.
- **Verification**: Use the **URL Inspection Tool** to verify absolute access.

## 2. Server Performance
- **HTTP 200 (Success)**: Google only indexes pages that return a `200 OK` status.
- **Client/Server Errors**: 4xx and 5xx errors prevent indexing.
- **Soft 404s**: Pages that look like errors but return a 200 code are considered "Soft 404s" and may be deindexed.

## 3. Indexable Content
- **Supported File Types**: Textual content must be in a supported format (HTML, PDF, etc.).
- **Spam Compliance**: Content must not violate any **Google Search Spam Policies**.
- **Visibility**: Content must be textually visible; content requiring plugins (Java/Silverlight) or rendered solely in Canvas is not indexable.
