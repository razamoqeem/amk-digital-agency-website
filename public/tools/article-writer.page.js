/* Moved out of article-writer.html so the page works under the strict security policy. */

    const API_BASE = `${window.location.protocol}//${window.location.host}`;
    const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));

    // Store raw markdown for copying
    let _rawArticle = '';

    async function generateArticle() {
      const topic = document.getElementById('articleTopic').value.trim();
      if (!topic) return alert('Article topic is required.');

      const btn = document.getElementById('generate-btn');
      const resultsDiv = document.getElementById('article-results');
      btn.disabled = true;
      btn.innerHTML = '<div class="tool-spinner" class="s-33689a9"></div> Writing Article...';

      resultsDiv.style.display = 'block';
      resultsDiv.innerHTML = `
        <div class="tool-loading">
          <div class="tool-spinner"></div>
          <div class="tool-loading-text">Synthesizing semantic drafts and generating paragraphs...</div>
        </div>`;

      try {
        const res = await fetch(`${API_BASE}/api/generate-article`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            topic,
            keywords: document.getElementById('articleKeywords').value.trim(),
            tone: document.getElementById('articleTone').value
          })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.detail || 'Generation failed');
        renderArticle(data);
      } catch (err) {
        resultsDiv.innerHTML = `
          <div class="tool-results-card" class="s-f2c9619">
            <div class="s-0020cae">⚠️</div>
            <p class="s-49589ae">Generation failed: ${esc(err.message)}</p>
            <p class="s-b295c12">Please check your inputs and try again.</p>
          </div>`;
      } finally {
        btn.disabled = false;
        btn.innerHTML = '✍️ Generate Full Article Draft';
      }
    }

    function renderArticle(data) {
      const resultsDiv = document.getElementById('article-results');
      _rawArticle = data.article || '';

      // Convert markdown to styled HTML
      let html = _rawArticle
        .replace(/# (.*)/g, '<h2 class="s-dd59621">$1</h2>')
        .replace(/## (.*)/g, '<h3 class="s-4463792">$1</h3>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/- (.*)/g, '<li class="s-8724fe4">$1</li>')
        .replace(/`([^`]+)`/g, '<code class="s-b5e5b3b">$1</code>')
        .replace(/\n\n/g, '<p class="s-cbeb913"></p>')
        .replace(/\n/g, '<br/>');

      // Estimate word count
      const wordCount = _rawArticle.split(/\s+/).filter(Boolean).length;

      resultsDiv.innerHTML = `
        <div class="tool-results">
          <div class="tool-results-card">
            <div class="tool-results-header">
              <div>
                <h3>✍️ Generated SEO Draft</h3>
                <span class="s-5a07ac3">~${wordCount} words · ${document.getElementById('articleTone').selectedOptions[0].text}</span>
              </div>
              <button class="tool-copy-btn" onclick="copyArticle()">📋 Copy Markdown</button>
            </div>

            <div class="tool-article-output">
              <div class="tool-article-scroll">
                ${html}
              </div>
            </div>

            <div class="tool-regenerate-bar">
              <button class="tool-regenerate-btn" onclick="generateArticle()">
                🔄 Write Another Article
              </button>
              <button class="tool-copy-btn" onclick="copyArticle()">📋 Copy Full Text</button>
              <span class="s-c5d4e8a">Modify topic or keywords above and regenerate</span>
            </div>
          </div>

          <div class="tool-upsell-banner">
            <div class="upsell-text">
              <h4>📝 Need Longer, Research-Backed Articles?</h4>
              <p>Upgrade to a paid plan for longer articles, multiple drafts, SEO scoring, and content strategy integration.</p>
            </div>
            <a href="/index.html#pricing" class="tool-upsell-btn">View Plans →</a>
          </div>
        </div>`;
    }

    function copyArticle() {
      if (!_rawArticle) return;
      navigator.clipboard.writeText(_rawArticle).then(() => {
        alert('Article copied to clipboard!');
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
