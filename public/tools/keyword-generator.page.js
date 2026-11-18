/* Moved out of keyword-generator.html so the page works under the strict security policy. */

    const API_BASE = `${window.location.protocol}//${window.location.host}`;
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));

    async function generateKeywords() {
      const niche = document.getElementById('keywordNiche').value.trim();
      if (!niche) return alert('Niche or industry description is required.');

      const btn = document.getElementById('generate-btn');
      const resultsDiv = document.getElementById('keyword-results');
      btn.disabled = true;
      btn.innerHTML = '<div class="tool-spinner" class="s-33689a9"></div> Analyzing...';

      resultsDiv.style.display = 'block';
      resultsDiv.innerHTML = `
        <div class="tool-loading">
          <div class="tool-spinner"></div>
          <div class="tool-loading-text">Analyzing search volume index data and semantic clusters...</div>
        </div>`;

      try {
        const res = await fetch(`${API_BASE}/api/generate-keywords`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            niche,
            audience: document.getElementById('keywordAudience').value.trim(),
            tone: document.getElementById('keywordTone').value
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Generation failed');
        renderKeywords(data);
      } catch (err) {
        resultsDiv.innerHTML = `
          <div class="tool-results-card" class="s-f2c9619">
            <div class="s-0020cae">⚠️</div>
            <p class="s-49589ae">Generation failed: ${esc(err.message)}</p>
            <p class="s-b295c12">Please check your inputs and try again.</p>
          </div>`;
      } finally {
        btn.disabled = false;
        btn.innerHTML = '🔑 Generate Semantic Keywords';
      }
    }

    function renderKeywords(data) {
      const resultsDiv = document.getElementById('keyword-results');
      const items = Array.isArray(data) ? data : [];

      const diffClass = d => d === 'High' ? 'tool-kw-diff-high' : (d === 'Medium' ? 'tool-kw-diff-med' : 'tool-kw-diff-low');

      const rows = items.map(item => `
        <tr>
          <td class="kw-name">${esc(item.keyword)}</td>
          <td class="s-243452e">${esc(item.search_volume)}</td>
          <td><span class="${diffClass(item.difficulty)}">${esc(item.difficulty)}</span></td>
          <td><span class="tool-kw-intent">${esc(item.intent)}</span></td>
        </tr>
      `).join('');

      resultsDiv.innerHTML = `
        <div class="tool-results">
          <div class="tool-results-card">
            <div class="tool-results-header">
              <h3>🔑 Semantic Keyword Opportunities</h3>
              <span class="s-8cadba3">${items.length} keywords discovered</span>
            </div>

            <div class="s-0ddf068">
              <table class="tool-kw-table">
                <thead>
                  <tr>
                    <th>Keyword</th>
                    <th>Search Volume</th>
                    <th>Difficulty</th>
                    <th>Intent</th>
                  </tr>
                </thead>
                <tbody>
                  ${rows || '<tr><td colspan="4" class="s-b4fdf88">No keywords generated.</td></tr>'}
                </tbody>
              </table>
            </div>

            <div class="tool-regenerate-bar">
              <button class="tool-regenerate-btn" onclick="generateKeywords()">
                🔄 Generate More Keywords
              </button>
              <button class="tool-copy-btn" onclick="copyTable()">📋 Copy All</button>
              <span class="s-c5d4e8a">Adjust niche or audience above for different results</span>
            </div>
          </div>

          <div class="tool-upsell-banner">
            <div class="upsell-text">
              <h4>📈 Want Real-Time Search Data?</h4>
              <p>Upgrade to a paid plan for live search volume, competition metrics, SERP analysis, and keyword tracking.</p>
            </div>
            <a href="/index.html#pricing" class="tool-upsell-btn">View Plans →</a>
          </div>
        </div>`;

      // Store for copy
      window._lastKeywords = items;
    }

    function copyTable() {
      if (!window._lastKeywords) return;
      const text = window._lastKeywords.map(k =>
        `${k.keyword}\t${k.search_volume}\t${k.difficulty}\t${k.intent}`
      ).join('\n');
      navigator.clipboard.writeText('Keyword\tSearch Volume\tDifficulty\tIntent\n' + text).then(() => {
        alert('Keywords copied to clipboard!');
      });
    }
  
;

    /* This tool needs the tools service, which is not available yet. */
    document.addEventListener('DOMContentLoaded', function () {
      var main = document.querySelector('main') || document.body;
      var note = document.createElement('p');
      note.setAttribute('role', 'status');
      note.className = 'site-notice';
      note.textContent = 'This tool is being rebuilt and is temporarily unavailable. Please try again soon.';
      main.insertBefore(note, main.firstChild);
      document.querySelectorAll('main button, main input, main select, main textarea').forEach(function (el) { el.disabled = true; });
    });
  

/* Buttons that used onclick="fn()" now carry data-run="fn". */
document.querySelectorAll('[data-run]').forEach(function (el) {
  el.addEventListener('click', function (e) { var fn = window[el.getAttribute('data-run')]; if (typeof fn === 'function') fn(e); });
});
