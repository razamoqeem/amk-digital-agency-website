## 1. Preventing User-Generated Spam
- Spammers exploit open forms, comments, and guestbooks.
- **Remedy**: Use CAPTCHAs, moderation, and `rel="nofollow ugc"` for user links.

## 2. Malware & Unwanted Software
- **Malware**: Harmful software (viruses, etc.) installed without consent.
- **Unwanted Software**: Deceptive apps that leak PII, change browser settings (Home page, New tab), or inject ads.
- **Guidelines**:
  - Accurately inform users of purpose/intent (no "Download" ads without context).
  - Use the **Chrome Settings API** for browser changes.
  - Don't degrade **TLS/SSL** security (no root CA installs).
  - Uninstallation must be simple, findable, and non-threatening.
- **Google Safe Browsing**: Warns users of dangerous sites. **Repeat Offenders** (switching between compliant/noncompliant) face 30-day review blocks.

## 3. Social Engineering (Phishing)
- **Phishing**: Trickery to reveal personal info (passwords, phone numbers).
- **Deceptive Content**: Fake "Update Browser" popups or "System Infected" scareware.
- **Third-Party Services**: Sites operating on behalf of others must be clearly labeled (e.g., "Hosted by X on behalf of Y").
- **Embedded Risks**: Deceptive ads masquerading as page action buttons (e.g., fake "Play" buttons).

## 4. Site Health & Prevention Checklist
- **Monitoring**: Periodically use `site:[domain]` to check for unknown pages (hacked content).
- **Passwords**: Use unique, strong passwords for all admin accounts.
- **Software Updates**: Maintain a registry of all plugins/CMS versions. Outdated software is the #1 vector for malware.
- **Secure Protocols**: Exclusively use **SSH/SFTP** for data transfer; disable plain text Telnet/FTP.
- **Log Monitoring**: Watch for unfamiliar URL parameters (`=http:`) or spikes in redirect traffic (indicates Open Redirect exploits).
- **Manual Actions**: Review the **Manual Actions report** in Search Console for policy violations.
