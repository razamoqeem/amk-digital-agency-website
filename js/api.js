/* ============================================================
   AMK Digital Agency — API.JS
   fetch() wrappers, polling, contact submission
   ============================================================ */

const AMK_API = (() => {
  const BASE = ''; // Use relative paths
  const TIMEOUT_MS = 90000;       // 90 seconds for standard API calls
  const AUDIT_TIMEOUT_MS = 120000; // 120 seconds for audit start (heavy op)

  // ── Exponential Backoff Retry Helper ──────────────────────
  /**
   * Wraps a fetch call with automatic retry on transient failures.
   * Retries on HTTP 429 (Rate Limit) and 503 (Server Busy),
   * and on network-level drops (TypeError).
   *
   * @param {string}   url        - Request URL
   * @param {object}   opts       - fetch() options (headers, body, etc.)
   * @param {number}   maxRetries - Maximum number of retry attempts (default: 3)
   * @param {number}   delayMs    - Initial backoff delay in ms (default: 2000)
   * @returns {Promise<Response>} - Resolves with the fetch Response object
   */
  async function _fetchWithRetry(url, opts = {}, maxRetries = 3, delayMs = 2000) {
    let attempts = 0;

    while (attempts < maxRetries) {
      attempts++;
      try {
        const response = await fetch(url, opts);

        // Retry on transient server-side traffic errors
        if (response.status === 429 || response.status === 503) {
          if (attempts >= maxRetries) return response; // Exhausted — pass through to error handler
          console.warn(
            `[AMK Network] High traffic (HTTP ${response.status}). ` +
            `Attempt ${attempts}/${maxRetries}. Retrying in ${delayMs}ms…`
          );
          await new Promise(resolve => setTimeout(resolve, delayMs));
          delayMs *= 2; // Double the wait time to ease server pressure
          continue;
        }

        return response; // Success or a non-retryable status

      } catch (networkError) {
        // Retry on network-level drops (offline, refused connection, etc.)
        console.error(`[AMK Network] Drop on attempt ${attempts}:`, networkError.message);
        if (attempts >= maxRetries) throw networkError;
        await new Promise(resolve => setTimeout(resolve, delayMs));
        delayMs *= 2;
      }
    }
  }

  // ── Expose retryable raw fetch ───────────────────────
  async function rawFetch(url, opts = {}) {
    // Directly use the retry helper to get a Response object
    return await _fetchWithRetry(url, opts);
  }

  async function _fetch(url, opts = {}, customTimeoutMs = null) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), customTimeoutMs || TIMEOUT_MS);
    const keys = {
      openai: localStorage.getItem('amk_key_openai') || '',
      anthropic: localStorage.getItem('amk_key_anthropic') || '',
      google: localStorage.getItem('amk_key_google') || '',
      deepseek: localStorage.getItem('amk_key_deepseek') || '',
      nvidia: localStorage.getItem('amk_key_nvidia') || '',
      psi: localStorage.getItem('amk_key_psi') || ''
    };

    const userRaw = localStorage.getItem('amk_user');
    let user = null;
    try { user = userRaw ? JSON.parse(userRaw) : null; } catch(e) { user = null; }

    const headers = {
      ...(opts.headers || {}),
      'Authorization': user && user.token ? `Bearer ${user.token}` : '',
      'X-OpenAI-Key': keys.openai,
      'X-Anthropic-Key': keys.anthropic,
      'X-Google-Key': keys.google,
      'X-DeepSeek-Key': keys.deepseek,
      'X-NVIDIA-Key': keys.nvidia,
      'X-PageSpeed-Key': keys.psi
    };

    try {
      const res = await _fetchWithRetry(url, { ...opts, headers, signal: controller.signal });
      if (!res.ok) {
        const error = new Error(`HTTP ${res.status}`);
        error.status = res.status;
        try {
            const data = await res.json();
            error.data = data;
        } catch(e) {}
        throw error;
      }
      return await res.json();
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Request timed out.');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // ── AI Capabilities ───────────────────────────────────────
  async function getAIInsight(provider, model, prompt) {
    const key = localStorage.getItem(`amk_key_${provider}`);
    if (!key) throw new Error(`No API key found for ${provider} in vault.`);
    
    return _fetch(`${BASE}/api/ai/insight`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, model, prompt, api_key: key })
    });
  }

  async function getAIForensics(auditId) {
    const keys = {
      openai: localStorage.getItem('amk_key_openai') || '',
      anthropic: localStorage.getItem('amk_key_anthropic') || '',
      google: localStorage.getItem('amk_key_google') || '',
      deepseek: localStorage.getItem('amk_key_deepseek') || '',
      nvidia: localStorage.getItem('amk_key_nvidia') || ''
    };
    
    return _fetch(`${BASE}/api/ai/forensics`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audit_id: auditId, api_keys: keys })
    });
  }

  // ── Audit ─────────────────────────────────────────────────
  async function startAudit(url, toolId = 'domain', tier = 'free', region = 'Global', keyword = '', device = 'desktop') {
    return await _fetch(`${BASE}/audit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, tool_id: toolId, tier, region, keyword, device })
    }, AUDIT_TIMEOUT_MS); // Use extended timeout for audit start
  }

  async function hydrateAudit(domain) {
    return _fetch(`${BASE}/api/audit/hydrate/${encodeURIComponent(domain)}`);
  }

  async function getAuditStatus(auditId) {
    return _fetch(`${BASE}/api/audit/${auditId}`);
  }

  function pollAudit(auditId, { onProgress, onComplete, onError }) {
    let attempts = 0;
    let consecutiveErrors = 0;
    const MAX = 1800;            // 30 min max (for deep crawls)
    const MAX_ERRORS = 5;        // tolerate up to 5 back-to-back network blips

    const interval = setInterval(async () => {
      attempts++;
      if (attempts > MAX) {
        clearInterval(interval);
        onError?.(new Error('Audit timed out after 30 minutes.'));
        return;
      }
      try {
        const data = await getAuditStatus(auditId);
        consecutiveErrors = 0; // reset error counter on success
        onProgress?.(data.progress || 0, data);
        if (data.status === 'completed') {
          clearInterval(interval);
          onComplete?.(data.results);
        } else if (data.status === 'error') {
          clearInterval(interval);
          onError?.(new Error(data.error || 'Audit failed.'));
        }
      } catch (err) {
        consecutiveErrors++;
        console.warn(`[AMK Poll] Transient error (${consecutiveErrors}/${MAX_ERRORS}):`, err.message);
        if (consecutiveErrors >= MAX_ERRORS) {
          clearInterval(interval);
          onError?.(err);
        }
        // Otherwise: swallow error and retry on next tick
      }
    }, 2000);

    return () => clearInterval(interval);
  }

  // ── Contact Form ──────────────────────────────────────────
  async function submitContact(formData) {
    try {
      return await _fetch(`${BASE}/api/contact`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
    } catch {
      // Fallback: simulate success for portfolio demo
      await new Promise(r => setTimeout(r, 800));
      return { status: 'success', message: "We'll be in touch within 24 hours." };
    }
  }

  // ── Reports ───────────────────────────────────────────────
  async function listExports() {
    try {
      return await _fetch(`${BASE}/api/exports`);
    } catch {
      // Graceful fallback: export files may have been deleted or DB cleared
      return { reports: [] };
    }
  }

  // ── Mock Data (for UI demo when backend is offline) ───────
  const MOCK = {
    onPage: {
      score: 74, metaTitleLen: 58, metaDescLen: 148,
      h1Count: 1, imgAltCoverage: 83, wordCount: 1240,
      internalLinks: 12, status: 'good'
    },
    offPage: {
      backlinks: 342, referringDomains: 67, dofollow: 78,
      nofollow: 22, toxicLinks: 3, domainRating: 31
    },
    technical: {
      score: 81, lcp: 2.3, cls: 0.05, fid: 80,
      pagesIndexed: 48, crawlErrors: 2, sitemapStatus: 'ok',
      robotsStatus: 'ok', mobileScore: 89
    },
    content: {
      readability: 67, uniqueness: 92, topicalScore: 74,
      contentFreshness: 'Good', searchIntent: 'Informational'
    },
    analytics: {
      domainAuthority: 31, estimatedTraffic: 2840,
      topKeyword: 'digital marketing agency', keywordCount: 143,
      serp: [
        { keyword: 'seo audit tool', position: 18, volume: 4400 },
        { keyword: 'digital marketing os', position: 7, volume: 720 },
        { keyword: 'ai seo platform', position: 24, volume: 1900 },
      ]
    }
  };

  function getMockData(pillar) { return MOCK[pillar] || {}; }

  return { rawFetch, startAudit, hydrateAudit, getAuditStatus, pollAudit, submitContact, listExports, getMockData, getAIInsight, getAIForensics };
})();

// Global Alias for consistency
const API = AMK_API;
