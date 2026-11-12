# Google Search Operators for Forensic Debugging

## 1. General Operators
- **`site:[domain]`**: Restrict results to a specific domain/prefix. Useful for checking indexed pages.
- **`filetype:[ext]`**: Find specific file types (PDF, DOCX, RTF).
- **`site:[domain] [keyword]`**: Find specific content indexed on a domain.

## 2. Image Forensic Operators
- **`src:[url]`**: Find pages referencing a specific image source. Useful for tracking hotlinking.
- **`imagesize:[WxH]`**: Find images of exact dimensions.
- **`site:[domain] imagesize:[WxH]`**: Audit image dimensions indexed from your site.

## 3. Security & Spam Operators
- **`site:[domain] [spam keywords]`**: (e.g., `site:example.com viagra casino`) Use this to manually check for hacked content or comment spam.

## 4. Limitations
- Search operators are bound by indexing limits and may not show exhaustive results.
- For verified sites, the **Search Console URL Inspection Tool** is more reliable for absolute indexing status.
