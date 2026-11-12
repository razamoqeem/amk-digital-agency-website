const Tables = (() => {

  // ── Core Renderer ─────────────────────────────────────────
  function renderTable(containerId, dataArray) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!dataArray || dataArray.length === 0) {
      container.innerHTML = `
        <div class="empty-state-card">
          <div style="font-size:24px; margin-bottom:8px; opacity:0.5;">📭</div>
          <h4 style="margin:0 0 4px; color:var(--text);">No evidence gathered</h4>
          <p style="margin:0;">Run a deep domain audit to populate this forensic table.</p>
        </div>`;
      return;
    }

    const user = (typeof Auth !== 'undefined') ? Auth.getUser() : null;
    const rawPlan = user ? (user.plan || user.subscription_tier || 'free') : 'free';
    const plan = rawPlan.toUpperCase().replace('_', ''); // normalize 'FREE', 'FREE_TRIAL', 'BASIC', 'PRO', 'ULTRA'

    // Determine how many rows they are allowed to see based on their tier
    let allowedRows = 3; // FREE_TRIAL or anonymous default
    if (plan === 'BASIC') allowedRows = 10;
    if (plan === 'PRO') allowedRows = 50;
    if (plan === 'ULTRA') allowedRows = 9999; // Unlimited

    const headers = Object.keys(dataArray[0]);

    let html = `<div class="table-scroll-wrapper">
      <table class="data-table">
        <thead>
          <tr>`;

    headers.forEach(h => {
      if (h.includes('List')) return;
      html += `<th>${h}</th>`;
    });
    
    if (containerId === 'table-off-page') {
      html += `<th>Action</th>`;
    }
    
    html += `</tr></thead><tbody>`;

    const tableBody = dataArray.map((row, i) => {
      const isLockedRow = i >= allowedRows;
      let rowHtml = `<tr class="${isLockedRow ? 'table-row-blurred filter blur-sm opacity-40 select-none pointer-events-none' : ''}">`;
      
      headers.forEach(h => {
        if (h.includes('List')) return;
        
        const val = row[h] !== undefined ? row[h] : 'Not Found';
        const strVal = String(val);
        const isError = strVal.includes('MISSING') || strVal.includes('❌') || strVal === 'Not Found';
        const isWarn  = strVal.includes('⚠️') || strVal.includes('Too Short');
        const isOk    = strVal.includes('✅') || strVal === 'Yes' || strVal.includes('Optimal');

        let cellClass = '';
        if (isError)  cellClass = 'text-error';
        else if (isWarn)  cellClass = 'text-warn';
        else if (isOk)    cellClass = 'text-success';

        rowHtml += `<td class="${cellClass}" title="${strVal.replace(/"/g,"'")}">${strVal.length > 80 ? strVal.substring(0, 80) + '…' : strVal}</td>`;
      });
      
      if (containerId === 'table-off-page') {
        const dataId = `links-data-${i}`;
        if (!window._linkDataVault) window._linkDataVault = {};
        window._linkDataVault[dataId] = { 
            url: row['URL'], 
            internal: row['Internal Link List'] || [], 
            external: row['External Link List'] || [],
            inbound_internal: row['Inbound Link List'] || [],
            inbound_external: row['External Inbound Link List'] || []
        };
        // Disable "View All" details button on locked rows to force upgrade
        if (isLockedRow) {
          rowHtml += `<td><button class="btn btn-ghost btn-sm" disabled style="opacity:0.5; cursor:not-allowed;">Locked 🔒</button></td>`;
        } else {
          rowHtml += `<td><button class="btn btn-ghost btn-sm" onclick="Tables.showLinksModal('${dataId}')">View All ›</button></td>`;
        }
      }
      return rowHtml + `</tr>`;
    }).join('');

    html += tableBody + `</tbody></table></div>`;
    container.innerHTML = html;

    // Toggle Freemium Lock Overlay display state
    const lockOverlay = document.getElementById('freemium-lock-overlay');
    if (lockOverlay) {
      const hasLockedRows = dataArray.length > allowedRows;
      if (hasLockedRows && containerId === 'table-on-page') {
        lockOverlay.style.display = 'flex';
        lockOverlay.classList.remove('hidden');
        
        // Dynamically change the button text based on their current tier
        const upgradeBtn = lockOverlay.querySelector('.btn-primary') || lockOverlay.querySelector('button');
        if (upgradeBtn) {
            if (plan === 'FREE' || plan === 'FREETRIAL') upgradeBtn.innerText = "Upgrade to Basic";
            else if (plan === 'BASIC') upgradeBtn.innerText = "Upgrade to Pro";
            else if (plan === 'PRO') upgradeBtn.innerText = "Unlock Ultra Plan";
        }
      } else if (containerId === 'table-on-page') {
        lockOverlay.style.display = 'none';
        lockOverlay.classList.add('hidden');
      }
    }
  }

  // ── Locked Report Card ─────────────────────────────────────
  function renderLocked(containerId, title) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = `
      <div class="glass-card" style="padding:32px; text-align:center;">
        <div style="font-size:28px; margin-bottom:8px;">🔒</div>
        <h4 style="color:var(--text-muted); margin:0 0 8px;">Tier Locked — ${title}</h4>
        <p style="font-size:13px; color:var(--text-muted); margin:0 0 16px;">Upgrade your plan to unlock this forensic evidence data.</p>
        <button class="btn btn-primary btn-sm" onclick="Settings.openModal()">View Plans ›</button>
      </div>`;
  }

  // ── renderAll — maps 10 backend schemas → HTML containers ─
  function renderAll(reportsObj, aiData) {
    if (!reportsObj) return;

    const mapping = {
      'audit_history':        'table-audit-history',
      'on_page_seo':          'table-on-page',
      'heading_structure':    'table-heading-structure',
      'technical_seo':        'table-technical',
      'off_page_seo':         'table-off-page',
      'backlinks_overview':   'table-backlinks-overview',
      'authority_score':      'table-authority-score',
      'image_seo':            'table-image',
      'eeat_signals':         'table-eeat',
      'local_seo':            'table-local',
      'ethical_benchmarks':   'table-analytics',
      'traffic_overview':     'table-traffic-overview',
      'website_value':        'table-website-value',
      'keyword_intelligence': 'table-content',
      'leads_contacts':       'table-leads',
      'performance':          'table-performance',
      'ai_forensics':         'table-ai',
      'ai_recommendations':   'table-ai-recommendations',
    };

    for (const [reportId, containerId] of Object.entries(mapping)) {
      const report = reportsObj[reportId];
      if (!report) continue;

      if (report.locked) {
        renderLocked(containerId, report.title || reportId);
      } else {
        renderTable(containerId, report.data);
      }
    }

    // Phase 2: AI Forensics Status Update
    updateAIForensicsStatus(aiData);
  }

  function updateAIForensicsStatus(aeoData) {
    const aiPill = document.getElementById('ai-forensics-status-pill');
    if (!aiPill) return;

    // Reset classes
    aiPill.className = 'status-pill';

    // Evaluate the AI payload
    const isReady = aeoData && (
        aeoData.llms_txt_present || 
        aeoData.has_concise_summary || 
        aeoData.llm_readiness === 'Optimal' || 
        aeoData.llm_readiness === '✅ Ready'
    );

    const isGap = aeoData && (
        aeoData.llms_txt_present === false || 
        aeoData.llm_readiness === 'Missing' || 
        aeoData.llm_readiness === '❌ Critical'
    );

    if (isReady) {
        aiPill.classList.add('pill-success');
        aiPill.innerHTML = `✅ AI READY (llms.txt Active)`;
    } else if (isGap) {
        aiPill.classList.add('pill-fail');
        aiPill.innerHTML = `❌ AEO GAP DETECTED`;
    } else {
        aiPill.classList.add('pill-analyzing');
        aiPill.innerHTML = `⏳ ANALYZING NLP ENTITIES`;
    }
  }

  function showLinksModal(dataId) {
    const vault = window._linkDataVault || {};
    const data = vault[dataId];
    if (!data) return;

    const titleEl = document.getElementById('links-modal-title');
    const urlEl   = document.getElementById('links-modal-url');
    const body    = document.getElementById('links-modal-body');
    const modal   = document.getElementById('links-modal');

    // Graceful fallback: modal elements may be absent if export files were deleted
    if (!modal || !body) {
      console.warn('[Tables] links-modal elements not found in DOM — skipping showLinksModal.');
      return;
    }

    if (titleEl) titleEl.textContent = 'Extracted Links';
    if (urlEl)   urlEl.textContent   = data.url || '';

    let html = '';

    const renderLinks = (list, label, badgeClass) => {
      if (!list || list.length === 0) return '';
      let section = `<div style="margin-bottom:24px;"><h5 style="margin-bottom:12px; color:var(--text-muted); font-size:12px; text-transform:uppercase; letter-spacing:0.05em;">${label} (${list.length})</h5>`;
      list.forEach(link => {
        const safeLink = String(link || '');
        section += `<div style="display:flex; align-items:center; gap:10px; margin-bottom:8px; font-size:13px; padding:8px; background:rgba(255,255,255,0.03); border-radius:8px; border:1px solid rgba(255,255,255,0.05);">
          <span class="badge ${badgeClass}" style="font-size:10px; flex-shrink:0;">${label.split(' ')[0]}</span>
          <a href="${safeLink}" target="_blank" rel="noopener noreferrer" style="word-break:break-all; color:var(--text); opacity:0.8; text-decoration:none;">${safeLink}</a>
        </div>`;
      });
      section += `</div>`;
      return section;
    };

    html += renderLinks(data.inbound_internal, 'Inbound Links (Internal)', 'badge-accent');
    html += renderLinks(data.internal, 'Outbound Links (Internal)', 'badge-accent');
    html += renderLinks(data.external, 'Outbound Links (External)', 'badge-teal');
    html += renderLinks(data.inbound_external, 'Inbound Links (External/Backlinks)', 'badge-teal');

    if (html === '') {
      html = '<div class="text-center" style="padding:40px; opacity:0.5;">No links found on this page.</div>';
    }

    body.innerHTML = html;
    modal.style.display = 'flex';
  }

  return { renderTable, renderAll, renderLocked, showLinksModal };
})();
