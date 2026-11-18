/* ============================================================
   KivoReach — SETTINGS.JS
   Modal, BYOK Vault, Plan Management, Integrations

   Theme logic has been extracted to /js/theme-engine.js.
   This file calls window.AMKTheme.set() / .bindAll() as the
   single source of truth. No inline CSS variable overrides.
   ============================================================ */

const Settings = (() => {

  /* ── Modal & Tabs ──────────────────────────────────────────── */
  function openModal() {
    const modal = document.getElementById('settings-view');
    if (!modal) return;
    // Sync all plan display elements from the live session before showing
    if (typeof Auth !== 'undefined') Auth.updateUI();
    loadKeys();
    syncWhiteLabelGate();
    syncIntegrations();
    modal.style.display = 'flex';
  }

  function syncWhiteLabelGate() {
    const userRaw = localStorage.getItem('amk_user');
    const user = userRaw ? JSON.parse(userRaw) : null;
    const plan = (user ? user.plan : 'free').toLowerCase();
    
    const inputName = document.getElementById('report-agency-name');
    const colorPicker = document.getElementById('report-brand-color-picker');
    const colorHex = document.getElementById('report-brand-color-hex');
    const btnCompile = document.getElementById('btn-compile-pdf');
    const warning = document.getElementById('whitelabel-gate-warning');
    
    // Check if user is admin
    const email = (user && user.email ? user.email : '').toLowerCase();
    const isAdmin = (user && user.is_admin) || email.includes('admin');
    
    const isUltra = plan === 'ultra' || plan === 'enterprise' || isAdmin;
    
    if (isUltra) {
      if (inputName) inputName.removeAttribute('disabled');
      if (colorPicker) colorPicker.removeAttribute('disabled');
      if (colorHex) colorHex.removeAttribute('disabled');
      if (btnCompile) {
        btnCompile.removeAttribute('disabled');
        btnCompile.style.opacity = '1';
        btnCompile.style.cursor = 'pointer';
      }
      
      if (warning) {
        warning.innerHTML = `✅ <span class="font-bold text-emerald-600 dark:text-emerald-400">Ultra Enterprise Access Active</span>. You can customize report branding and compile branded PDFs.`;
        warning.className = "pt-4 border-t border-gray-100 dark:border-white/5 text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-2";
      }
    } else {
      if (inputName) inputName.setAttribute('disabled', 'true');
      if (colorPicker) colorPicker.setAttribute('disabled', 'true');
      if (colorHex) colorHex.setAttribute('disabled', 'true');
      if (btnCompile) {
        btnCompile.style.opacity = '0.6';
      }
      
      if (warning) {
        warning.innerHTML = `ℹ&nbsp; Configure parameters above. Content available exclusively on the <span class="font-bold text-gray-600 dark:text-gray-300">Ultra Enterprise</span> plan.`;
        warning.className = "pt-4 border-t border-gray-100 dark:border-white/5 text-xs text-gray-400 dark:text-gray-500 flex items-center gap-2";
      }
    }
  }

  async function syncIntegrations() {
    try {
      const userRaw = localStorage.getItem('amk_user');
      const user = userRaw ? JSON.parse(userRaw) : null;
      if (!user || !user.token) return;
      
      const res = await fetch('/api/v1/me', {
        headers: { 'Authorization': `Bearer ${user.token}`, 'Cache-Control': 'no-cache' }
      });
      if (!res.ok) return;
      
      const data = await res.json();
      
      // Update local storage user details if they have changed (e.g. tier, admin, credits)
      let needsStorageUpdate = false;
      if (data.plan && data.plan.toLowerCase() !== user.plan) {
        user.plan = data.plan.toLowerCase();
        needsStorageUpdate = true;
      }
      if (data.is_admin !== undefined && data.is_admin !== user.is_admin) {
        user.is_admin = data.is_admin;
        needsStorageUpdate = true;
      }
      if (data.credits_balance !== undefined && data.credits_balance !== user.credits) {
        user.credits = data.credits_balance;
        needsStorageUpdate = true;
      }
      if (needsStorageUpdate) {
        localStorage.setItem('amk_user', JSON.stringify(user));
        if (typeof Auth !== 'undefined') Auth.updateUI();
      }
      
      // Update the Connect Google button UI
      const connectBtn = document.getElementById('btn-connect-google');
      if (connectBtn) {
        if (data.is_google_connected) {
          connectBtn.textContent = '✅ Connected';
          connectBtn.className = 'btn btn-outline btn-success-status';
          connectBtn.style.color = '#10b981';
          connectBtn.style.borderColor = '#10b981';
          connectBtn.setAttribute('disabled', 'true');
          connectBtn.removeAttribute('onclick'); // prevent clicking again
        } else {
          connectBtn.textContent = 'Connect Google Account';
          connectBtn.className = 'btn btn-outline';
          connectBtn.style.color = '';
          connectBtn.style.borderColor = '';
          connectBtn.removeAttribute('disabled');
          // Bind onclick back
          connectBtn.onclick = () => {
            const token = JSON.parse(localStorage.getItem('amk_user') || '{}')?.token || '';
            window.location.href = `/api/v1/auth/google/login?service=analytics&token=${encodeURIComponent(token)}`;
          };
        }
      }

      await syncAnalyticsStatus(user.token);
    } catch(err) {
      console.warn('[Settings] Failed to sync integrations:', err);
    }
  }

  async function syncAnalyticsStatus(token) {
    const card = document.getElementById('ga4-property-card');
    const statusEl = document.getElementById('ga4-property-status');
    if (!card) return;
    try {
      const res = await fetch('/api/v1/analytics/status', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) { card.style.display = 'none'; return; }
      const data = await res.json();

      if (!data.is_connected || !data.has_analytics_scope) {
        card.style.display = 'none';
        return;
      }
      card.style.display = 'flex';

      const propInput = document.getElementById('ga4-property-id');
      const siteInput = document.getElementById('gsc-site-url');
      if (propInput && data.ga4_property_id) propInput.value = data.ga4_property_id;
      if (siteInput && data.gsc_site_url) siteInput.value = data.gsc_site_url;
      if (statusEl) {
        statusEl.textContent = data.ga4_property_id
          ? '✅ Live traffic sources will appear in your next audit export.'
          : 'Analytics access granted — add your GA4 Property ID above to start pulling real traffic sources.';
      }
    } catch (err) {
      console.warn('[Settings] Failed to sync analytics status:', err);
      card.style.display = 'none';
    }
  }

  async function saveAnalyticsProperty() {
    const userRaw = localStorage.getItem('amk_user');
    const user = userRaw ? JSON.parse(userRaw) : null;
    const statusEl = document.getElementById('ga4-property-status');
    if (!user || !user.token) return;

    const ga4_property_id = document.getElementById('ga4-property-id')?.value.trim() || '';
    const gsc_site_url = document.getElementById('gsc-site-url')?.value.trim() || '';

    try {
      const res = await fetch('/api/v1/analytics/property', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${user.token}` },
        body: JSON.stringify({ ga4_property_id, gsc_site_url })
      });
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      if (statusEl) statusEl.textContent = '✅ Saved. Live traffic sources will appear in your next audit export.';
    } catch (err) {
      if (statusEl) statusEl.textContent = `⚠️ Could not save: ${err.message}`;
    }
  }

  function closeModal() {
    const modal = document.getElementById('settings-view');
    if (modal) modal.style.display = 'none';
  }

  async function showPricing(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const btnChangePlan = document.getElementById('btn-show-pricing');
    if (btnChangePlan) btnChangePlan.innerText = "Loading Secure Portal...";
    
    try {
        const userRaw = localStorage.getItem('amk_user');
        const user = userRaw ? JSON.parse(userRaw) : null;
        const token = user ? user.token : '';

        const response = await fetch('/api/v1/billing/portal', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();
        
        if (data.url) {
            window.location.href = data.url; // Redirect to Stripe
        } else {
            throw new Error(data.detail || "No URL returned");
        }
    } catch (error) {
        console.error("Stripe routing failed:", error);
        // Fallback: Open local pricing modal instead of just showing error
        const localModal = document.getElementById('upgrade-modal');
        if (localModal) {
          localModal.style.display = 'flex';
          closeModal(); // Close settings view
        } else {
          UI.showToast("Billing portal routing failed: " + error.message, "error");
        }
        if (btnChangePlan) btnChangePlan.innerText = "Change Plan";
    }
  }

  function showUpgradePromoModal(tier) {
    const overlay = document.getElementById('upgrade-modal-overlay');
    const card = document.getElementById('upgrade-modal-card');
    if (!overlay || !card) return;

    if (!card.dataset.originalHtml) {
      card.dataset.originalHtml = card.innerHTML;
    }

    const tierLabel = (tier || 'pro').toUpperCase();
    
    // Inject the high-conversion discount and trial offer layout
    card.innerHTML = `
      <div class="w-16 h-16 bg-gradient-to-tr from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center mb-6 border border-indigo-400 shadow-lg mx-auto animate-pulse">
          <span class="text-3xl">🎁</span>
      </div>
      
      <div class="text-center space-y-3 mb-8">
          <h3 class="text-2xl font-black text-gray-900 dark:text-white tracking-tight font-heading">Exclusive Offer: Save 20%</h3>
          <p class="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">
            Get 20% off your <strong>${tierLabel}</strong> upgrade using coupon code <span class="px-2 py-1 bg-amber-100 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 rounded font-mono font-bold">AMK20</span>.
          </p>
          <div class="mt-4 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-white/5 text-left text-xs space-y-2">
            <span class="font-bold text-gray-700 dark:text-gray-300">Premium features you'll unlock:</span>
            <div class="flex items-center gap-2"><span>✅</span> <span>Deep SEO and E-E-A-T audits</span></div>
            <div class="flex items-center gap-2"><span>✅</span> <span>White-label PDF/Excel reports</span></div>
            <div class="flex items-center gap-2"><span>✅</span> <span>Full sitemap analysis & competitor insights</span></div>
          </div>
      </div>
      
      <div class="flex flex-col gap-3">
          <button id="btn-promo-trial" class="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-black text-sm rounded-xl shadow-lg shadow-indigo-600/20 transition-all active:scale-95 flex items-center justify-center gap-2">
              ⚡ Start 7-Day Free Trial
          </button>
          <button id="btn-promo-claim" class="w-full py-3 bg-amber-500 hover:bg-amber-600 text-white font-black text-sm rounded-xl transition-colors flex items-center justify-center gap-2">
              🎟️ Apply Code & Contact Sales
          </button>
          <button id="btn-promo-close" class="w-full py-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 font-bold text-sm transition-colors">
              Maybe Later
          </button>
      </div>
    `;

    // Wire up events
    const btnTrial = document.getElementById('btn-promo-trial');
    const btnClaim = document.getElementById('btn-promo-claim');
    const btnClose = document.getElementById('btn-promo-close');

    const closePromoModal = () => {
      overlay.classList.add('opacity-0', 'pointer-events-none');
      card.classList.remove('scale-100');
      card.classList.add('scale-95');
      setTimeout(() => {
        card.innerHTML = card.dataset.originalHtml;
      }, 300);
    };

    if (btnTrial) {
      btnTrial.onclick = (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        const user = Auth.getUser();
        if (user) {
          user.plan = tier;
          user.isTrial = true;
          user.trialExpiry = Date.now() + 7 * 24 * 60 * 60 * 1000;
          localStorage.setItem('amk_user', JSON.stringify(user));
          Auth.updateUI();
          UI.showToast(`🎉 7-day ${tierLabel} Trial activated! Enjoy full access.`, 'success');
        }
        closePromoModal();
      };
    }

    if (btnClaim) {
      btnClaim.onclick = (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        try {
          navigator.clipboard.writeText('AMK20');
          UI.showToast(`📋 Coupon code AMK20 copied! Redirecting...`, 'success');
        } catch (err) {
          UI.showToast(`Use coupon code: AMK20`, 'info');
        }
        setTimeout(() => {
          closePromoModal();
          const contactSection = document.getElementById('contact');
          if (contactSection) {
            contactSection.scrollIntoView({ behavior: 'smooth' });
          } else {
            window.location.href = 'index.html#pricing';
          }
        }, 1500);
      };
    }

    if (btnClose) {
      btnClose.onclick = (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        closePromoModal();
      };
    }

    // Open Modal
    overlay.classList.remove('opacity-0', 'pointer-events-none');
    card.classList.remove('scale-95');
    card.classList.add('scale-100');
  }

  function upgradePlan(tier, e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const LABELS = { free: 'FREE', basic: 'BASIC', pro: 'PRO', ultra: 'ENTERPRISE' };
    
    const user = Auth.getUser();
    if (!user) {
      UI.showToast("Authentication required to upgrade plan.", "error");
      return;
    }

    const email = (user.email || "").toLowerCase();
    const isAdmin = user.is_admin || email.includes("admin");

    if (!isAdmin) {
      // Intercept and show custom promo/trial instead of flat blocking
      showUpgradePromoModal(tier);
      return;
    }

    UI.showToast(`Processing ${LABELS[tier] || tier.toUpperCase()} upgrade...`, 'info');
    setTimeout(() => {
      if (user) {
        user.plan = tier;
        if (user.isTrial) {
          delete user.isTrial;
          delete user.trialExpiry;
        }
        localStorage.setItem('amk_user', JSON.stringify(user));
        // SSOT: Auth.updateUI() syncs ALL plan displays — header, sidebar, settings modal
        Auth.updateUI();
        const upgradeModal = document.getElementById('upgrade-modal');
        if (upgradeModal) upgradeModal.style.display = 'none';
        closeModal();
        UI.showToast(`✅ Plan upgraded to ${LABELS[tier] || tier.toUpperCase()}!`, 'success');
        
        // Instantly unblur and re-populate the dashboard metrics and action plan tables
        const lastAudit = localStorage.getItem('amk_last_audit');
        if (lastAudit && typeof Dashboard !== 'undefined') {
          try {
            Dashboard.populate(JSON.parse(lastAudit));
          } catch(err) {
            console.error("[KivoReach] Failed to repopulate on upgrade:", err);
          }
        }

        // Re-tick the active pillar to re-evaluate tier gates
        const activeTab = document.querySelector('.pillar-item.active');
        if (activeTab) activeTab.click();
      }
    }, 2000);
  }

  function initTabs() {
    document.querySelectorAll('.st-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        document.querySelectorAll('.st-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.st-tab-pane').forEach(p => p.style.display = 'none');
        btn.classList.add('active');
        const target = document.getElementById(btn.dataset.tab);
        if (target) target.style.display = 'block';
        if (btn.dataset.tab === 'st-whitelabel') {
          syncWhiteLabelGate();
        }
      });
    });
  }

  /* ── BYOK Vault ────────────────────────────────────────────── */
  function toggleReveal(id) {
    const input = document.getElementById(id);
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
  }

  function saveKeys() {
    ['openai', 'anthropic', 'google', 'deepseek', 'nvidia', 'psi'].forEach(p => {
      const val = document.getElementById(`key-${p}`)?.value || '';
      localStorage.setItem(`amk_key_${p}`, val);
    });
    UI.showToast('API Keys securely saved to local storage.', 'success');
  }

  function loadKeys() {
    ['openai', 'anthropic', 'google', 'deepseek', 'nvidia', 'psi'].forEach(p => {
      const val = localStorage.getItem(`amk_key_${p}`) || '';
      const input = document.getElementById(`key-${p}`);
      if (input) input.value = val;
    });
  }

  function getKeys() {
    return {
      openai:    localStorage.getItem('amk_key_openai')    || '',
      anthropic: localStorage.getItem('amk_key_anthropic') || '',
      google:    localStorage.getItem('amk_key_google')    || '',
      deepseek:  localStorage.getItem('amk_key_deepseek')  || '',
      nvidia:    localStorage.getItem('amk_key_nvidia')    || '',
      psi:       localStorage.getItem('amk_key_psi')       || '',
    };
  }

  /* ── Integrations & BYOK ──────────────────────────────────── */
  async function saveByokKey(provider) {
    const input = document.getElementById(`key-${provider}`);
    if (!input || !input.value) {
        UI.showToast(`Please enter a valid ${provider.toUpperCase()} key.`, 'error');
        return;
    }
    const btn = document.querySelector(`.btn-save-key[data-target="${provider}"]`);
    if (btn) btn.innerText = "Saving...";

    try {
        const userRaw = localStorage.getItem('amk_user');
        const user = userRaw ? JSON.parse(userRaw) : null;
        const token = user ? user.token : '';

        const res = await fetch('/api/v1/vault/save-key', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify({ provider, key: input.value })
        });
        const data = await res.json();
        if (data.status === 'success') {
            UI.showToast(data.message || 'Key saved securely.', 'success');
            if (btn) btn.innerText = "Saved ✓";
        } else {
            throw new Error(data.detail || 'Failed to save key');
        }
    } catch (err) {
        UI.showToast(`Error saving key: ${err.message}`, 'error');
        if (btn) btn.innerText = "Save Key";
    }
  }

  function mockOAuth(provider) {
    const btn = document.getElementById(`btn-oauth-${provider}`);
    if (!btn) return;
    const userRaw = localStorage.getItem('amk_user');
    const user = userRaw ? JSON.parse(userRaw) : null;
    const email = (user && user.email) || 'user@example.com';
    if (btn.textContent === 'Connect Account') {
      btn.textContent = '⏳ Connecting...';
      setTimeout(() => {
        btn.textContent = 'Disconnect';
        btn.style.cssText = 'color:#fff; background:#10b981; border:1px solid #10b981;';
        const badge = document.createElement('div');
        badge.className = 'connected-badge';
        badge.innerHTML = `<span style="color:#10b981;font-weight:700;font-size:13px;">✓ Connected</span><br><span style="font-size:11px;color:var(--text-muted);">${email}</span>`;
        badge.style.marginTop = '12px';
        btn.parentElement.insertBefore(badge, btn);
      }, 1500);
    } else {
      btn.textContent = 'Connect Account';
      btn.style.cssText = 'border:1px solid var(--border);';
      btn.style.color = '';
      btn.style.background = '';
      btn.parentElement.querySelector('.connected-badge')?.remove();
    }
  }

  /* ── Theme (delegates fully to AMKTheme) ───────────────────── */
  /**
   * Legacy shim: settings.js used to own applyTheme().
   * Now it simply delegates to the global AMKTheme engine.
   * Called from Preferences tab buttons in settings modal.
   */
  function applyTheme(theme) {
    if (window.AMKTheme) {
      window.AMKTheme.set(theme);
    }
  }

  /* ── Init ──────────────────────────────────────────────────── */
  function init() {
    const bind = (id, fn) => {
      document.getElementById(id)?.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation(); fn(e);
      });
    };

    bind('workspace-logo',    () => Router.go('landing'));
    bind('header-logo',       () => Router.go('landing'));
    bind('link-open-settings',() => openModal());
    bind('link-open-billing', () => window.location.href = 'billing.html');
    bind('btn-show-pricing',  (e) => showPricing(e));
    bind('btn-upgrade-basic', (e) => upgradePlan('basic', e));
    bind('btn-upgrade-pro',   (e) => upgradePlan('pro',   e));
    bind('btn-upgrade-ultra', (e) => upgradePlan('ultra', e));

    document.querySelectorAll('.btn-save-key').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const provider = btn.getAttribute('data-target');
            if (provider) saveByokKey(provider);
        });
    });

    // ── Profile Dropdown ─────────────────────────────────────
    const profileTrigger = document.getElementById('profile-menu-trigger');
    const profileMenu    = document.getElementById('profile-dropdown-menu');
    if (profileTrigger && profileMenu) {
      profileTrigger.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        profileMenu.classList.toggle('hidden');
      });
      document.addEventListener('click', () => profileMenu.classList.add('hidden'));
    }

    // ── Export Dropdown ──────────────────────────────────────
    const exportToggle = document.getElementById('export-audit-toggle');
    const exportMenu   = document.getElementById('export-menu');
    if (exportToggle && exportMenu) {
      exportToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = exportMenu.style.display === 'flex';
        exportMenu.style.display = isOpen ? 'none' : 'flex';
      });
      document.addEventListener('click', () => {
        if (exportMenu) exportMenu.style.display = 'none';
      });
    }

    // ── Logout (delegate to Auth.logout which is nuclear) ────
    const logoutBtn = document.getElementById('btn-dashboard-logout');
    if (logoutBtn && !logoutBtn._settingsBound) {
      logoutBtn.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (typeof Auth !== 'undefined') Auth.logout(e);
      });
      logoutBtn._settingsBound = true;
    }

    // ── Theme toggle (checkbox in dropdown) ──────────────────
    // Delegated to AMKTheme.bindAll() — called here to guarantee
    // it runs after the DOM is fully ready.
    if (window.AMKTheme) {
      window.AMKTheme.bindAll();
    }

    // ── API Vault Form BYOK Submission ───────────────────────
    const apiVaultForm = document.getElementById('api-vault-form');
    if (apiVaultForm) {
      apiVaultForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const provider = document.getElementById('api-provider')?.value;
        const key = document.getElementById('api-key-vault')?.value;
        
        if (!provider || !key) {
          UI.showToast('Please select a provider and enter your secret key.', 'error');
          return;
        }
        
        const submitBtn = apiVaultForm.querySelector('button[type="submit"]');
        const originalText = submitBtn ? submitBtn.innerHTML : '';
        if (submitBtn) { submitBtn.innerHTML = '⏳ Securing Credentials...'; submitBtn.disabled = true; }
        
        try {
          const userRaw = localStorage.getItem('amk_user');
          const user = userRaw ? JSON.parse(userRaw) : null;
          const token = user ? user.token : '';
          
          const res = await fetch('/api/v1/vault/save-key', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ provider, key })
          });
          const data = await res.json();
          
          if (data.status === 'success') {
            UI.showToast(data.message || 'API Credentials successfully secured in database vault!', 'success');
            document.getElementById('api-key-vault').value = '';
          } else {
            throw new Error(data.detail || 'Failed to save credential');
          }
        } catch (err) {
          UI.showToast(`Vault Error: ${err.message}`, 'error');
        } finally {
          if (submitBtn) { submitBtn.innerHTML = originalText; submitBtn.disabled = false; }
        }
      });
    }

    // ── White-Label Customization Sync ───────────────────────
    const colorPicker = document.getElementById('report-brand-color-picker');
    const colorHex = document.getElementById('report-brand-color-hex');
    if (colorPicker && colorHex) {
      colorPicker.addEventListener('input', (e) => {
        colorHex.value = e.target.value.toUpperCase();
      });
      colorHex.addEventListener('input', (e) => {
        let val = e.target.value.trim();
        if (val.length === 7 && val.startsWith('#')) {
          colorPicker.value = val;
        } else if (val.length === 6 && !val.startsWith('#')) {
          colorPicker.value = '#' + val;
        }
      });
    }

    // ── White-Label PDF Compilation Request ──────────────────
    const btnCompilePdf = document.getElementById('btn-compile-pdf');
    if (btnCompilePdf) {
      btnCompilePdf.addEventListener('click', async (e) => {
        e.preventDefault();
        
        const userRawCheck = localStorage.getItem('amk_user');
        const userCheck = userRawCheck ? JSON.parse(userRawCheck) : null;
        const planCheck = (userCheck ? userCheck.plan : 'free').toLowerCase();
        const emailCheck = (userCheck && userCheck.email ? userCheck.email : '').toLowerCase();
        const isAdminCheck = (userCheck && userCheck.is_admin) || emailCheck.includes('admin');
        
        const isUltraCheck = planCheck === 'ultra' || planCheck === 'enterprise' || isAdminCheck;
        if (!isUltraCheck) {
          UI.showToast("White-label PDF compilation is restricted to the Agency/Enterprise plan.", "warning");
          showUpgradePromoModal('ultra');
          return;
        }
        
        const agencyName = document.getElementById('report-agency-name')?.value || '';
        const primaryHex = document.getElementById('report-brand-color-hex')?.value || '#4F46E5';
        const urlInput = document.getElementById('master-url-input')?.value || document.getElementById('hub-url-input')?.value || '';
        
        let targetDomain = urlInput.trim();
        if (!targetDomain) {
          const lastAuditRaw = localStorage.getItem('amk_last_audit');
          if (lastAuditRaw) {
            try {
              const lastAudit = JSON.parse(lastAuditRaw);
              targetDomain = lastAudit.url || lastAudit.domain || (lastAudit.company_profile && lastAudit.company_profile.domain) || (lastAudit.crawled_urls && lastAudit.crawled_urls[0]) || '';
            } catch(e) {}
          }
        }
        
        if (!targetDomain) {
          UI.showToast("Please enter a domain or run an audit first to compile the report.", "warning");
          return;
        }
        
        const originalText = btnCompilePdf.innerHTML;
        btnCompilePdf.innerHTML = '⏳ Compiling Corporate PDF...';
        btnCompilePdf.disabled = true;
        
        try {
          const userRaw = localStorage.getItem('amk_user');
          const user = userRaw ? JSON.parse(userRaw) : null;
          const token = user ? user.token : '';
          
          UI.showToast("🚀 Initiating Reports Compiler Engine...", "info");
          
          const response = await fetch('/api/v1/export-pdf', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              domain: targetDomain,
              agency_name: agencyName,
              primary_hex_color: primaryHex
            })
          });
          
          if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.detail || "Server compilation error");
          }
          
          const blob = await response.blob();
          const downloadUrl = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = downloadUrl;
          
          const cleanName = agencyName ? agencyName.replace(/\s+/g, '_') : 'AMK_Digital_Agency';
          link.setAttribute('download', `${cleanName}_Audit_${targetDomain.replace(/\./g, '_')}.pdf`);
          document.body.appendChild(link);
          link.click();
          link.parentNode.removeChild(link);
          window.URL.revokeObjectURL(downloadUrl);
          
          UI.showToast("✅ Branded PDF compiled and downloaded successfully!", "success");
        } catch (err) {
          console.error("PDF Compile Error:", err);
          UI.showToast(`Compilation Failed: ${err.message}`, "error");
        } finally {
          btnCompilePdf.innerHTML = originalText;
          btnCompilePdf.disabled = false;
        }
      });
    }

    initTabs();
    loadKeys();
  }

  // Dynamic Global Export Router
  window.exportAudit = async function(format) {
    const userRaw = localStorage.getItem('amk_user');
    const user = userRaw ? JSON.parse(userRaw) : null;
    const plan = (user ? user.plan : 'free').toUpperCase();

    if (format === 'pdf') {
      if (plan === 'ULTRA') {
        UI.showToast("💡 Ultra Account: Opening corporate customization console...", "info");
        openModal();
        document.querySelectorAll('.st-tab-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.st-tab-pane').forEach(p => p.style.display = 'none');

        const wlBtn = document.getElementById('tab-btn-whitelabel');
        const wlPane = document.getElementById('st-whitelabel');
        if (wlBtn) wlBtn.classList.add('active');
        if (wlPane) wlPane.style.display = 'block';
      } else {
        // Resolve target domain: prefer the URL input, fall back to last audit cache
        const urlInput = document.getElementById('master-url-input')?.value || document.getElementById('hub-url-input')?.value || '';
        let targetDomain = urlInput.trim();
        if (!targetDomain) {
          const lastAuditRaw = localStorage.getItem('amk_last_audit');
          if (lastAuditRaw) {
            try {
              const lastAudit = JSON.parse(lastAuditRaw);
              targetDomain = lastAudit.url || '';
            } catch (e) { /* corrupt cache — ignore */ }
          }
        }
        if (!targetDomain) {
          UI.showToast("Please enter a domain or run an audit first to export a PDF.", "info");
          return;
        }

        UI.showToast("⏳ Compiling standard AMK audit report PDF...", "info");
        try {
          const token = user ? user.token : '';
          const response = await fetch('/api/v1/export-pdf', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
              domain: targetDomain,
              agency_name: "KivoReach",
              primary_hex_color: "#4F46E5"
            })
          });

          if (!response.ok) {
            // Try to extract a meaningful server error message
            let errDetail = `Server error ${response.status}`;
            try {
              const errData = await response.json();
              errDetail = errData.detail || errData.message || errDetail;
            } catch (_) { /* response was not JSON */ }
            throw new Error(errDetail);
          }

          const blob = await response.blob();
          const downloadUrl = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = downloadUrl;
          link.setAttribute('download', `AMK_Digital_Agency_Audit_${targetDomain.replace(/\./g, '_')}.pdf`);
          document.body.appendChild(link);
          link.click();
          link.parentNode.removeChild(link);
          window.URL.revokeObjectURL(downloadUrl);
          UI.showToast("✅ Standard audit PDF downloaded successfully!", "success");
        } catch(err) {
          UI.showToast(`Standard PDF failed: ${err.message}`, "error");
        }
      }
    } else {
      // Excel, CSV, Word formats
      const lastAuditRaw = localStorage.getItem('amk_last_audit');
      if (!lastAuditRaw) {
        UI.showToast("Please run an audit first before exporting report.", "warning");
        return;
      }
      let lastAudit;
      try {
        lastAudit = JSON.parse(lastAuditRaw);
      } catch(e) {
        UI.showToast("Audit data cache is stale.", "error");
        return;
      }

      const urlInput = document.getElementById('master-url-input')?.value || document.getElementById('hub-url-input')?.value || '';
      let domain = urlInput.trim();
      if (!domain && lastAudit.company_profile) {
        domain = lastAudit.company_profile.domain;
      }
      if (!domain) {
        domain = "audit_report";
      }

      UI.showToast(`⏳ Compiling dynamic ${format.toUpperCase()} report...`, "info");
      try {
        const token = user ? user.token : '';
        const response = await fetch(`/api/export?format=${format}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            domain: domain,
            reports: lastAudit.reports || {}
          })
        });

        if (!response.ok) {
          let errDetail = `Server error ${response.status}`;
          try {
            const errData = await response.json();
            errDetail = errData.detail || errData.message || errDetail;
          } catch (_) {}
          throw new Error(errDetail);
        }

        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = downloadUrl;
        
        let ext = 'xlsx';
        if (format === 'csv') ext = 'zip';
        if (format === 'word') ext = 'docx';
        
        link.setAttribute('download', `AMK_Audit_${domain.replace(/\./g, '_')}.${ext}`);
        document.body.appendChild(link);
        link.click();
        link.parentNode.removeChild(link);
        window.URL.revokeObjectURL(downloadUrl);
        UI.showToast(`✅ ${format.toUpperCase()} report downloaded successfully!`, "success");
      } catch (err) {
        console.error(`Export Error (${format}):`, err);
        UI.showToast(`Export Failed: ${err.message}`, "error");
      }
    }
  };

  // Auto-init once DOM is painted
  window.addEventListener('DOMContentLoaded', init);

  return {
    openModal, closeModal,
    showPricing, upgradePlan, showUpgradePromoModal,
    toggleReveal, saveKeys, getKeys,
    mockOAuth, applyTheme,
    syncWhiteLabelGate,
    saveAnalyticsProperty,
  };
})();
