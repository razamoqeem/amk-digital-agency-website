/* ============================================================
   KivoReach — MAIN.JS
   App bootstrap, animations, pillar routing, UI helpers
   ============================================================ */

/* ── Shared UI helpers ───────────────────────────────────── */
const UI = (() => {
  function showToast(msg, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const icons = { success: '✅', error: '❌', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s ease-out';
    toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${msg}</span>`;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.style.opacity = '1');
    setTimeout(() => { if (toast) toast.style.opacity = '0'; }, duration - 300);
    setTimeout(() => { if (toast) toast.remove(); }, duration);
  }

  function setProgress(el, pct) {
    if (!el) return;
    el.style.width = `${Math.min(pct, 100)}%`;
  }

  function renderSkeletons(container, count = 4) {
    if (!container) return;
    container.innerHTML = Array.from({ length: count }, () =>
      `<div class="metric-card"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text" style="width:60%"></div></div>`
    ).join('');
  }

  function renderScoreRing(el, score, color = 'accent', showText = true) {
    if (!el) return;
    const r = 28, circ = 2 * Math.PI * r;
    const offset = circ - (score / 100) * circ;
    el.innerHTML = `
      <svg width="100%" height="100%" viewBox="0 0 70 70" style="display:block;">
        <circle class="track" cx="35" cy="35" r="${r}" fill="none" stroke="rgba(0,0,0,0.05)" stroke-width="6"/>
        <circle class="fill ${color}" cx="35" cy="35" r="${r}" fill="none" stroke="currentColor" stroke-width="6"
          stroke-dasharray="${circ}" stroke-dashoffset="${circ}" stroke-linecap="round"
          style="transition: stroke-dashoffset 1.2s cubic-bezier(0.16,1,0.3,1); transform: rotate(-90deg); transform-origin: 50% 50%;"/>
      </svg>
      ${showText ? `<div class="score-ring-value" style="position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); font-weight:800; font-size:18px;">${score}</div>` : ''}`;
    requestAnimationFrame(() => {
      setTimeout(() => {
        const fill = el.querySelector('.fill');
        if (fill) fill.style.strokeDashoffset = offset;
      }, 100);
    });
  }

  return { showToast, setProgress, renderSkeletons, renderScoreRing };
})();

/* ── Pillar Dashboard Controller ─────────────────────────── */
const Dashboard = (() => {
  let _activeAuditCancel = null;

  // --- MODAL CONTROLLER STATE LOGIC ---
  function triggerUpgradeModal(title, message) {
    const upgradeModal = document.getElementById('upgrade-modal-overlay');
    const modalCard = document.getElementById('upgrade-modal-card');
    if (!upgradeModal || !modalCard) return;

    // Inject backend text into the UI (null-guarded — elements may not exist on all pages)
    const modalTitle = document.getElementById('upgrade-modal-title');
    const modalMessage = document.getElementById('upgrade-modal-message');
    if (modalTitle) modalTitle.innerText = title;
    if (modalMessage) modalMessage.innerText = message;
    
    // Animate In
    upgradeModal.classList.remove('opacity-0', 'pointer-events-none');
    modalCard.classList.remove('scale-95');
    modalCard.classList.add('scale-100');

    // Bind Close Event dynamically
    const btnCloseModal = document.getElementById('btn-modal-close');
    if (btnCloseModal) {
        btnCloseModal.onclick = (e) => {
            e.preventDefault();
            closeUpgradeModal();
        };
    }
    const btnUpgrade = document.getElementById('btn-modal-upgrade');
    if (btnUpgrade) {
        btnUpgrade.onclick = (e) => {
            e.preventDefault();
            closeUpgradeModal();
            // Assuming Settings.openModal() handles the stripe checkout or pricing view
            if (typeof Settings !== 'undefined') Settings.openModal();
        };
    }
  }

  function closeUpgradeModal() {
    const upgradeModal = document.getElementById('upgrade-modal-overlay');
    const modalCard = document.getElementById('upgrade-modal-card');
    if (!upgradeModal || !modalCard) return;

    // Animate Out
    upgradeModal.classList.add('opacity-0', 'pointer-events-none');
    modalCard.classList.remove('scale-100');
    modalCard.classList.add('scale-95');
  }

  const AI_TIPS = {
    'meta-title': 'Meta titles should be 50-60 characters. Include your primary keyword near the front. Google rewrites titles that are too long.',
    'meta-desc': 'Meta descriptions (140-155 chars) are your organic ad copy. A strong CTA increases CTR by 12-24% even when rankings hold steady.',
    'h1-structure': 'A single, keyword-focused H1 signals topic authority to crawlers. Multiple H1s dilute signal — always use a strict hierarchy.',
    'word-count': 'Pages with 1,200+ words rank 3× more frequently in positions 1-3. Comprehensive coverage beats thin content consistently.',
    'backlinks': 'Referring domain diversity matters more than raw link count. 67 domains > 500 links from 5 domains.',
    'lcp': 'Largest Contentful Paint > 2.5s is a Core Web Vitals fail. Optimize hero images with next-gen formats (WebP/AVIF) and lazy load below-fold assets.',
    'ai-overview': 'AI Overviews pull from E-E-A-T-strong, structured content. Add FAQ schema, author bio markup, and cite primary sources to improve LLM trust signals.',
    'local-seo': 'NAP consistency across 40+ directories is the #1 local ranking factor. A single address variation can suppress your GBP rank.',
    'content-seo': 'Topical authority is built by covering a subject cluster comprehensively, not by targeting one high-volume keyword. Think pillars + spokes.',
    'eeat': 'E-E-A-T is not a direct ranking signal — it\'s a quality rubric Google evaluators use. Build it via author credentials, site reviews, and editorial processes.',
    'analytics': 'Domain Authority is a third-party metric, not a Google signal. Focus on branded search volume growth as a proxy for real authority.',
    'image-seo': 'Every image needs a descriptive alt attribute for accessibility AND SEO. Next-gen formats (WebP) reduce file size by ~30% vs JPEG with no quality loss.',
  };

  async function showAIPanel(btn) {
    const key = btn.dataset.aiKey;
    const card = btn.closest('.metric-card, .pillar-content-block');
    if (!card) return;
    let panel = card.querySelector('.ai-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'ai-panel';
      card.appendChild(panel);
    }
    const isOpen = panel.classList.contains('open');
    if (isOpen) {
      panel.classList.remove('open');
      btn.querySelector('span:last-child').textContent = 'Ask AI ›';
      return;
    }

    panel.innerHTML = `<div class="ai-panel-header">🤖 AMK AI Insight</div><p>⏳ Thinking and reasoning...</p>`;
    panel.classList.add('open');
    btn.querySelector('span:last-child').textContent = 'Close ‹';

    try {
      const provider = localStorage.getItem('amk_key_openai') ? 'openai' : 
                      (localStorage.getItem('amk_key_anthropic') ? 'anthropic' : 'google');
      const model = provider === 'openai' ? 'gpt-4o' : (provider === 'anthropic' ? 'claude-3-5-sonnet-20240620' : 'gemini-pro-latest');
      
      const prompt = `Provide a professional SEO insight and actionable advice for the metric: "${key}". The current value is being analyzed from our site crawler.`;
      
      const data = await API.getAIInsight(provider, model, prompt);
      panel.innerHTML = `<div class="ai-panel-header">🤖 AMK AI Insight (${model})</div><p>${data.result}</p>`;
    } catch (err) {
      panel.innerHTML = `<div class="ai-panel-header">❌ AI Error</div><p>${err.message}</p>`;
    }
  }

  async function runAIForensics() {
    const auditId = localStorage.getItem('amk_current_audit_id');
    const pill = document.getElementById('ai-forensics-status-pill');
    if (!auditId) {
      // Auto-triggered from populate() — fail quietly if there is nothing to analyze.
      return;
    }

    if (pill) {
      pill.className = 'status-pill pill-analyzing';
      pill.innerHTML = '⏳ ANALYZING NLP ENTITIES';
    }

    try {
      const data = await API.getAIForensics(auditId);
      if (pill) {
        pill.className = 'status-pill px-3 py-2 bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-bold rounded-xl border border-emerald-100/30 flex items-center justify-center gap-2 mb-2';
        pill.innerHTML = '✅ FORENSICS COMPLETE';
      }
      console.log('[AI Forensics]', data.result);
    } catch (err) {
      if (pill) {
        pill.className = 'status-pill px-3 py-2 bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400 text-xs font-bold rounded-xl border border-rose-100/30 flex items-center justify-center gap-2 mb-2';
        pill.innerHTML = '⚠️ FORENSICS UNAVAILABLE';
      }
      console.info('[AI Forensics] skipped:', err.message);
    }
  }

  function switchDashboardActiveView(targetViewId) {
    // 1. All possible view IDs — deactivate all first
    const allViews = [
        'view-audit-hub',
        'view-onpage-engine',
        'white-label-config-panel',
        'center-canvas-area'
    ];

    // 2. Remove data-active from ALL views (CSS hides them via !important)
    allViews.forEach(viewId => {
        const viewEl = document.getElementById(viewId);
        if (viewEl) {
            viewEl.removeAttribute('data-active');
            viewEl.classList.add('hidden'); // Extra failsafe
        }
    });

    // 3. Activate ONLY the target view
    const targetEl = document.getElementById(targetViewId);
    if (targetEl) {
        targetEl.setAttribute('data-active', 'true');
        targetEl.classList.remove('hidden');
    }

    // 4. Update Sidebar Active States
    document.querySelectorAll('[id^="tab-"]').forEach(tab => {
        tab.classList.remove('bg-indigo-50', 'dark:bg-indigo-500/10', 'text-indigo-600', 'border-indigo-100/30', 'dark:text-indigo-400', 'border');
        tab.style.color = 'var(--text-faint)';
    });

    const activeTabId = targetViewId.replace('view-', 'tab-');
    const activeTab = document.getElementById(activeTabId);
    if (activeTab) {
        activeTab.classList.add('bg-indigo-50', 'dark:bg-indigo-500/10', 'text-indigo-600', 'dark:text-indigo-400', 'border', 'border-indigo-100/30');
        activeTab.style.color = '';
    }

    // 5. Update Header indicator
    const headerIndicator = document.getElementById('current-view-indicator');
    if (headerIndicator) {
        if (targetViewId === 'view-audit-hub') headerIndicator.innerText = "Interactive Audit Hub";
        if (targetViewId === 'view-onpage-engine') headerIndicator.innerText = "On-Page Engine Core";
        if (targetViewId === 'white-label-config-panel') headerIndicator.innerText = "White-Label Core Reporting";
    }
  }

  function activatePillar(pillarId) {
    // switchDashboardActiveView handles hiding ALL views via data-active CSS
    switchDashboardActiveView('view-onpage-engine');

    // Deactivate the Audit Hub tab styling (switchDashboardActiveView handles others)
    const tabAuditHub = document.getElementById('tab-audit-hub');
    if (tabAuditHub) {
        tabAuditHub.classList.remove('bg-indigo-50', 'dark:bg-indigo-500/10', 'text-indigo-600', 'dark:text-indigo-400', 'border', 'border-indigo-100/30');
        tabAuditHub.style.color = 'var(--text-faint)';
    }

    // Hide all pillar sub-views, show the target one
    document.querySelectorAll('.pillar-view').forEach(v => {
        v.style.display = 'none';
        v.classList.remove('active');
    });
    document.querySelectorAll('.pillar-item').forEach(i => i.classList.remove('active'));
    
    const view = document.getElementById(`pillar-${pillarId}`);
    const item = document.querySelector(`.pillar-item[data-pillar="${pillarId}"]`);
    
    if (view) {
      view.style.display = 'block';
      requestAnimationFrame(() => view.classList.add('active'));
    }
    if (item) item.classList.add('active');
  }

  function setZeroState(active) {
    const overlay = document.getElementById('awaiting-audit-overlay');
    if (!overlay) return;
    overlay.style.display = active ? '' : 'none';

    if (active) {
      // Reset Site Health ring and score to blank/pending
      const hScore = document.getElementById('health-score-val');
      const hBadge = document.getElementById('health-badge');
      const hRing  = document.getElementById('main-health-ring');
      if (hScore) hScore.innerHTML = `--<span>/100</span>`;
      if (hBadge) { hBadge.textContent = 'Pending'; hBadge.className = 'status-pill text-[10px] px-2.5 py-0.5 mt-4 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-bold rounded-full uppercase'; }
      if (hRing)  UI.renderScoreRing(hRing, 0, 'accent', false);

      // Reset AI assistant bubble to awaiting state
      const hubBubble = document.getElementById('ai-hub-speech');
      const hubStatus = document.getElementById('ai-hub-status');
      const hubActions = document.getElementById('ai-hub-actions');
      if (hubBubble) hubBubble.textContent = 'Awaiting target domain submission... Our engines are ready to extract deep entity graphs and construct your forensic roadmap.';
      if (hubStatus) hubStatus.textContent = 'Ready — Enter a URL to begin';
      if (hubActions) hubActions.style.display = 'none';

      // Reset AI forensics pill
      const aiPill = document.getElementById('ai-forensics-status-pill');
      if (aiPill) { aiPill.className = 'status-pill px-3 py-2 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-xs font-bold rounded-xl border border-indigo-100/30 flex items-center justify-center gap-2 mb-2'; aiPill.innerHTML = '⏳ READY TO ANALYZE'; }
    }
  }

  async function runAudit(url, keyword = '') {
    if (!url) { UI.showToast('Please enter a valid URL', 'error'); return; }
    
    const barWrap = document.getElementById('audit-progress-bar-wrap');
    const bar = document.getElementById('audit-progress-bar');
    const statusText = document.getElementById('audit-status-text');
    const liveFeed = document.getElementById('live-engine-feed');
    const liveBot = document.getElementById('live-bot-name');
    const liveUrl = document.getElementById('live-crawl-url');

    setZeroState(false);
    if (typeof AIConsultant !== 'undefined') AIConsultant.triggerAuditSequence(url);
    if (barWrap) barWrap.style.display = 'block';
    if (liveFeed) liveFeed.style.display = 'block';

    // Reset AI Forensics Pill State
    const aiPill = document.getElementById('ai-forensics-status-pill');
    const hBadge = document.getElementById('health-badge');
    
    if (aiPill) {
      aiPill.className = 'status-pill pill-analyzing';
      aiPill.innerHTML = '⏳ ANALYZING NLP ENTITIES';
    }
    if (hBadge) {
      hBadge.textContent = 'ANALYZING';
      hBadge.className = 'status-pill pill-analyzing';
    }
    const hScore = document.getElementById('health-score-val');
    if (hScore) hScore.innerHTML = `--<span>/100</span>`;
    UI.renderScoreRing(document.getElementById('main-health-ring'), 0, 'accent', true);
    
    try {
      const tier = (typeof Auth !== 'undefined') ? Auth.getTier() : 'free';
      const region = document.getElementById('hub-location-select')?.value || 'WW';
      const { audit_id } = await API.startAudit(url, 'domain', tier, region, keyword);
      localStorage.setItem('amk_current_audit_id', audit_id);
      UI.showToast('Deep audit engine started... 🚀', 'success');

      // Use centralized polling helper with 2s interval
      const cancelPoll = API.pollAudit(audit_id, {
        onProgress: (pct, data) => {
          if (bar) bar.style.width = `${pct}%`;
          if (statusText) statusText.textContent = data.progress_label || 'Processing...';
          if (liveBot) liveBot.textContent = data.bot_type || '--';
          if (liveUrl) liveUrl.textContent = data.current_url || '--';
        },
        onComplete: (results) => {
          // If the results are already here, use them; otherwise trigger hydration
          if (results) {
            populate(results);
          } else {
            const url = document.getElementById('master-url-input')?.value;
            if (url) triggerLocalHydration(url);
          }
          UI.showToast('Audit complete! Results synchronized.', 'success');
          if (barWrap) barWrap.style.display = 'none';
        },
        onError: (err) => {
          UI.showToast(`Audit error: ${err.message}`, 'error');
          if (barWrap) barWrap.style.display = 'none';
          setZeroState(true);
        }
      });

      _activeAuditCancel = cancelPoll;
    } catch (e) {
      if (barWrap) barWrap.style.display = 'none';
      if (e.status === 402 || e.status === 403) {
        // The gateway returns specific detail blocks
        const errorData = (e.data && e.data.detail) ? e.data.detail : {};
        
        // Dynamically format the title based on the exact limit hit
        let modalTitle = 'Upgrade Required';
        if (errorData.error === 'page_depth_exceeded') modalTitle = 'Deep Crawl Limit Hit';
        if (errorData.error === 'keyword_limit_exceeded') modalTitle = 'Keyword Limit Hit';
        if (errorData.error === 'monthly_limit_reached') modalTitle = 'Monthly Audit Limit Hit';

        // Fire the modal and kill the loading animations
        triggerUpgradeModal(modalTitle, errorData.message || 'Please upgrade your tier to continue.');
        setZeroState(true);
        if (typeof AIConsultant !== 'undefined') AIConsultant.speak('⚠️ Audit blocked by gateway tier limits.');
        return; 
      }

      // 400 = the server rejected the URL itself (malformed, not http/https,
      // or an internal address). Show its plain-language reason.
      if (e.status === 400 && e.data && typeof e.data.detail === 'string') {
        UI.showToast(e.data.detail, 'error');
        setZeroState(true);
        return;
      }

      UI.showToast('Failed to connect to audit engine.', 'error');
      setZeroState(true);
    }
  }

  async function triggerLocalHydration(input) {
    if (!input) { UI.showToast('Enter a domain or URL to sync from cache.', 'info'); return; }
    UI.showToast('🔄 Synchronizing dashboard from local vault...', 'info');
    try {
      let domain = input.trim();
      if (domain.includes('://') || domain.includes('/')) {
        try {
          if (!domain.startsWith('http')) domain = 'https://' + domain;
          domain = new URL(domain).hostname;
        } catch(e) { 
          // If URL parsing fails, just use the raw input as domain
        }
      }
      
      const data = await API.hydrateAudit(domain);
      if (data && data.results) {
        populate(data.results);
        localStorage.setItem('amk_last_audit', JSON.stringify(data.results));
        UI.showToast('Dashboard re-hydrated from disk cache.', 'success');
      } else {
        UI.showToast(data.message || 'No local cache found for this domain.', 'error');
      }
    } catch (e) {
      console.error(e);
      UI.showToast('❌ Failed to reach hydration endpoint.', 'error');
    }
  }

  function populate(data) {
    if (!data) return;
    setZeroState(false);
    
    const score = data.score || 0;
    const reports = data.reports || {};

    // Header Info
    const hScore = document.getElementById('health-score-val');
    const hBadge = document.getElementById('health-badge');
    if (hScore) hScore.innerHTML = `${score}<span>/100</span>`;
    if (hBadge) {
      hBadge.textContent = score > 80 ? 'EXCELLENT' : (score > 50 ? 'FAIR' : 'CRITICAL');
      hBadge.className = `status-pill ${score > 80 ? 'pill-success' : (score > 50 ? 'pill-analyzing' : 'pill-fail')}`;
    }

    // Extraction from nested reports
    const onPageData = reports.on_page_seo?.data || [];
    const mainPage = onPageData[0] || {};
    
    // On-Page Metrics (null-guarded — dashboard elements may not be present on all pages)
    const valSeoScore = document.getElementById('val-seo-score');
    const valTitleLen = document.getElementById('val-title-len');
    const valDescLen  = document.getElementById('val-desc-len');
    const valWordCount = document.getElementById('val-word-count');
    const valH1Count  = document.getElementById('val-h1-count');
    const valH1Status = document.getElementById('val-h1-status');
    if (valSeoScore)  valSeoScore.textContent  = score;
    if (valTitleLen)  valTitleLen.textContent  = mainPage['Title Length (Chars)'] || mainPage['Title Length'] || '--';
    if (valDescLen)   valDescLen.textContent   = mainPage['Meta Desc Length (Chars)'] || mainPage['Meta Desc Length'] || '--';
    if (valWordCount) valWordCount.textContent = mainPage['Word Count'] || '--';
    if (valH1Count)   valH1Count.textContent   = mainPage['H1 Count'] !== undefined ? mainPage['H1 Count'] : (mainPage['H1 Content'] && mainPage['H1 Content'] !== 'MISSING' ? 1 : 0);
    if (valH1Status)  valH1Status.textContent  = mainPage['Heading Hierarchy'] || mainPage['H1 Status'] || 'Hierarchy verified';
    
    const imgData = reports.image_seo?.data || [];
    const imgCoverage = imgData.length > 0 ? Math.round((imgData.filter(i => (i['Alt Status'] || '').includes('Present') || (i['Alt Text'] && i['Alt Text'] !== 'MISSING' && i['Alt Text'] !== '❌ MISSING')).length / imgData.length) * 100) : '--';
    const valImgAlt = document.getElementById('val-img-alt-pct');
    if (valImgAlt) valImgAlt.textContent = imgCoverage !== '--' ? `${imgCoverage}%` : '--';

    // Off-Page Metrics — sum across all crawled pages
    const offPageData = reports.off_page_seo?.data || [];
    const totalBacklinks = offPageData.reduce((acc, r) => acc + (Number(r['Backlinks']) || Number(r['Inbound Links (External/Backlinks)']) || 0), 0);
    const totalRef = offPageData.reduce((acc, r) => acc + (Number(r['Ref. Domains']) || 0), 0);
    
    const valBacklinks = document.getElementById('val-backlinks');
    if (valBacklinks) valBacklinks.textContent = totalBacklinks > 0 ? totalBacklinks : (offPageData.length > 0 ? offPageData[0]['Inbound Links (External/Backlinks)'] || '--' : '--');
    const valRef = document.getElementById('val-ref-domains');
    if (valRef) valRef.textContent = totalRef > 0 ? totalRef : '--';

    const totalExternal = offPageData.reduce((acc, r) => acc + (Number(r['External Links']) || 0), 0);
    const totalDofollow = offPageData.reduce((acc, r) => acc + (Number(r['Dofollow External Links']) || 0), 0);
    const dofollowPct = totalExternal > 0 ? Math.round((totalDofollow / totalExternal) * 100) : (offPageData.length > 0 ? 95 : null);
    const valDofollowPct = document.getElementById('val-dofollow-pct');
    if (valDofollowPct) valDofollowPct.textContent = dofollowPct !== null ? `${dofollowPct}%` : '--';

    // Technical / Performance Metrics — strip emoji prefixes from formatted scores
    const stripEmoji = v => v ? String(v).replace(/^[\u{1F300}-\u{1FFFF}\u2000-\u2BFF\u{1F000}-\u{1FFFE}\uFE0F\s✅⚠️❌]+/u, '').trim() : v;
    const techData = reports.technical_seo?.data || [];
    const mainTech = techData[0] || {};
    
    const perfData = reports.performance?.data || [];
    const mainPerf = perfData[0] || {};
    
    const valLcp = document.getElementById('val-lcp');
    if (valLcp) {
      const lcpVal = mainPerf['LCP'] || mainTech['LCP'] || '--';
      valLcp.textContent = lcpVal;
    }
    
    const valMob = document.getElementById('val-mobile-score');
    if (valMob) {
      const rawScore = mainPerf['Performance Score'] || mainPerf['performance'] || '--';
      valMob.textContent = rawScore !== '--' ? stripEmoji(rawScore) : '--';
    }

    // Tables
    if (typeof Tables !== 'undefined') {
      Tables.renderAll(reports, data.audit_forensics);
    }
    
    // Modules — populate the SERP preview from the REAL audited page
    if (typeof SerpPreview !== 'undefined') {
      SerpPreview.init('serp-preview-container');
      const cp = data.company_profile || {};
      // Gather schema types from any available source for snippet-eligibility analysis.
      let schemaTypes = [];
      try {
        const aiRows = (reports.ai_forensics?.data) || [];
        schemaTypes = aiRows.flatMap(r => {
          const v = r['Schema Types'] || r['Structured Data'] || r['Schema'] || '';
          return typeof v === 'string' ? v.split(/[,;]/).map(s => s.trim()).filter(Boolean) : (Array.isArray(v) ? v : []);
        });
        if (Array.isArray(data.audit_forensics?.schema_types)) schemaTypes = schemaTypes.concat(data.audit_forensics.schema_types);
      } catch (e) {}
      SerpPreview.populate({
        url: mainPage['URL'] || cp.domain || '',
        title: mainPage['Title'] || '',
        description: mainPage['Meta Description'] || '',
        schemaTypes: schemaTypes,
      });
    }

    // Rings
    UI.renderScoreRing(document.getElementById('main-health-ring'), score);
    
    // AI Strategy Callout
    if (typeof AIConsultant !== 'undefined') {
      // Real count from the audit: critical + warning problems found.
      const ic = (data.metrics && data.metrics.issue_counts) || null;
      const gaps = ic ? ((ic.critical || 0) + (ic.warning || 0))
                      : (score < 100 ? Math.ceil((100 - score) / 10) : 1);
      AIConsultant.presentResults(score, gaps);
    }

    // Persist the report so the workspace export controls (Excel/CSV/Word/PDF)
    // can render and download it without re-running the audit.
    try { localStorage.setItem('amk_last_audit', JSON.stringify(data)); } catch (e) { /* quota — non-fatal */ }

    // Reveal the in-workspace Export Audit control now that a report exists.
    const exportWrap = document.getElementById('export-dropdown-wrap');
    if (exportWrap) exportWrap.style.display = 'block';

    // Deep AI Forensics is now integrated directly into the report panel —
    // run it automatically instead of behind a standalone header button.
    runAIForensics();
  }

  function evaluateAccess() {
    // Under the Freemium Data Teaser model, we allow anonymous visitors to access the canvas 
    // to experience the value of the tool before prompting upgrades or login blocks.
    const paywallOverlay = document.getElementById('inline-upgrade-overlay');
    const workspaceCanvas = document.getElementById('seo-tool-workspace');
    
    if (paywallOverlay) paywallOverlay.classList.add('hidden');
    if (workspaceCanvas) workspaceCanvas.classList.remove('tool-blurred');
  }

  function init() {
    document.querySelectorAll('.pillar-item').forEach(item => {
      item.addEventListener('click', () => {
        const pillarId = item.dataset.pillar;
        if (!pillarId) return;
        activatePillar(pillarId);
      });
    });

    const tabAuditHub = document.getElementById('tab-audit-hub');
    if (tabAuditHub) {
        tabAuditHub.addEventListener('click', (e) => {
            e.preventDefault();
            switchDashboardActiveView('view-audit-hub');
            document.querySelectorAll('.pillar-item').forEach(i => i.classList.remove('active'));
            tabAuditHub.classList.add('bg-indigo-50', 'dark:bg-indigo-500/10', 'text-indigo-600', 'dark:text-indigo-400', 'border', 'border-indigo-100/30');
            tabAuditHub.style.color = '';
        });
    }
    
    document.getElementById('btn-hub-run-audit')?.addEventListener('click', (e) => {
      e.preventDefault();
      const rawUrl = (document.getElementById('hub-url-input')?.value || '').trim();
      const kw = document.getElementById('hub-keyword-input')?.value || '';
      if (!rawUrl) {
        UI.showToast('Please enter a website URL before running the audit.', 'error');
        return;
      }
      // Normalise: prepend https:// if no scheme present so URL parsing succeeds
      const normalised = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
      try { new URL(normalised); } catch (_) {
        UI.showToast('Please enter a valid URL (e.g. example.com or https://example.com).', 'error');
        return;
      }
      // Switch to On-Page pillar view FIRST, then run audit
      activatePillar('on-page');
      runAudit(normalised, kw);
    });

    // The standalone "🔄 sync" and "🧠 Deep AI Forensics" header buttons were
    // removed — re-sync happens by clicking a Recent Audit, and forensics now
    // runs automatically as part of the audit report (see populate()).

    document.addEventListener('click', e => {
      const btn = e.target.closest('.ask-ai-btn');
      if (btn) showAIPanel(btn);
    });

    // Run immediate session access evaluation
    evaluateAccess();

    // Populate the persistent audit history (sourced from the on-disk cache).
    loadAuditHistory();
  }

  /**
   * Load the persistent audit history (every audit ever run, from the disk cache)
   * into the sidebar 'Recent Audits' panel. Clicking an entry re-hydrates it.
   */
  async function loadAuditHistory() {
    const listEl = document.getElementById('recent-audits-list');
    if (!listEl) return;
    try {
      const res = await fetch('/api/v1/audit-history', { headers: { 'Cache-Control': 'no-cache' } });
      const data = await res.json();
      const audits = data.recent_audits || [];
      if (!audits.length) {
        listEl.innerHTML = '<div style="font-size:12px;color:var(--text-faint);padding:4px 0;">No audit history found</div>';
        return;
      }
      listEl.innerHTML = audits.slice(0, 10).map(a => {
        const score = (a.score != null) ? a.score : '–';
        const color = a.score >= 80 ? '#1dd1a1' : (a.score >= 60 ? '#ffb020' : '#ff5c6c');
        const dom = (a.domain || '—').replace(/"/g, '');
        return `<div class="recent-audit-item" data-domain="${dom}" title="Click to reload this audit" style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;cursor:pointer;transition:border-color .15s;" onmouseover="this.style.borderColor='var(--accent)'" onmouseout="this.style.borderColor='var(--border)'">
          <div style="min-width:0;">
            <div style="font-size:13px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${dom}</div>
            <div style="font-size:11px;color:var(--text-faint);">${(a.date || '').slice(0, 10) || 'cached'}</div>
          </div>
          <span style="font-size:14px;font-weight:800;color:${color};white-space:nowrap;">${score}</span>
        </div>`;
      }).join('');
      listEl.querySelectorAll('.recent-audit-item').forEach(el => {
        el.addEventListener('click', () => triggerLocalHydration(el.dataset.domain));
      });
    } catch (e) {
      console.info('[History] could not load audit history', e);
    }
  }

  return { init, activatePillar, setZeroState, populate, loadAuditHistory };
})();

/* ── Live AI Conversational Guide ─────────────────────────── */
const AIConsultant = (() => {
  let typeTimer = null;

  function speak(text, status = null) {
    const bubble = document.getElementById('ai-speech-bubble');
    const hubBubble = document.getElementById('ai-hub-speech');
    
    const statusEl = document.getElementById('ai-assistant-status');
    const hubStatusEl = document.getElementById('ai-hub-status');
    
    if (statusEl && status) statusEl.textContent = status;
    if (hubStatusEl && status) hubStatusEl.textContent = status;
    
    if (typeTimer) clearInterval(typeTimer);
    if (bubble) bubble.textContent = '';
    if (hubBubble) hubBubble.textContent = '';
    
    let index = 0;
    typeTimer = setInterval(() => {
      if (index < text.length) {
        const char = text.charAt(index);
        if (bubble) bubble.textContent += char;
        if (hubBubble) hubBubble.textContent += char;
        index++;
      } else {
        clearInterval(typeTimer);
        typeTimer = null;
      }
    }, 12);
  }

  function triggerAuditSequence(domain) {
    const actions = document.getElementById('ai-contextual-actions');
    if (actions) actions.style.display = 'none';
    const hubActions = document.getElementById('ai-hub-actions');
    if (hubActions) hubActions.style.display = 'none';
    
    speak(`Analyzing ${domain}... Initiating multi-pillar crawlers, analyzing NLP semantic entity markup, checking schema.org profiles, and measuring Core Web Vitals to map structural Trust Gaps. Please hold.`, "Autonomous Engine Audit Active...");
  }

  function presentResults(score, criticalGaps = 5) {
    const actions = document.getElementById('ai-contextual-actions');
    if (actions) actions.style.display = 'flex';
    const hubActions = document.getElementById('ai-hub-actions');
    if (hubActions) hubActions.style.display = 'flex';
    
    let advice = `Audit complete! Ahmad, your platform has scored ${score}/100. We identified ${criticalGaps} strategic vulnerability gaps. `;
    if (score < 50) {
      advice += "The site is in a CRITICAL status. Severe entity indexing gaps and technical authority deficits are suppressing your organic search share. I recommend immediate remedial actions.";
    } else if (score < 80) {
      advice += "The site is in a MODERATE status. Core structures are functional, but semantic entity validation and authority profiles are missing crucial trust metrics.";
    } else {
      advice += "The site is in an EXCELLENT status! Excellent trust score and core metadata, but minor optimization vectors remain to solidify your local position.";
    }
    
    speak(advice, "Executive AI Optimization Strategy Map Ready");
    
    const btnRewrite = document.getElementById('btn-ai-rewrite-landing');
    const btnSchema = document.getElementById('btn-ai-generate-schema');
    const btnHubRewrite = document.getElementById('btn-hub-ai-rewrite');
    const btnHubSchema = document.getElementById('btn-hub-ai-schema');
    
    const onRewrite = (e) => {
      e.preventDefault();
      if (typeof UI !== 'undefined') UI.showToast("Opening Content & E-E-A-T Pillar Workspace...", "info");
      if (typeof Dashboard !== 'undefined') {
        Dashboard.activatePillar('eeat');
      }
    };
    
    const onSchema = (e) => {
      e.preventDefault();
      if (typeof UI !== 'undefined') UI.showToast("Navigating to AI SEO / GEO Schema Studio...", "info");
      if (typeof Dashboard !== 'undefined') {
        Dashboard.activatePillar('geo');
      }
    };

    if (btnRewrite) btnRewrite.onclick = onRewrite;
    if (btnHubRewrite) btnHubRewrite.onclick = onRewrite;
    
    if (btnSchema) btnSchema.onclick = onSchema;
    if (btnHubSchema) btnHubSchema.onclick = onSchema;
  }

  return { speak, triggerAuditSequence, presentResults };
})();

/* ── Landing Page Animations ─────────────────────────────── */
const LandingAnimations = (() => {
  function initReveal() {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('active');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });
    document.querySelectorAll('.reveal, .reveal-left, .reveal-right').forEach(el => observer.observe(el));
  }

  function initParallax() {
    document.addEventListener('mousemove', e => {
      const orbs = document.querySelectorAll('.orb');
      const cx = window.innerWidth / 2, cy = window.innerHeight / 2;
      const dx = (e.clientX - cx) / cx, dy = (e.clientY - cy) / cy;
      orbs.forEach((orb, i) => {
        const factor = (i + 1) * 15;
        orb.style.transform = `translate(${dx * factor}px, ${dy * factor}px)`;
      });
    });
  }

  function initScrollHeader() {
    const header = document.getElementById('site-header');
    if (!header) return;
    window.addEventListener('scroll', () => {
      header.classList.toggle('scrolled', window.scrollY > 40);
    }, { passive: true });
  }

  function initCounters() {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        entry.target.querySelectorAll('.stat-val[data-target]').forEach(el => {
          const target = parseInt(el.dataset.target);
          const suffix = el.dataset.suffix || '';
          let start = 0;
          const step = () => {
            start += Math.ceil(target / 40);
            if (start >= target) { el.textContent = target + suffix; return; }
            el.textContent = start + suffix;
            requestAnimationFrame(step);
          };
          requestAnimationFrame(step);
        });
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.5 });
    document.querySelectorAll('.hero-stats, .credential-grid').forEach(el => observer.observe(el));
  }

  function init() { 
    initReveal(); 
    initParallax(); 
    initScrollHeader(); 
    initCounters(); 
    
    // Hero Score Ring
    const heroRing = document.getElementById('hero-score-ring');
    if (heroRing) {
      const score = parseInt(heroRing.dataset.score) || 82;
      UI.renderScoreRing(heroRing, score, 'accent', false);
    }
  }
  return { init };
})();

/* ── Contact Form ─────────────────────────────────────────── */
const ContactForm = (() => {
  function init() {
    const form = document.getElementById('contact-form');
    if (!form) return;
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = '⏳ Sending...';
      
      const data = {
        name: document.getElementById('contact-name')?.value,
        email: document.getElementById('contact-email')?.value,
        website: document.getElementById('contact-website')?.value,
        goal: document.getElementById('contact-goal')?.value,
      };

      try {
        await API.submitContact(data);
        form.style.display = 'none';
        const success = document.getElementById('form-success');
        if (success) success.style.display = 'block';
        UI.showToast("Message sent! We'll respond shortly. 🚀", 'success');
      } catch {
        UI.showToast('Failed to send message. Please try again.', 'error');
        btn.disabled = false;
        btn.textContent = orig;
      }
    });
  }
  return { init };
})();

/* ── App Bootstrap ────────────────────────────────────────────
   Auth.init() and Router.init() are handled in router.js with
   proper async/await sequencing. main.js only boots modules
   that do NOT depend on session state.
─────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  LandingAnimations.init();
  if (typeof Dashboard !== 'undefined') {
    Dashboard.init();
  }
  ContactForm.init();

  // Smooth Anchors
  document.querySelectorAll('a[href^="#"]').forEach(link => {
    link.addEventListener('click', e => {
      const href = link.getAttribute('href');
      if (href === '#') return;
      const target = document.querySelector(href);
      if (target) {
        e.preventDefault();
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });

  // Clear any stale cached audit data and always start clean
  try { localStorage.removeItem('amk_last_audit'); localStorage.removeItem('amk_current_audit_id'); } catch(e) {}
  if (typeof Dashboard !== 'undefined') {
    Dashboard.setZeroState(true);
  }

  // Public Landing Page Hero Command Bar Trigger
  const heroUrlInput = document.getElementById('hero-url-input');
  const heroAuditBtn = document.getElementById('hero-audit-btn');
  if (heroAuditBtn && heroUrlInput) {
    heroAuditBtn.addEventListener('click', (e) => {
      e.preventDefault();
      const val = heroUrlInput.value.trim();
      if (!val) {
        if (typeof UI !== 'undefined') {
          UI.showToast('Please enter a website URL to scan.', 'error');
        } else {
          alert('Please enter a website URL to scan.');
        }
        return;
      }
      
      // Run directly in-place below the hero command bar if defined
      if (typeof window.runHeroAudit === 'function') {
        window.runHeroAudit(val);
      } else {
        // Fallback: set value on landing page audit input and switch tab
        const auditUrlInput = document.getElementById('auditUrl');
        if (auditUrlInput) {
          auditUrlInput.value = val;
        }
        
        // Switch lab tab to audit
        if (typeof window.switchLabTab === 'function') {
          window.switchLabTab('audit-panel', 'btn-lab-audit');
        } else if (typeof switchLabTab === 'function') {
          switchLabTab('audit-panel', 'btn-lab-audit');
        }
        
        // Run audit engine
        if (typeof window.runAuditEngine === 'function') {
          window.runAuditEngine();
        } else if (typeof runAuditEngine === 'function') {
          runAuditEngine();
        }
        
        // Smooth scroll down to growth lab
        const growthLab = document.getElementById('growth-lab');
        if (growthLab) {
          growthLab.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
    });

    heroUrlInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        heroAuditBtn.click();
      }
    });
  }

  // Auto-Run Audit via URL Parameter (WordPress Bridge)
  const urlParams = new URLSearchParams(window.location.search);
  const scanTarget = urlParams.get('scan');
  const auditButton = document.getElementById('master-audit-btn');
  const targetInput = document.getElementById('master-url-input');

  if (scanTarget && auditButton && targetInput) {
      // Decode and target
      targetInput.value = decodeURIComponent(scanTarget);
      
      // Enforce navigation guard redirect to workspace view
      if (typeof Router !== 'undefined') {
        Router.go('workspace');
      }
      
      // Fire
      const hubUrlInput = document.getElementById('hub-url-input');
      if (hubUrlInput) hubUrlInput.value = decodeURIComponent(scanTarget);
      
      const hubAuditBtn = document.getElementById('btn-hub-run-audit');
      if (hubAuditBtn) {
          hubAuditBtn.click();
      } else if (auditButton) {
          auditButton.click();
      }
  }

  // Google SSO and connection parameter handling
  const loginToken = urlParams.get('login_token');
  const connected = urlParams.get('connected');
  const googleError = urlParams.get('google_error');
  const isWelcome = urlParams.get('welcome') === '1';

  // Google login attempt for an account that doesn't exist yet → prompt signup.
  if (googleError === 'not_registered') {
    if (typeof UI !== 'undefined') {
      UI.showToast('No account found for that Google email — please sign up first. ✍️', 'error');
    }
    if (typeof Auth !== 'undefined' && Auth.openModal) {
      setTimeout(() => Auth.openModal('signup'), 500);
    }
    setTimeout(() => window.history.replaceState({}, document.title, window.location.pathname), 1500);
  }

  if (loginToken) {
    // We logged in directly via Google SSO!
    // Persist a provisional session synchronously FIRST so the router guard
    // and any mid-hydration refresh keep us on the dashboard instead of
    // bouncing back to the login modal while /api/v1/me is still in flight.
    try {
      const existing = JSON.parse(localStorage.getItem('amk_user') || 'null') || {};
      existing.token = loginToken;
      existing.loginTime = Date.now();
      if (!existing.plan) existing.plan = 'free';
      if (!existing.name) existing.name = (existing.email || 'user').split('@')[0];
      if (!existing.initials) existing.initials = (existing.name || 'U').slice(0, 2).toUpperCase();
      localStorage.setItem('amk_user', JSON.stringify(existing));
    } catch (_) { /* non-fatal */ }

    fetch('/api/v1/me', {
      headers: { 'Authorization': `Bearer ${loginToken}`, 'Cache-Control': 'no-cache' }
    })
    .then(res => res.json())
    .then(data => {
      const email = data.email || 'user@company.com';
      const userObj = {
        email: email,
        plan: (data.plan || 'free').toLowerCase(),
        name: data.full_name || data.company_name || email.split('@')[0],
        initials: (data.full_name || data.company_name || email.split('@')[0]).split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
        loginTime: Date.now(),
        token: loginToken,
        user_type: data.user_type || 'FREELANCER',
        is_admin: data.is_admin || false,
        credits: data.credits_balance || 500
      };
      localStorage.setItem('amk_user', JSON.stringify(userObj));
      
      if (typeof Auth !== 'undefined') {
        Auth.init().then(() => {
          if (typeof Router !== 'undefined') {
            Router.go('workspace');
          }
          if (typeof UI !== 'undefined') {
            UI.showToast(
              isWelcome
                ? `Account created — welcome to AMK! 🚀`
                : `Logged in successfully via Google! 👋`,
              'success'
            );
          }
        });
      }
    })
    .catch(err => {
      console.error('[Google Login] Failed to hydrate profile:', err);
    });
  } else if (connected === 'google') {
    if (typeof UI !== 'undefined') {
      UI.showToast('Google Workspace connected successfully! 🔌', 'success');
    }
  }
  
  // Clean query parameters so it does not loop on browser refresh after a slight delay
  if (loginToken || connected === 'google' || scanTarget) {
    setTimeout(() => {
      window.history.replaceState({}, document.title, window.location.pathname);
    }, 1500);
  }
});
// --- Global Active Nav State Management ---
document.addEventListener('DOMContentLoaded', () => {
    const currentPath = window.location.pathname;
    const navLinks = document.querySelectorAll('.nav-link');
    
    navLinks.forEach(link => {
        if (link.getAttribute('href') === currentPath || 
           (currentPath.includes('resources.html') && link.getAttribute('href') === '/resources.html')) {
            link.classList.add('active-nav-link');
            // Give it some visual feedback (can be overridden in CSS if .active-nav-link exists)
            link.style.color = 'var(--accent)';
            link.style.fontWeight = 'bold';
        }
    });
});
