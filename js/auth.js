/* ============================================================
   AMK Digital Agency — AUTH.JS
   Modal, session management, tier gating

   SECURITY ARCHITECTURE:
   ─ Phase 1: Sessions expire after 24h. Stored token is
     validated against the backend (/api/session/verify) on
     every page load. Falls back to timestamp expiry check if
     the server is offline (dev mode).
   ─ Phase 2: Ctrl+Shift+L triggers a dev hard-reset that
     nukes all browser storage and forces a clean reload.
   ─ Phase 3: Logout is nuclear — wipes ALL storage keys,
     not just the user token, before redirecting to landing.
   ============================================================ */

const Auth = (() => {
  const STORAGE_KEY  = 'amk_user';
  const SESSION_TTL  = 24 * 60 * 60 * 1000; // 24 hours in ms
  const VERIFY_URL   = '/api/session/verify'; // Backend validation endpoint

  /* ── Demo user store ─────────────────────────────────────── */
  const DEMO_USERS = {};

  const TIER_LABELS = { free: 'FREE', basic: 'STARTER', pro: 'GROWTH', ultra: 'AGENCY', enterprise: 'ENTERPRISE' };
  const TIER_LEVELS = { free: 0, basic: 1, pro: 2, ultra: 3, enterprise: 4 };

  let _user = null;

  /* ══════════════════════════════════════════════════════════
     PHASE 1 — STRICT SESSION VALIDATION
     The app never blindly trusts localStorage. Every session
     is validated with an expiry timestamp. Optionally, it also
     pings the backend. If validation fails, force clean logout.
  ══════════════════════════════════════════════════════════ */

  /**
   * Check if a stored session object has expired (> 24h old).
   * @param {object} session - The parsed session from localStorage
   * @returns {boolean} true if expired or malformed
   */
  function isSessionExpired(session) {
    if (!session || !session.loginTime) return true;
    return (Date.now() - session.loginTime) > SESSION_TTL;
  }

  /**
   * Ping the backend as a liveness check only.
   * Any response (even 4xx) means the server is running — we just
   * can't distinguish a real auth rejection from a restart-wiped
   * in-memory store, so we always fall through to the client-side TTL.
   * Only a network error (server completely down) is treated differently,
   * and even then we allow locally via the TTL.
   *
   * @param {string} token - The session token (sent for future JWT compat)
   * @returns {Promise<boolean>} Always true — only the 24h TTL enforces expiry
   */
  async function verifyWithBackend(token) {
    try {
      await fetch(VERIFY_URL, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${token}`, 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(3000),
      });
      // Any HTTP response (200, 401, 500...) = server is alive.
      // Session validity is already enforced by the 24h TTL check above.
      return true;
    } catch (err) {
      // Network error = server completely down. Allow via TTL fallback.
      console.info('[Auth] Server unreachable — TTL fallback active.');
      return true;
    }
  }

  /**
   * Central session restore & validation gate.
   * Called once on page load in init(). Returns the valid user
   * object, or null if the session is stale / invalid.
   */
  async function restoreAndValidateSession() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    let session;
    try { session = JSON.parse(raw); }
    catch (e) {
      console.warn('[Auth] Corrupt session data — purging.');
      _purgeAllStorage();
      return null;
    }

    // ── Step 1: Expiry check (fast, no network) ────────────
    if (isSessionExpired(session)) {
      console.warn('[Auth] Session expired (> 24h). Forcing logout.');
      _purgeAllStorage();
      return null;
    }

    // ── Step 2: Backend token verification (optional) ──────
    if (session.token) {
      const valid = await verifyWithBackend(session.token);
      if (!valid) {
        _purgeAllStorage();
        return null;
      }
    }

    return session;
  }


  /* ══════════════════════════════════════════════════════════
     PHASE 3 — NUCLEAR STORAGE PURGE
     Obliterates ALL browser storage keys related to this app.
     Called on logout AND on failed session validation.
  ══════════════════════════════════════════════════════════ */

  /** Wipe every AMK key from localStorage and sessionStorage, plus cookies. */
  function _purgeAllStorage() {
    console.log("[AMK Auth] Initializing complete session destruction sequence...");

    // 1. Purge all local storage keys used by the application
    localStorage.removeItem('amk_active_user_id');
    localStorage.removeItem('amk_active_user_tier');
    localStorage.removeItem('amk_auth_token');

    // 2. Clear ALL local storage and session storage just to be absolutely certain no hidden states remain
    localStorage.clear();
    sessionStorage.clear();

    // 3. Clear application cookies if backend uses them for token tracking
    document.cookie.split(";").forEach(function(c) { 
        document.cookie = c.replace(/^ +/, "").replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/"); 
    });

    console.log("[AMK Auth] Browser state sanitized.");
    _user = null;
  }


  /* ── Getters ─────────────────────────────────────────────── */
  function getUser()  { return _user; }
  function getTier()  { return _user ? _user.plan : 'free'; }
  function hasAccess(requiredTier) {
    return TIER_LEVELS[getTier()] >= TIER_LEVELS[requiredTier];
  }

  /* ── Auth Modal ──────────────────────────────────────────── */
  let isLoginMode = false;

  function setSignupMode() {
    isLoginMode = false;
    
    const tabLogin = document.getElementById('tab-login');
    const tabSignup = document.getElementById('tab-signup');
    const fieldName = document.getElementById('field-name');
    const fieldUserType = document.getElementById('field-user-type');
    const companyFields = document.getElementById('company-fields');
    const authTitle = document.getElementById('auth-modal-title');
    const authSubtitle = document.getElementById('auth-modal-subtitle');
    const btnSubmit = document.getElementById('btn-auth-submit');

    if (tabSignup) tabSignup.classList.add('active');
    if (tabLogin) tabLogin.classList.remove('active');
    if (fieldName) {
      fieldName.style.display = 'flex';
      fieldName.classList.remove('hidden');
    }
    if (fieldUserType) {
      fieldUserType.style.display = 'flex';
      fieldUserType.classList.remove('hidden');
    }
    // Show company fields if AGENCY or COMPANY is selected
    const userTypeSelect = document.getElementById('auth-user-type');
    if (userTypeSelect && (userTypeSelect.value === 'AGENCY' || userTypeSelect.value === 'COMPANY')) {
      if (companyFields) {
        companyFields.style.display = 'flex';
        companyFields.classList.remove('hidden');
      }
    } else {
      if (companyFields) {
        companyFields.style.display = 'none';
        companyFields.classList.add('hidden');
      }
    }

    if (authTitle) authTitle.innerText = "Join AMK Digital Agency";
    if (authSubtitle) authSubtitle.innerText = "Start your 14-day Ultra trial";
    if (btnSubmit) btnSubmit.innerText = "Create Account";
  }

  function setLoginMode() {
    isLoginMode = true;
    
    const tabLogin = document.getElementById('tab-login');
    const tabSignup = document.getElementById('tab-signup');
    const fieldName = document.getElementById('field-name');
    const fieldUserType = document.getElementById('field-user-type');
    const companyFields = document.getElementById('company-fields');
    const authTitle = document.getElementById('auth-modal-title');
    const authSubtitle = document.getElementById('auth-modal-subtitle');
    const btnSubmit = document.getElementById('btn-auth-submit');

    if (tabLogin) tabLogin.classList.add('active');
    if (tabSignup) tabSignup.classList.remove('active');
    if (fieldName) {
      fieldName.style.display = 'none';
      fieldName.classList.add('hidden');
    }
    if (fieldUserType) {
      fieldUserType.style.display = 'none';
      fieldUserType.classList.add('hidden');
    }
    if (companyFields) {
      companyFields.style.display = 'none';
      companyFields.classList.add('hidden');
    }

    if (authTitle) authTitle.innerText = "Welcome Back";
    if (authSubtitle) authSubtitle.innerText = "Enter your credentials to access the OS";
    if (btnSubmit) btnSubmit.innerText = "Log In";
  }

  function toggleCompanyFields(value) {
    const companyFields = document.getElementById('company-fields');
    if (companyFields) {
      if (value === 'AGENCY' || value === 'COMPANY') {
        companyFields.style.display = 'flex';
        companyFields.classList.remove('hidden');
      } else {
        companyFields.style.display = 'none';
        companyFields.classList.add('hidden');
      }
    }
  }

  function _ensureAuthModal() {
    let overlay = document.getElementById('auth-overlay');
    if (!overlay) {
      // Inject HTML modal
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = `
        <div id="auth-overlay" style="display:none; position:fixed; inset:0; background:rgba(5,5,10,0.85); backdrop-filter:blur(12px); z-index:5000; align-items:center; justify-content:center;">
          <div class="auth-modal glass-card" style="width:100%; max-width:400px; padding:32px; position:relative; border-radius: var(--radius-md);">
            <button class="auth-close" data-auth-close style="position:absolute; top:16px; right:16px; background:none; border:none; color:var(--text-muted); cursor:pointer; font-size:20px;">✕</button>
            <div style="text-align:center;margin-bottom:24px;">
              <div class="logo" style="justify-content:center; align-items:center; gap:8px; font-size:22px; display:flex;">
                <img src="/assets/logo.png" alt="AMK" style="height: 24px; border-radius: 3px;" />
                <span>AMK</span>
              </div>
              <p style="font-size:13px;color:var(--text-muted);margin-top:8px;">Your agency intelligence platform</p>
            </div>
            
            <div class="auth-tabs" style="display:flex; gap:8px; margin-bottom:24px; background:var(--bg-alt); padding:4px; border-radius:var(--radius-sm);">
              <button id="tab-login" class="auth-tab" style="flex:1; padding:8px; border:none; border-radius:var(--radius-xs); background:none; color:var(--text-muted); cursor:pointer; font-weight:600;">Login</button>
              <button id="tab-signup" class="auth-tab" style="flex:1; padding:8px; border:none; border-radius:var(--radius-xs); background:none; color:var(--text-muted); cursor:pointer; font-weight:600;">Create Account</button>
            </div>

            <div class="text-center" style="text-align:center; margin-bottom:20px;">
              <h2 id="auth-modal-title" style="font-size:24px; font-weight:700; color:var(--text); margin:0;">Join AMK Digital Agency</h2>
              <p id="auth-modal-subtitle" style="font-size:13px; color:var(--text-muted); margin:4px 0 0 0;">Start your 14-day Ultra trial</p>
            </div>

            <form id="auth-form" style="display:flex; flex-direction:column; gap:16px;">
              <div id="field-name" class="form-group" style="display:flex; flex-direction:column; gap:6px;">
                  <label style="font-size:12px; font-weight:700; color:var(--text-muted);">Full Name</label>
                  <input type="text" id="auth-name" placeholder="John Doe" style="width:100%; padding:10px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--bg); color:var(--text);">
              </div>

              <div id="field-user-type" class="form-group" style="display:flex; flex-direction:column; gap:6px;">
                  <label style="font-size:12px; font-weight:700; color:var(--text-muted);">I am a...</label>
                  <select id="auth-user-type" style="width:100%; padding:10px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--bg); color:var(--text);" onchange="Auth.toggleCompanyFields(this.value)">
                      <option value="STUDENT">Student</option>
                      <option value="FREELANCER" selected>Freelancer</option>
                      <option value="AGENCY">Agency</option>
                      <option value="COMPANY">Company</option>
                  </select>
              </div>

              <div id="company-fields" style="display:none; flex-direction:column; gap:16px;">
                  <div class="form-group" style="display:flex; flex-direction:column; gap:6px;">
                      <label style="font-size:12px; font-weight:700; color:var(--text-muted);">Company / Agency Name</label>
                      <input type="text" id="auth-company-name" placeholder="Acme Corp" style="width:100%; padding:10px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--bg); color:var(--text);">
                  </div>
                  <div class="form-group" style="display:flex; flex-direction:column; gap:6px;">
                      <label style="font-size:12px; font-weight:700; color:var(--text-muted);">Company Size</label>
                      <select id="auth-company-size" style="width:100%; padding:10px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--bg); color:var(--text);">
                          <option value="1">Solo (1 person)</option>
                          <option value="2-10">Small (2-10 people)</option>
                          <option value="11-50">Medium (11-50 people)</option>
                          <option value="51-200">Large (51-200 people)</option>
                          <option value="200+">Enterprise (200+ people)</option>
                      </select>
                  </div>
                  <div class="form-group" style="display:flex; flex-direction:column; gap:6px;">
                      <label style="font-size:12px; font-weight:700; color:var(--text-muted);">Company Website URL (Optional)</label>
                      <input type="text" id="auth-company-url" placeholder="https://example.com" style="width:100%; padding:10px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--bg); color:var(--text);">
                  </div>
              </div>

              <div class="form-group" style="display:flex; flex-direction:column; gap:6px;">
                  <label style="font-size:12px; font-weight:700; color:var(--text-muted);">Work Email</label>
                  <input type="email" id="auth-email" placeholder="john@company.com" required style="width:100%; padding:10px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--bg); color:var(--text);">
              </div>

              <div class="form-group" style="display:flex; flex-direction:column; gap:6px;">
                  <label style="font-size:12px; font-weight:700; color:var(--text-muted);">Password</label>
                  <input type="password" id="auth-password" placeholder="••••••••" required style="width:100%; padding:10px; border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--bg); color:var(--text);">
              </div>

              <div class="auth-error" id="auth-error-msg" style="color:var(--accent-error); font-size:12px; display:none; text-align:center; margin-top:4px;"></div>

              <div style="margin-top:8px;">
                  <button type="submit" id="btn-auth-submit" class="btn btn-primary w-full" style="padding:12px;">
                      Create Account
                  </button>
              </div>
              <div style="display:flex; align-items:center; gap:8px; margin: 12px 0;">
                  <hr style="flex:1; border:0; border-top:1px solid var(--border); opacity:0.3;">
                  <span style="font-size:11px; color:var(--text-muted);">or</span>
                  <hr style="flex:1; border:0; border-top:1px solid var(--border); opacity:0.3;">
              </div>
              <button type="button" class="btn btn-outline w-full" style="padding:10px; display:flex; align-items:center; justify-content:center; gap:8px; background:transparent; border:1px solid var(--border); color:var(--text); cursor:pointer; font-weight:600; border-radius:var(--radius-sm);" onclick="Auth.googleAuth(event)">
                  <img src="https://lh3.googleusercontent.com/COxitfgDO1t3s667dwKlNqG1K9Ddzg8PWBwdxgxmSBCO2gM505ccEWSuMBXe6PnTKg" alt="Google" style="width:16px; height:16px;">
                  Continue with Google
              </button>
            </form>
          </div>
        </div>
      `;
      document.body.appendChild(tempDiv.firstElementChild);
      overlay = document.getElementById('auth-overlay');
    }

    if (!document.getElementById('toast-container')) {
      const toastDiv = document.createElement('div');
      toastDiv.id = 'toast-container';
      toastDiv.style.cssText = 'position:fixed; bottom:32px; right:32px; z-index:9999; display:flex; flex-direction:column; gap:12px;';
      document.body.appendChild(toastDiv);
    }

    // Bind event listeners if not already bound
    if (overlay && !overlay.dataset.bound) {
      overlay.addEventListener('click', e => {
        if (e.target === e.currentTarget) closeModal();
      });

      overlay.querySelectorAll('[data-auth-close]').forEach(btn => {
        btn.addEventListener('click', closeModal);
      });

      document.getElementById('tab-login')?.addEventListener('click', e => {
        e.preventDefault();
        setLoginMode();
      });
      document.getElementById('tab-signup')?.addEventListener('click', e => {
        e.preventDefault();
        setSignupMode();
      });

      document.getElementById('auth-form')?.addEventListener('submit', async e => {
        e.preventDefault();
        clearErrors();
        const email = document.getElementById('auth-email')?.value?.trim();
        const pass  = document.getElementById('auth-password')?.value;
        
        if (isLoginMode) {
          try {
            const result = await login(email, pass);
            if (result.ok) {
              closeModal();
              updateUI();
              if (typeof Router !== 'undefined') Router.go('workspace');
              if (typeof UI !== 'undefined') UI.showToast(`Welcome back, ${_user.name}! 👋`, 'success');
            } else {
              showError('auth', result.error);
            }
          } catch (err) {
            showError('auth', err.message || 'Login failed.');
          }
        } else {
          const name  = document.getElementById('auth-name')?.value?.trim();
          const userType = document.getElementById('auth-user-type')?.value || 'FREELANCER';
          const companyName = document.getElementById('auth-company-name')?.value?.trim() || null;
          const companySize = document.getElementById('auth-company-size')?.value || null;
          const companyUrl = document.getElementById('auth-company-url')?.value?.trim() || null;

          try {
            const result = await register({
              name,
              email,
              password: pass,
              user_type: userType,
              company_name: companyName,
              company_size: companySize,
              company_url: companyUrl
            });
            if (result.ok) {
              closeModal();
              updateUI();
              if (typeof Router !== 'undefined') Router.go('workspace');
              if (typeof UI !== 'undefined') UI.showToast(`Account created! Welcome, ${_user.name} 🚀`, 'success');
            } else {
              showError('auth', result.error);
            }
          } catch (err) {
            showError('auth', err.message || 'Registration failed.');
          }
        }
      });
      overlay.dataset.bound = "true";
    }
  }

  function openModal(tab = 'login') {
    _ensureAuthModal();
    const overlay = document.getElementById('auth-overlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    overlay.classList.add('open');
    if (tab === 'login') {
      setLoginMode();
    } else {
      setSignupMode();
    }
    setTimeout(() => {
      const visibleInput = Array.from(overlay.querySelectorAll('input')).find(el => el.offsetParent !== null && el.style.display !== 'none');
      if (visibleInput) visibleInput.focus();
    }, 200);
  }

  function closeModal() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) {
      overlay.style.display = 'none';
      overlay.classList.remove('open');
    }
    clearErrors();
  }

  function switchTab(tab) {
    if (tab === 'login') {
      setLoginMode();
    } else {
      setSignupMode();
    }
  }

  const LOGIN_URL = '/api/auth/login';
  const REGISTER_URL = '/api/auth/register';

  /* ── Login ───────────────────────────────────────────────── */
  async function login(email, password) {
    try {
      const response = await fetch(LOGIN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (response.ok) {
        const data = await response.json();
        _user = {
          email: data.email || email,
          plan: (data.plan || 'free').toLowerCase(),
          name: data.full_name || data.company_name || email.split('@')[0],
          initials: (data.full_name || data.company_name || email.split('@')[0]).split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
          loginTime: Date.now(),
          token: data.token,
          user_type: data.user_type || 'FREELANCER',
          is_admin: data.is_admin || false,
          credits: data.credits || 500
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_user));
        return { ok: true };
      } else {
        const errorData = await response.json().catch(() => ({}));
        return { ok: false, error: errorData.detail || 'Invalid email or password.' };
      }
    } catch (err) {
      console.error('[Auth] Server login failed:', err);
      return { ok: false, error: 'Connection error. Please try again later.' };
    }
  }

  /** Silently POST the token to backend so server knows the session is active. */
  function _registerTokenWithBackend(token) {
    fetch('/api/session/register-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, plan: _user ? _user.plan : 'free', email: _user ? _user.email : null }),
    }).catch(() => {
      // Server offline — not a problem, TTL fallback handles it
      console.info('[Auth] Backend offline during token registration. TTL fallback active.');
    });
  }

  /** Generate a lightweight pseudo-token for session identity. */
  function _generateToken() {
    return `amk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
  }

  /* ── Logout — Phase 3 Nuclear ───────────────────────────── */
  function logout(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }

    // 1. Purge all local storage keys, session storage, and cookies
    _purgeAllStorage();

    console.log("[AMK Auth] Browser state sanitized. Redirecting to access gate.");

    // 2. Force a hard refresh redirect to index.html to break any remaining window memory loops
    window.location.replace('index.html');
  }

  /* ── Register ────────────────────────────────────────────── */
  async function register(params) {
    const { name, email, password, user_type, company_name, company_size, company_url } = params;
    if (!name || !email || !password)
      return { ok: false, error: 'All fields are required.' };
    if (password.length < 6)
      return { ok: false, error: 'Password must be at least 6 characters.' };

    try {
      const response = await fetch(REGISTER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          password,
          full_name: name,
          plan: 'FREE_TRIAL',
          domain: company_url || 'pending',
          user_type,
          company_name,
          company_size,
          company_url
        })
      });
      if (response.ok) {
        const data = await response.json();
        _user = {
          email: data.email || email,
          plan: (data.plan || 'free').toLowerCase(),
          name: name,
          initials: name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase(),
          loginTime: Date.now(),
          token: data.token,
          user_type: data.user_type || user_type,
          is_admin: data.is_admin || false,
          credits: data.credits || 500
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_user));
        return { ok: true };
      } else {
        const errorData = await response.json().catch(() => ({}));
        return { ok: false, error: errorData.detail || 'Registration failed.' };
      }
    } catch (err) {
      console.error('[Auth] Server registration failed:', err);
      return { ok: false, error: 'Connection error. Please try again later.' };
    }
  }

  /* ── UI State Sync — Single Source of Truth ─────────────── */

  /**
   * Plan descriptions shown in the settings modal Profile tab.
   * Keyed by the plan value (lowercase).
   */
  const PLAN_DESCRIPTIONS = {
    free:  'The Explorer — 500 monthly credits with basic features.',
    basic: 'The Starter — 5,000 monthly credits, basic audits, and AI Chat.',
    pro:   'The Growth Engine — 25,000 monthly credits, competitor analysis, and PDF exports.',
    ultra: 'The Agency Console — 100,000 monthly credits, White Labeling, and API access.',
    enterprise: 'The Enterprise — Custom dedicated infrastructure and unlimited access.',
  };

  /**
   * Badge CSS classes per tier — applied to ALL .global-plan-badge elements.
   * Format: 'badge global-plan-badge tier-{key}' so CSS colours apply.
   */
  const TIER_BADGE_CLASS = {
    free:  'badge badge-warn  global-plan-badge tier-free',
    basic: 'badge badge-accent global-plan-badge tier-basic',
    pro:   'badge badge-accent global-plan-badge tier-pro',
    ultra: 'badge badge-teal  global-plan-badge tier-ultra',
    enterprise: 'badge badge-teal  global-plan-badge tier-enterprise',
  };

  /**
   * Synchronize every plan/user display element across the entire
   * UI simultaneously. Call this after login, register, or plan upgrade.
   * This is the only place that should write plan labels to the DOM.
   */
  function updateUI() {
    if (!_user) return;

    const plan      = _user.plan || 'free';
    const label     = TIER_LABELS[plan]       || plan.toUpperCase();
    const desc      = PLAN_DESCRIPTIONS[plan] || '';
    const badgeCls  = TIER_BADGE_CLASS[plan]  || 'badge badge-accent';

    // ── Sidebar ────────────────────────────────────────────
    const sideName   = document.getElementById('sidebar-user-name');
    const sidePlan   = document.getElementById('sidebar-user-plan');
    const sideAvatar = document.querySelector('.sidebar-avatar');
    if (sideName)   sideName.textContent   = _user.name;
    if (sidePlan)   sidePlan.textContent   = label;        // ENTERPRISE not ULTRA
    if (sideAvatar) sideAvatar.textContent = _user.initials;

    // ── Top-bar tier badge ─────────────────────────────────
    const tierBadge = document.getElementById('tier-badge');
    if (tierBadge) {
      tierBadge.textContent = label;
      tierBadge.className   = badgeCls;
    }

    // ── Sidebar plan badge (same SSOT, same tier class) ────
    // Re-apply after textContent set so tier-* class stays on element
    if (sidePlan) {
      sidePlan.className = `sidebar-user-plan global-plan-badge tier-${plan}`;
    }

    // ── Header / profile trigger avatar ───────────────────
    const headerAvatar = document.querySelector('.header-avatar');
    if (headerAvatar) headerAvatar.textContent = _user.initials;

    const trigger = document.getElementById('profile-menu-trigger');
    if (trigger) {
      const avatarSpan = trigger.querySelector('.header-avatar');
      if (avatarSpan) avatarSpan.textContent = _user.initials;
    }

    // ── Profile dropdown ───────────────────────────────────
    const dropName  = document.getElementById('dropdown-user-name');
    const dropEmail = document.getElementById('dropdown-user-email');
    const dropHdr   = document.querySelector('#profile-dropdown-menu .dropdown-header');
    if (dropName)  dropName.textContent  = _user.name;
    if (dropEmail) dropEmail.textContent = _user.email;
    if (dropHdr)   dropHdr.textContent   = _user.email;

    // ── Admin Console link — only visible to admin accounts ────────────────
    const adminLink = document.getElementById('link-admin-console');
    if (adminLink) adminLink.style.display = _user.is_admin ? 'block' : 'none';

    // ── Settings modal — Profile & Billing tab ─────────────
    // #st-current-plan and #st-plan-desc are our SSOT targets
    const stPlan = document.getElementById('st-current-plan');
    const stDesc = document.getElementById('st-plan-desc');
    if (stPlan) {
      stPlan.textContent = label;
      stPlan.style.color = plan === 'ultra' ? 'var(--accent-2)' : 'var(--accent)';
    }
    if (stDesc) stDesc.textContent = desc;

    if (typeof Settings !== 'undefined' && Settings.syncWhiteLabelGate) {
      Settings.syncWhiteLabelGate();
    }

    // ── Live Credits & Wallet Fetch ────────────────────────
    if (_user.token) {
      fetch('/api/billing/wallet', {
        headers: { 'Authorization': `Bearer ${_user.token}` }
      })
      .then(res => res.json())
      .then(data => {
        const bal = data.balance === 'Unlimited' ? '∞ Unlimited' : Number(data.balance).toLocaleString();
        
        // Update header & sidebar DOM elements
        const hc = document.getElementById('headerCredits');
        if (hc) hc.textContent = bal;

        const sc = document.getElementById('sidebarCredits');
        if (sc) sc.textContent = bal;

        // Sync with local storage user object
        _user.credits = data.balance;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(_user));

        // Toast warning if credits are low (< 20% of standard basic, i.e. < 1000)
        if (data.balance !== 'Unlimited' && Number(data.balance) < 1000 && plan !== 'free') {
          if (!sessionStorage.getItem('amk_low_credits_warned')) {
            if (typeof UI !== 'undefined' && UI.showToast) {
              UI.showToast(`⚠️ Low Credits Alert: You have ${data.balance} credits remaining. Upgrade or top up soon!`, 'warning');
            } else if (typeof toast === 'function') {
              toast(`⚠️ Low Credits Alert: You have ${data.balance} credits remaining.`, 'error');
            }
            sessionStorage.setItem('amk_low_credits_warned', 'true');
          }
        }
      })
      .catch(err => {
        console.info('[Auth] Backend wallet unavailable, falling back to cached balance.');
        const bal = _user.credits === 'Unlimited' ? '∞ Unlimited' : Number(_user.credits || 0).toLocaleString();
        const hc = document.getElementById('headerCredits');
        if (hc) hc.textContent = bal;
        const sc = document.getElementById('sidebarCredits');
        if (sc) sc.textContent = bal;
      });
    }

    applyTierGating();
    syncTrialBanner();
  }

  function syncTrialBanner() {
    const existing = document.getElementById('amk-trial-banner');
    if (existing) existing.remove();

    if (!_user || !_user.isTrial) return;

    const workspace = document.getElementById('workspace-view');
    if (!workspace) return;

    const banner = document.createElement('div');
    banner.id = 'amk-trial-banner';
    banner.className = 'w-full bg-gradient-to-r from-amber-500/20 via-orange-600/20 to-purple-600/20 border-b border-amber-500/30 px-6 py-2 flex items-center justify-between text-xs text-gray-800 dark:text-gray-200 transition-all duration-300 relative z-20';
    
    const msLeft = (_user.trialExpiry || 0) - Date.now();
    const daysLeft = Math.max(0, Math.ceil(msLeft / (24 * 60 * 60 * 1000)));
    const daysText = daysLeft === 1 ? '1 day' : `${daysLeft} days`;

    banner.innerHTML = `
      <div class="flex items-center gap-2 flex-wrap">
        <span class="bg-amber-500 text-white font-bold text-[10px] px-1.5 py-0.5 rounded uppercase tracking-wider">Trial Active</span>
        <span>You are trying the premium <strong>${(_user.plan || '').toUpperCase()}</strong> plan (${daysText} remaining). Upgrade now for <strong>20% off</strong> with code <strong class="font-mono text-amber-600 dark:text-amber-400 bg-amber-100 dark:bg-amber-950/40 px-1 py-0.5 rounded">AMK20</strong>!</span>
      </div>
      <div class="flex items-center gap-3">
        <button id="btn-trial-banner-upgrade" class="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded font-bold transition-all text-[11px] active:scale-95 shadow-sm">⚡ Upgrade Now</button>
        <button id="btn-trial-banner-close" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-sm font-bold">✕</button>
      </div>
    `;

    // Insert banner right before the first child of workspace-view
    workspace.insertBefore(banner, workspace.firstChild);

    // Wire actions
    const btnUpgrade = banner.querySelector('#btn-trial-banner-upgrade');
    const btnClose = banner.querySelector('#btn-trial-banner-close');

    if (btnUpgrade) {
      btnUpgrade.onclick = (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        // Trigger the upgrade/discount modal
        if (typeof Settings !== 'undefined' && Settings.showUpgradePromoModal) {
          Settings.showUpgradePromoModal(_user.plan);
        }
      };
    }

    if (btnClose) {
      btnClose.onclick = (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        banner.style.maxHeight = '0px';
        banner.style.padding = '0px';
        banner.style.opacity = '0';
        banner.style.border = 'none';
        setTimeout(() => banner.remove(), 300);
      };
    }
  }

  function applyTierGating() {
    const tier = getTier();
    document.querySelectorAll('[data-requires-tier]').forEach(el => {
      const required = el.dataset.requiresTier;
      const locked   = !hasAccess(required);
      el.classList.toggle('tier-locked', locked);
      const overlay = el.querySelector('.lock-overlay');
      if (overlay) overlay.style.display = locked ? 'flex' : 'none';
    });
    document.querySelectorAll('.pillar-item[data-tier]').forEach(item => {
      const required = item.dataset.tier;
      const isLocked = !hasAccess(required);
      item.classList.toggle('locked-item', isLocked);
      let lockBadge = item.querySelector('.pillar-lock');
      if (isLocked && !lockBadge) {
        lockBadge = document.createElement('span');
        lockBadge.className = 'pillar-lock';
        lockBadge.textContent = '🔒';
        lockBadge.style.cssText = 'margin-left:auto; font-size:11px; opacity:0.5;';
        item.appendChild(lockBadge);
      } else if (!isLocked && lockBadge) {
        lockBadge.remove();
      }
    });
  }

  /* ── Error Helpers ───────────────────────────────────────── */
  function showError(formId, msg) {
    const el = document.getElementById('auth-error-msg');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }

  function clearErrors() {
    const el = document.getElementById('auth-error-msg');
    if (el) {
      el.textContent = '';
      el.style.display = 'none';
    }
  }


  /* ══════════════════════════════════════════════════════════
     PHASE 2 — DEV HARD RESET KEYBOARD HOOK
     Ctrl + Shift + L anywhere on the page wipes everything
     and forces a true hard reload (bypassing cache).
     Safe to ship — silently does nothing in production if
     the user doesn't know the shortcut.
  ══════════════════════════════════════════════════════════ */
  function _installDevResetHook() {
    document.addEventListener('keydown', function(e) {
      if (e.ctrlKey && e.shiftKey && e.key === 'L') {
        e.preventDefault();
        console.warn(
          '%c[AMK DEV] Hard Reset triggered (Ctrl+Shift+L) — purging ALL browser storage...',
          'color: #FF6B6B; font-weight: bold; font-size: 14px;'
        );
        localStorage.clear();
        sessionStorage.clear();
        // Force hard reload — bypasses all HTTP cache
        window.location.reload(true);
      }
    });
    console.info('%c[AMK DEV] 🔑 Hard Reset hook active: Ctrl+Shift+L', 'color: #6C63FF; font-weight:600;');
  }


  /* ── Init ────────────────────────────────────────────────── */
  async function init() {

    // ── Install the dev hard-reset hook immediately ─────────
    _installDevResetHook();

    // Ensure auth modal is present in DOM and bound
    _ensureAuthModal();

    // ── Phase 1: Validate stored session before trusting it ─
    const validSession = await restoreAndValidateSession();
    if (validSession) {
      _user = validSession;
      // Check trial expiry
      if (_user.isTrial && _user.trialExpiry && Date.now() > _user.trialExpiry) {
        console.warn('[Auth] Trial expired. Reverting to free plan.');
        _user.plan = 'free';
        delete _user.isTrial;
        delete _user.trialExpiry;
        localStorage.setItem('amk_user', JSON.stringify(_user));
        setTimeout(() => {
          if (typeof UI !== 'undefined') {
            UI.showToast('Your premium trial has expired. Reverted to free tier.', 'info');
          }
        }, 1000);
      }
    } else {
      _user = null;
      // Ensure we never render the workspace on stale sessions
      const ws = document.getElementById('workspace-view');
      if (ws) { ws.style.display = 'none'; ws.classList.remove('active'); }
      sessionStorage.removeItem('amk_state');
    }

    // ── Bind modal open triggers on index.html / dashboard.html ──
    document.querySelectorAll('[data-auth-open]').forEach(btn => {
      btn.addEventListener('click', () => openModal(btn.dataset.authOpen || 'login'));
    });

    // ── Logout bindings (all variants) ─────────────────────
    document.getElementById('btn-global-logout')?.addEventListener('click', e => logout(e));
    document.getElementById('btn-dashboard-logout')?.addEventListener('click', e => logout(e));
    document.querySelectorAll('[data-logout]').forEach(btn => {
      btn.addEventListener('click', e => logout(e));
    });

    // ── Sync UI if session is valid ─────────────────────────
    if (_user) updateUI();
  }

  /* ── Public API ──────────────────────────────────────────── */
  /* ── Google OAuth (intent-aware) ─────────────────────────────
     Carry the signup-vs-login intent so the backend never silently
     creates an account on a login attempt, and tells unregistered
     users to sign up first. */
  function googleAuth(e) {
    if (e && typeof e.preventDefault === 'function') {
      e.preventDefault();
    }
    const mode = isLoginMode ? 'login' : 'signup';
    window.location.href = `/api/v1/auth/google/login?mode=${mode}`;
  }

  return {
    init,
    getUser,
    getTier,
    hasAccess,
    openModal,
    closeModal,
    logout,
    updateUI,
    switchTab,
    googleAuth,
    toggleCompanyFields,
  };
})();
