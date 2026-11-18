/**
 * KivoReach — Floating 3D AI Assistant Widget
 * Phase 5: Vanilla JS + CSS3D transforms
 *
 * Features:
 *   - Slides in from bottom-right with spring animation
 *   - Contextual prompts based on the active pillar
 *   - Minimizes to a floating FAB (Floating Action Button)
 *   - Routes requests to /api/ai/insight backend
 *   - No dependencies — pure vanilla JS
 */

(function () {
  'use strict';

  // ── Context-aware prompts per pillar ─────────────────────────────────────
  const PILLAR_CONTEXTS = {
    'on-page': {
      icon: '📝',
      greeting: 'On-Page Intelligence Mode active.',
      suggestions: [
        'Why is my meta title underperforming?',
        'How do I fix my H1 hierarchy?',
        'What word count should I target for this page?',
        'How do I improve my image alt text score?'
      ]
    },
    'off-page': {
      icon: '🔗',
      greeting: 'Off-Page & Authority Mode active.',
      suggestions: [
        'How do I build high-authority backlinks?',
        'What is my dofollow link ratio target?',
        'Which competitor has the strongest backlink profile?',
        'How do I recover from a Google penalty?'
      ]
    },
    'technical': {
      icon: '⚙️',
      greeting: 'Technical Crawler Mode active.',
      suggestions: [
        'What LCP score do I need to rank?',
        'How do I fix my robots.txt?',
        'Is my sitemap being indexed correctly?',
        'How do I reduce DOM depth?'
      ]
    },
    'content': {
      icon: '✍️',
      greeting: 'Content SEO Intelligence active.',
      suggestions: [
        'What search intent should this page target?',
        'How do I build topical authority?',
        'How do I improve my content freshness signal?',
        'Rewrite my introduction for E-E-A-T compliance.'
      ]
    },
    'local': {
      icon: '📍',
      greeting: 'Local SEO Command Mode active.',
      suggestions: [
        'How do I optimize my Google Business Profile?',
        'What NAP consistency issues should I fix?',
        'How do I respond to negative reviews for SEO?',
        'Which local keywords have the best conversion rate?'
      ]
    },
    'eeat': {
      icon: '🛡️',
      greeting: 'E-E-A-T Signal Analyser engaged.',
      suggestions: [
        'How do I improve my author credibility signals?',
        'What does my trust gap analysis recommend?',
        'How do I implement llms.txt on my domain?',
        'Generate my E-E-A-T improvement roadmap.'
      ]
    },
    'geo': {
      icon: '🤖',
      greeting: 'AI SEO / GEO Intelligence Mode active.',
      suggestions: [
        'How do I get featured in AI Overviews?',
        'What LLM trust signals does my site have?',
        'How do I optimize for generative engine visibility?',
        'What is my GEO score and how do I improve it?'
      ]
    },
    'analytics': {
      icon: '📊',
      greeting: 'Analytics Command Center active.',
      suggestions: [
        'What is driving my organic traffic trend?',
        'Which pages have the highest bounce rate?',
        'How do I interpret my SERP position tracking?',
        'Generate a monthly performance summary.'
      ]
    },
    default: {
      icon: '🤖',
      greeting: 'KivoReach AI ready.',
      suggestions: [
        'Run a full E-E-A-T audit on my site.',
        'What are the top 3 things I should fix today?',
        'Generate a strategic action plan for my domain.',
        'Explain the AI Trust Gap framework.'
      ]
    }
  };

  // ── Build the widget DOM ─────────────────────────────────────────────────
  function buildWidget() {
    const widget = document.createElement('div');
    widget.id = 'amk-ai-widget';
    widget.innerHTML = `
      <!-- FAB trigger button -->
      <button id="ai-widget-fab" aria-label="Open AMK AI Assistant" title="Ask AMK AI">
        <span class="fab-icon">🤖</span>
        <span class="fab-pulse"></span>
      </button>

      <!-- Chat panel -->
      <div id="ai-widget-panel" role="dialog" aria-label="AMK AI Assistant" aria-hidden="true">
        <div class="widget-header">
          <div class="widget-header-left">
            <div class="widget-avatar">🤖</div>
            <div>
              <div class="widget-title">KivoReach AI</div>
              <div class="widget-subtitle" id="widget-context-label">Intelligence Engine Ready</div>
            </div>
          </div>
          <div class="widget-header-right">
            <select id="widget-model-select">
              <option value="openrouter" selected>Smart Auto (Recommended)</option>
              <option value="google">Economy (Gemini)</option>
              <option value="openai">Standard (GPT-4o-mini)</option>
              <option value="anthropic">Premium (Claude 3.5)</option>
              <option value="ollama">Local (Ollama)</option>
            </select>
            <button id="widget-close-btn" aria-label="Close AI assistant">✕</button>
          </div>
        </div>

        <div id="widget-telemetry-bar" style="font-size: 10px; color: #6B7280; padding: 4px 14px; background: rgba(0,0,0,0.02); border-bottom: 1px solid rgba(0,0,0,0.05); display: flex; justify-content: space-between; align-items: center;">
          <span>Active Model: <strong id="widget-active-model">Auto Detect</strong></span>
          <span>Session Cost: <strong id="widget-session-cost">$0.0000</strong></span>
        </div>

        <div class="widget-messages" id="widget-messages">
          <div class="widget-msg bot">
            <div class="msg-bubble">
              Hello! I'm KivoReach's AI assistant. Ask me anything about SEO, GEO, or digital marketing strategy.
            </div>
          </div>
        </div>

        <div class="widget-suggestions" id="widget-suggestions">
          <!-- Injected dynamically per pillar context -->
        </div>

        <div class="widget-input-row">
          <input
            type="text"
            id="widget-input"
            placeholder="Ask anything about your SEO audit..."
            autocomplete="off"
            maxlength="400"
          />
          <button id="widget-send-btn" aria-label="Send message">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>
      </div>
    `;

    // Inject CSS
    const style = document.createElement('style');
    style.textContent = AI_WIDGET_CSS;
    document.head.appendChild(style);
    document.body.appendChild(widget);
    return widget;
  }

  // ── Widget CSS ───────────────────────────────────────────────────────────
  const AI_WIDGET_CSS = `
    /* ── FAB Button ─────────────────────────────────────── */
    #ai-widget-fab {
      position: fixed;
      bottom: 28px;
      right: 28px;
      width: 65px;
      height: 65px;
      border-radius: 50%;
      background: linear-gradient(135deg, #6C63FF 0%, #00E5C0 100%);
      border: none;
      cursor: pointer;
      z-index: 9000;
      box-shadow: 0 8px 32px rgba(108,99,255,0.45);
      transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275),
                  box-shadow 0.3s ease;
      display: flex;
      align-items: center;
      justify-content: center;
      perspective: 600px;
    }

    #ai-widget-fab:hover {
      transform: translateY(-4px) rotateX(8deg) rotateY(-4deg) scale(1.08);
      box-shadow: 0 16px 40px rgba(108,99,255,0.55);
    }

    #ai-widget-fab:active {
      transform: scale(0.95);
    }

    .fab-icon {
      font-size: 28px;
      line-height: 1;
      z-index: 1;
      position: relative;
    }

    .fab-pulse {
      position: absolute;
      inset: -3px;
      border-radius: 50%;
      border: 2px solid rgba(108,99,255,0.6);
      animation: fabPulse 2.5s ease-in-out infinite;
    }

    @keyframes fabPulse {
      0%   { transform: scale(1);   opacity: 0.8; }
      50%  { transform: scale(1.2); opacity: 0.2; }
      100% { transform: scale(1);   opacity: 0.8; }
    }

    /* ── Panel ──────────────────────────────────────────── */
    #ai-widget-panel {
      position: fixed;
      bottom: 105px;
      right: 28px;
      width: 520px;
      height: 700px;
      max-height: 85vh;
      background: rgba(255,255,255,0.95);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border: 1px solid rgba(108,99,255,0.25);
      border-radius: 20px;
      box-shadow: 0 24px 64px rgba(0,0,0,0.18),
                  0 0 0 1px rgba(255,255,255,0.5) inset;
      z-index: 8999;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      transform-origin: bottom right;

      /* Hidden by default */
      transform: scale(0.85) translateY(20px);
      opacity: 0;
      pointer-events: none;
      transition: transform 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275),
                  opacity 0.25s ease;
    }

    #ai-widget-panel.open {
      transform: scale(1) translateY(0);
      opacity: 1;
      pointer-events: auto;
    }

    /* Dark mode */
    .dark #ai-widget-panel {
      background: rgba(15,15,30,0.95);
      border-color: rgba(108,99,255,0.35);
      box-shadow: 0 24px 64px rgba(0,0,0,0.5);
    }

    /* ── Header ─────────────────────────────────────────── */
    .widget-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 18px 22px;
      border-bottom: 1px solid rgba(0,0,0,0.07);
      background: linear-gradient(135deg, rgba(108,99,255,0.08), rgba(0,229,192,0.05));
      flex-shrink: 0;
    }

    .dark .widget-header {
      border-bottom-color: rgba(255,255,255,0.08);
      background: linear-gradient(135deg, rgba(108,99,255,0.15), rgba(0,229,192,0.08));
    }

    .widget-header-left {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .widget-header-right {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .widget-avatar {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: linear-gradient(135deg, #6C63FF, #00E5C0);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 20px;
      box-shadow: 0 4px 12px rgba(108,99,255,0.35);
    }

    .widget-title {
      font-size: 17px;
      font-weight: 700;
      color: #1A1A2E;
      line-height: 1.2;
    }

    .dark .widget-title { color: #F9FAFB; }

    .widget-subtitle {
      font-size: 13.5px;
      color: #6B7280;
      margin-top: 3px;
      font-weight: 500;
    }

    .dark .widget-subtitle { color: #9CA3AF; }

    #widget-model-select {
      font-size: 13px;
      padding: 4px 8px;
      border-radius: 8px;
      background: rgba(108,99,255,0.08);
      border: 1px solid rgba(108,99,255,0.2);
      outline: none;
      cursor: pointer;
      color: #1A1A2E;
      font-weight: 600;
      max-width: 180px;
      transition: border-color 0.2s, background 0.2s;
    }

    .dark #widget-model-select {
      background: rgba(255,255,255,0.08) !important;
      border-color: rgba(255,255,255,0.1) !important;
      color: #F9FAFB !important;
    }

    #widget-model-select option {
      background: #ffffff;
      color: #1A1A2E;
    }

    .dark #widget-model-select option {
      background: #0F0F1E;
      color: #F9FAFB;
    }

    #widget-close-btn {
      background: none;
      border: none;
      color: #9CA3AF;
      cursor: pointer;
      font-size: 18px;
      padding: 6px 10px;
      border-radius: 6px;
      transition: background 0.2s, color 0.2s;
      line-height: 1;
    }

    #widget-close-btn:hover {
      background: rgba(0,0,0,0.08);
      color: #374151;
    }

    .dark #widget-close-btn:hover {
      background: rgba(255,255,255,0.08);
      color: #F9FAFB;
    }

    /* ── Messages ───────────────────────────────────────── */
    .widget-messages {
      flex: 1;
      overflow-y: auto;
      padding: 16px 18px 10px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      scroll-behavior: smooth;
    }

    .widget-msg {
      display: flex;
      gap: 10px;
      animation: msgSlideIn 0.25s ease-out;
    }

    @keyframes msgSlideIn {
      from { opacity: 0; transform: translateY(8px); }
      to   { opacity: 1; transform: translateY(0); }
    }

    .widget-msg.user {
      flex-direction: row-reverse;
    }

    .msg-bubble {
      max-width: 85%;
      padding: 12px 16px;
      border-radius: 16px;
      font-size: 15.5px;
      line-height: 1.5;
      color: #1A1A2E;
    }

    .dark .msg-bubble { color: #F9FAFB; }

    .widget-msg.bot .msg-bubble {
      background: rgba(108,99,255,0.08);
      border: 1px solid rgba(108,99,255,0.15);
      border-bottom-left-radius: 4px;
    }

    .widget-msg.user .msg-bubble {
      background: linear-gradient(135deg, #6C63FF, #5A52D5);
      color: #fff;
      border-bottom-right-radius: 4px;
    }

    .msg-bubble.loading {
      display: flex;
      gap: 4px;
      align-items: center;
      padding: 14px;
    }

    .msg-bubble.loading span {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #6C63FF;
      animation: typingBounce 1s ease-in-out infinite;
    }

    .msg-bubble.loading span:nth-child(2) { animation-delay: 0.15s; }
    .msg-bubble.loading span:nth-child(3) { animation-delay: 0.3s; }

    @keyframes typingBounce {
      0%, 80%, 100% { transform: translateY(0); opacity: 0.5; }
      40%           { transform: translateY(-6px); opacity: 1; }
    }

    /* ── Suggestions ────────────────────────────────────── */
    .widget-suggestions {
      padding: 8px 18px 12px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      flex-shrink: 0;
    }

    .widget-suggestion-btn {
      background: rgba(108,99,255,0.06);
      border: 1px solid rgba(108,99,255,0.15);
      border-radius: 12px;
      padding: 10px 14px;
      font-size: 14.5px;
      color: #6C63FF;
      cursor: pointer;
      text-align: left;
      transition: background 0.2s, transform 0.15s;
      font-weight: 500;
      line-height: 1.3;
    }

    .dark .widget-suggestion-btn {
      background: rgba(108,99,255,0.1);
      border-color: rgba(108,99,255,0.25);
    }

    .widget-suggestion-btn:hover {
      background: rgba(108,99,255,0.14);
      transform: translateX(3px);
    }

    /* ── Input Row ──────────────────────────────────────── */
    .widget-input-row {
      display: flex;
      gap: 10px;
      padding: 12px 18px 18px;
      border-top: 1px solid rgba(0,0,0,0.07);
      flex-shrink: 0;
    }

    .dark .widget-input-row { border-top-color: rgba(255,255,255,0.08); }

    #widget-input {
      flex: 1;
      padding: 12px 16px;
      border-radius: 14px;
      border: 1.5px solid rgba(108,99,255,0.25);
      background: rgba(108,99,255,0.04);
      color: #1A1A2E;
      font-size: 15.5px;
      outline: none;
      transition: border-color 0.2s, box-shadow 0.2s;
      font-family: inherit;
    }

    .dark #widget-input {
      background: rgba(108,99,255,0.08);
      color: #F9FAFB;
      border-color: rgba(108,99,255,0.3);
    }

    #widget-input:focus {
      border-color: #6C63FF;
      box-shadow: 0 0 0 3px rgba(108,99,255,0.15);
    }

    #widget-input::placeholder { color: #9CA3AF; }

    #widget-send-btn {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: linear-gradient(135deg, #6C63FF, #00E5C0);
      border: none;
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      transition: transform 0.2s, box-shadow 0.2s;
      box-shadow: 0 4px 12px rgba(108,99,255,0.3);
    }

    #widget-send-btn:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 18px rgba(108,99,255,0.45);
    }

    #widget-send-btn:active {
      transform: scale(0.95);
    }

    #widget-send-btn svg {
      width: 18px;
      height: 18px;
    }

    /* ── Scrollbar styling ──────────────────────────────── */
    .widget-messages::-webkit-scrollbar {
      width: 5px;
    }
    .widget-messages::-webkit-scrollbar-track {
      background: transparent;
    }
    .widget-messages::-webkit-scrollbar-thumb {
      background: rgba(108,99,255,0.3);
      border-radius: 3px;
    }
    #widget-telemetry-bar {
      font-size: 11px;
    }
    .dark #widget-telemetry-bar {
      color: #9CA3AF;
      background: rgba(15,15,30,0.4);
      border-bottom-color: rgba(255,255,255,0.08);
    }
  `;

  // ── Widget Controller ────────────────────────────────────────────────────
  class AIWidgetController {
    constructor() {
      this.panel = null;
      this.fab = null;
      this.messages = null;
      this.input = null;
      this.isOpen = false;
      this.currentPillar = 'default';
      this.isLoading = false;
      this.loadingMsgEl = null;
      this.sessionCost = 0.0;
    }

    _checkAuth() {
      try {
        const user = JSON.parse(localStorage.getItem('amk_user') || 'null');
        return !!(user && user.token);
      } catch (e) {
        return false;
      }
    }

    _triggerAuthModal(action) {
      if (typeof Auth !== 'undefined' && Auth.openModal) {
        Auth.openModal(action);
      }
    }

    restoreChatState() {
      const isAuthenticated = this._checkAuth();
      if (!isAuthenticated) {
        // Clear message log and show unauthenticated gate message
        this.messages.innerHTML = '';
        const gateText = `🛑 <strong>System Access Restricted.</strong> In order to continue our conversation, access deep resource links, and unlock tactical data tailored to your operational track, please <a href="#" class="auth-gate-link" data-auth-action="signup" style="color: #6C63FF; text-decoration: underline; font-weight: bold;">Sign Up</a> or <a href="#" class="auth-gate-link" data-auth-action="login" style="color: #6C63FF; text-decoration: underline; font-weight: bold;">Log In</a> to the account associated with your enrolled plan.`;
        this._addMessage('bot', gateText, false, true);

        // Bind clicks on auth links dynamically
        this.messages.querySelectorAll('.auth-gate-link').forEach(link => {
          link.addEventListener('click', (e) => {
            e.preventDefault();
            this._triggerAuthModal(link.dataset.authAction);
          });
        });

        // Force suggestions to be cleared
        const suggestionsEl = document.getElementById('widget-suggestions');
        if (suggestionsEl) suggestionsEl.innerHTML = '';
        return;
      }

      // Authenticated path: restore chat history
      const savedHistory = localStorage.getItem('amk_chat_history');
      let restoredCount = 0;
      if (savedHistory) {
        try {
          const history = JSON.parse(savedHistory);
          if (Array.isArray(history) && history.length > 0) {
            this.messages.innerHTML = '';
            history.forEach(msg => {
              this._addMessage(msg.role, msg.text, false, msg.isHTML || false);
            });
            restoredCount = history.length;
          }
        } catch (e) {
          console.error('[AI Widget] Failed to parse chat history:', e);
        }
      }

      if (restoredCount === 0) {
        this.messages.innerHTML = '';
        const welcomeText = "Hello! I'm KivoReach's AI assistant. Ask me anything about SEO, GEO, or digital marketing strategy.";
        this._addMessage('bot', welcomeText, true, false);
      }

      // Restore active pillar state
      const savedPillar = localStorage.getItem('amk_chat_pillar') || 'default';
      this.currentPillar = savedPillar;
      const ctx = PILLAR_CONTEXTS[savedPillar] || PILLAR_CONTEXTS.default;
      const label = document.getElementById('widget-context-label');
      if (label) label.textContent = ctx.greeting;

      this._renderSuggestions(savedPillar);
    }

    _saveToHistory(role, text, isHTML) {
      if (!this._checkAuth()) return;
      try {
        const savedHistory = localStorage.getItem('amk_chat_history');
        let history = [];
        if (savedHistory) {
          history = JSON.parse(savedHistory);
        }
        if (!Array.isArray(history)) {
          history = [];
        }
        history.push({ role, text, isHTML });
        localStorage.setItem('amk_chat_history', JSON.stringify(history));
      } catch (e) {
        console.error('[AI Widget] Failed to save chat history:', e);
      }
    }

    init() {
      buildWidget();

      this.panel    = document.getElementById('ai-widget-panel');
      this.fab      = document.getElementById('ai-widget-fab');
      this.messages = document.getElementById('widget-messages');
      this.input    = document.getElementById('widget-input');

      // Bind events
      this.fab.addEventListener('click', () => this.toggle());
      document.getElementById('widget-close-btn').addEventListener('click', () => this.close());
      document.getElementById('widget-send-btn').addEventListener('click', () => this.sendMessage());
      this.input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          this.sendMessage();
        }
      });

      // Intercept clicks on the input if unauthenticated
      this.input.addEventListener('click', (e) => {
        if (!this._checkAuth()) {
          e.preventDefault();
          this.input.blur();
          this._triggerAuthModal('login');
        }
      });

      // Event delegation for suggestion buttons
      this.panel.addEventListener('click', (e) => {
        const btn = e.target.closest('.widget-suggestion-btn');
        if (btn) {
          e.preventDefault();
          e.stopPropagation();
          const prompt = btn.getAttribute('data-prompt');
          if (prompt) {
            this.sendMessage(prompt);
          }
        }
      });

      // Watch for pillar changes
      this._observePillarChanges();
      
      // Load chat state
      this.restoreChatState();
    }

    toggle() {
      this.isOpen ? this.close() : this.open();
    }

    open() {
      this.isOpen = true;
      this.panel.classList.add('open');
      this.panel.setAttribute('aria-hidden', 'false');
      this.fab.style.transform = 'scale(0.9)';
      this.input.focus();
    }

    close() {
      this.isOpen = false;
      this.panel.classList.remove('open');
      this.panel.setAttribute('aria-hidden', 'true');
      this.fab.style.transform = '';
    }

    setPillar(pillar) {
      if (pillar === this.currentPillar) return;
      this.currentPillar = pillar;

      if (this._checkAuth()) {
        localStorage.setItem('amk_chat_pillar', pillar);
      }

      const ctx = PILLAR_CONTEXTS[pillar] || PILLAR_CONTEXTS.default;

      // Update context label
      const label = document.getElementById('widget-context-label');
      if (label) label.textContent = ctx.greeting;

      this._renderSuggestions(pillar);
    }

    _renderSuggestions(pillar) {
      const suggestionsEl = document.getElementById('widget-suggestions');
      if (!suggestionsEl) return;

      if (!this._checkAuth()) {
        suggestionsEl.innerHTML = '';
        return;
      }

      const ctx = PILLAR_CONTEXTS[pillar] || PILLAR_CONTEXTS.default;
      suggestionsEl.innerHTML = ctx.suggestions.slice(0, 3).map(s => `
        <button class="widget-suggestion-btn" data-prompt="${s.replace(/"/g, '&quot;')}">${s}</button>
      `).join('');
    }

    async sendMessage(customPrompt) {
      if (!this._checkAuth()) {
        this._triggerAuthModal('login');
        return;
      }

      if (this.isLoading) return;

      const text = customPrompt || (this.input ? this.input.value.trim() : '');
      if (!text) return;

      if (this.input) this.input.value = '';

      // Check plan and message limits
      let isFree = false;
      let email = '';
      let user = null;
      try {
        user = JSON.parse(localStorage.getItem('amk_user') || 'null');
        if (user) {
          isFree = (user.plan || 'free') === 'free';
          email = (user.email || '').toLowerCase();
        }
      } catch (e) {}

      // Admins bypass all limits
      const isAdmin = (user && user.is_admin) || email.includes('admin');
      if (isAdmin) {
        isFree = false;
      }

      if (isFree) {
        const sentCount = parseInt(localStorage.getItem('amk_free_chats_sent') || '0', 10);
        if (sentCount >= 5) {
          // Add user message first so they see what they sent
          this._addMessage('user', text, true, false);

          // Add promotional bubble
          const promoHtml = `
            <div class="trial-promo-container" style="background: linear-gradient(135deg, rgba(108, 99, 255, 0.12) 0%, rgba(0, 229, 192, 0.08) 100%); border: 1.5px solid rgba(108,99,255,0.25); border-radius: 14px; padding: 14px; margin: 8px 0; box-shadow: 0 8px 24px rgba(108,99,255,0.08); border-bottom-left-radius: 4px;">
              <p style="margin: 0 0 10px 0; font-size: 12.5px; line-height: 1.45; color: var(--text); font-weight: 500;">
                🚀 <strong>You've unlocked valuable insights!</strong> Upgrade to Basic or Pro today to continue this conversation, run unlimited audits, and export white-label reports.
              </p>
              <p style="margin: 0 0 12px 0; font-size: 11.5px; color: var(--text-muted);">
                🎟️ Use coupon code <strong class="font-mono text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/40 px-1.5 py-0.5 rounded">AMK20</strong> for <strong>20% off</strong>!
              </p>
              <div style="display: flex; flex-direction: column; gap: 8px;">
                <button class="promo-btn-trial" style="background: linear-gradient(135deg, #6C63FF, #5A52D5); color: white; border: none; padding: 9px 12px; border-radius: 10px; font-size: 11.5px; font-weight: 800; cursor: pointer; transition: all 0.2s; box-shadow: 0 4px 12px rgba(108,99,255,0.3); outline: none;">⚡ Activate 7-Day Pro Trial</button>
                <button class="promo-btn-upgrade" style="background: rgba(255,255,255,0.8); border: 1px solid rgba(108,99,255,0.3); color: #6C63FF; padding: 7px 12px; border-radius: 10px; font-size: 11.5px; font-weight: 700; cursor: pointer; transition: all 0.2s; outline: none;">Upgrade with 20% Off</button>
              </div>
            </div>
          `;
          this._addMessage('bot', promoHtml, false, true);

          // Wire up events dynamically
          const lastMsgEl = this.messages.lastChild;
          if (lastMsgEl) {
            const btnTrial = lastMsgEl.querySelector('.promo-btn-trial');
            const btnUpgrade = lastMsgEl.querySelector('.promo-btn-upgrade');

            if (btnTrial) {
              btnTrial.onclick = (e) => {
                if (e) { e.preventDefault(); e.stopPropagation(); }
                const user = JSON.parse(localStorage.getItem('amk_user') || 'null');
                if (user) {
                  user.plan = 'pro';
                  user.isTrial = true;
                  user.trialExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
                  localStorage.setItem('amk_user', JSON.stringify(user));
                  if (typeof Auth !== 'undefined') Auth.updateUI();
                  this._addMessage('bot', `🎉 <strong>7-Day Pro Trial Activated!</strong> You now have full access. Feel free to ask more questions!`, true, true);
                  if (typeof UI !== 'undefined') UI.showToast(`🎉 7-day Pro Trial activated!`, 'success');
                }
              };
            }

            if (btnUpgrade) {
              btnUpgrade.onclick = (e) => {
                if (e) { e.preventDefault(); e.stopPropagation(); }
                const localModal = document.getElementById('upgrade-modal');
                if (localModal) {
                  localModal.style.display = 'flex';
                  this.close(); // close chatbot panel
                } else {
                  if (typeof UI !== 'undefined') UI.showToast('Please open Settings -> Profile & Billing to upgrade.', 'info');
                }
              };
            }
          }
          return;
        } else {
          localStorage.setItem('amk_free_chats_sent', sentCount + 1);
        }
      }

      // Add user message
      this._addMessage('user', text, true, false);

      // Show loading
      this.isLoading = true;
      this.loadingMsgEl = this._addLoadingBubble();

      try {
        const response = await this._callBackend(text);
        this._removeLoadingBubble();
        this._addMessage('bot', response, true, false);
      } catch (err) {
        this._removeLoadingBubble();
        this._addMessage('bot', `⚠️ Engine unavailable. Start Ollama (ollama serve) or vault an API key in Settings → AI Vault.`, true, false);
      } finally {
        this.isLoading = false;
      }
    }

    async _callBackend(prompt) {
      let token = localStorage.getItem('amk_session_token') || '';
      if (!token) {
        try {
          const user = JSON.parse(localStorage.getItem('amk_user') || 'null');
          if (user && user.token) {
            token = user.token;
          }
        } catch (e) {}
      }
      
      const providerSelect = document.getElementById('widget-model-select');
      const provider = providerSelect ? providerSelect.value : 'openrouter';
      
      // ── Smart Response Caching (1 hour TTL) ──
      let cacheSlug = '';
      try {
        cacheSlug = btoa(unescape(encodeURIComponent(prompt.slice(0, 100)))).slice(0, 20);
      } catch (e) {
        cacheSlug = prompt.slice(0, 100).replace(/[^a-zA-Z0-9]/g, '_');
      }
      const cacheKey = `amk_ai_cache_${cacheSlug}`;
      try {
        const cached = JSON.parse(sessionStorage.getItem(cacheKey) || 'null');
        if (cached && (Date.now() - cached.ts) < 3600000) {
          if (cached.meta) {
            const activeModelEl = document.getElementById('widget-active-model');
            if (activeModelEl) {
              activeModelEl.textContent = `${cached.meta.model} (${cached.meta.provider}) [cached]`;
            }
          }
          return cached.response;
        }
      } catch (e) {}

      // ── Smart System Prompt (length adapts to query complexity) ──
      const isLongFormQuery = /\b(\d{3,}\s*words?|guide|explain|write|create|generate|strategy|plan|roadmap|step[- ]by[- ]step|comprehensive|detailed|complete|full|in[- ]depth|tutorial|how to|what is|digital marketing|seo strategy|content plan)\b/i.test(prompt);
      const responseGuidance = isLongFormQuery
        ? 'Provide a comprehensive, well-structured response. Use headings, bullet points and numbered steps where appropriate. Aim for completeness — do not artificially shorten your answer.'
        : 'Be concise and direct. Use bullet points for clarity. 2-4 short paragraphs max.';
      const systemPrompt = `You are KivoReach's expert AI consultant specialising in SEO, GEO (Generative Engine Optimisation), E-E-A-T frameworks, content strategy, and digital marketing. Your knowledge base includes the full KivoReach Academy curriculum, technical SEO best-practices, and the AMK 8-Pillar growth framework. ${responseGuidance} Always be actionable and data-driven. Active module: ${this.currentPillar}. When the user asks about resources in the platform, reference the relevant KivoReach Academy modules, docs, or tools by name.`;
      
      // ── Context: send last 6 messages for better continuity ──
      let recentHistory = [];
      try {
        const savedHistory = JSON.parse(localStorage.getItem('amk_chat_history') || '[]');
        if (Array.isArray(savedHistory)) {
          recentHistory = savedHistory.slice(-6).map(m => ({
            role: m.role === 'user' ? 'user' : 'assistant',
            content: (m.text || '').slice(0, 500)
          }));
        }
      } catch (e) {}

      // ── Page / content awareness: tell the backend what the user is doing ──
      const pageContext = (() => {
        const page = window.location.pathname;
        const data = {};
        try {
          const la = JSON.parse(localStorage.getItem('amk_last_audit') || 'null');
          if (la) data.last_audit = { score: la.score, domain: (la.company_profile || {}).domain };
          const grab = id => { const el = document.getElementById(id); return (el && el.value) ? el.value.trim() : null; };
          const topic = grab('articleTopic'); if (topic) data.article_topic = topic;
          const kw = grab('focusKeyword') || grab('keyword'); if (kw) data.title_keyword = kw;
          const niche = grab('keywordNiche'); if (niche) data.keyword_niche = niche;
          const auditUrl = grab('urlInput') || grab('hub-url-input'); if (auditUrl) data.audit_url = auditUrl;
        } catch (e) {}
        return { page, data };
      })();

      const payload = {
        message: prompt,
        provider: provider,
        user_id: 1,
        system_prompt: systemPrompt,
        max_tokens: isLongFormQuery ? 1800 : 600,
        context: recentHistory,
        page_context: pageContext
      };

      const res = await API.rawFetch('/api/v1/chat-widget', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': token ? `Bearer ${token}` : ''
          },
          body: JSON.stringify(payload)
        });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      
      const responseText = data.status === 'success' 
        ? data.response 
        : (data.response || "⚠️ Backend connection error.");
      
      // Update telemetry UI
      if (data.status === 'success' && data.meta) {
        const cost = data.meta.cost || 0.0;
        this.sessionCost = (this.sessionCost || 0.0) + cost;
        
        const activeModelEl = document.getElementById('widget-active-model');
        const sessionCostEl = document.getElementById('widget-session-cost');
        if (activeModelEl) {
          activeModelEl.textContent = `${data.meta.model} (${data.meta.provider})`;
        }
        if (sessionCostEl) {
          sessionCostEl.textContent = `$${this.sessionCost.toFixed(4)}`;
        }
      }

      // ── Cache the response ──
      try {
        sessionStorage.setItem(cacheKey, JSON.stringify({ 
          response: responseText, 
          ts: Date.now(),
          meta: data.meta || null
        }));
      } catch (e) {}
      
      return responseText;
    }

    _getApiKeys() {
      try {
        return JSON.parse(localStorage.getItem('amk_api_keys') || '{}');
      } catch {
        return {};
      }
    }

    _addMessage(role, text, saveToHistory = true, isHTML = false) {
      const msgEl = document.createElement('div');
      msgEl.className = `widget-msg ${role}`;
      msgEl.innerHTML = `<div class="msg-bubble">${isHTML ? text : this._formatMarkdown(text)}</div>`;
      this.messages.appendChild(msgEl);
      this.messages.scrollTop = this.messages.scrollHeight;

      if (saveToHistory) {
        this._saveToHistory(role, text, isHTML);
      }
      return msgEl;
    }

    _addLoadingBubble() {
      const msgEl = document.createElement('div');
      msgEl.className = 'widget-msg bot';
      msgEl.innerHTML = `<div class="msg-bubble loading"><span></span><span></span><span></span></div>`;
      this.messages.appendChild(msgEl);
      this.messages.scrollTop = this.messages.scrollHeight;
      return msgEl;
    }

    _removeLoadingBubble() {
      if (this.loadingMsgEl && this.loadingMsgEl.parentNode) {
        this.loadingMsgEl.parentNode.removeChild(this.loadingMsgEl);
      }
      this.loadingMsgEl = null;
    }

    _formatMarkdown(text) {
      if (!text) return '';
      let escaped = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
      
      // bold **text**
      escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      // italic *text*
      escaped = escaped.replace(/\*(.*?)\*/g, '<em>$1</em>');
      // inline code `code`
      escaped = escaped.replace(/`(.*?)`/g, '<code>$1</code>');
      // markdown link [text](url) -> <a href="url" target="_blank" rel="noopener noreferrer">text ↗</a>
      escaped = escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" style="color: #6C63FF; text-decoration: underline; font-weight: bold;">$1 ↗</a>');
      // lines
      escaped = escaped.replace(/\n/g, '<br>');
      return escaped;
    }

    _observePillarChanges() {
      // Watch for pillar-item clicks to update widget context
      document.addEventListener('click', (e) => {
        const pillarItem = e.target.closest('[data-pillar]');
        if (pillarItem) {
          const pillar = pillarItem.dataset.pillar;
          if (pillar) this.setPillar(pillar);
        }
      });
    }
  }

  // ── Initialize on DOM ready ──────────────────────────────────────────────
  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        window.AMKAIWidget = new AIWidgetController();
        window.AMKAIWidget.init();
      });
    } else {
      window.AMKAIWidget = new AIWidgetController();
      window.AMKAIWidget.init();
    }
  }

  init();
})();
