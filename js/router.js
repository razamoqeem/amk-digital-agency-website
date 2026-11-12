/* ============================================================
   AMK Digital Agency — ROUTER.JS
   Landing <-> Workspace state machine

   Updated to be async-aware: waits for Auth.init() session
   validation to complete before deciding which view to render.
   This prevents the race condition where router reads _user=null
   before the async localStorage validation resolves.
   ============================================================ */

const Router = (() => {
  const STATES = { LANDING: 'landing', WORKSPACE: 'workspace' };
  let _current = STATES.LANDING;

  // Cache view references after DOM is ready
  let _views = null;
  function _getViews() {
    if (!_views) {
      _views = {
        landing:   document.querySelector('.landing-view'),
        workspace: document.getElementById('workspace-view'),
        header:    document.getElementById('site-header'),
      };
    }
    return _views;
  }

  const el = id => document.getElementById(id);
  const q  = s  => document.querySelector(s);

  /* ── Landing View ─────────────────────────────────────────── */
  function showLanding() {
    _current = STATES.LANDING;
    sessionStorage.setItem('amk_state', 'landing');
    const views = _getViews();
    const hCta  = el('header-cta');

    const currentPath = window.location.pathname;
    const isLandingPage = currentPath === '/' || currentPath.endsWith('index.html') || currentPath === '' || currentPath.endsWith('/');

    if (!isLandingPage) {
      console.log("[AMK Digital Agency] showLanding() called on dashboard/other page. Redirecting to home.");
      window.location.href = 'index.html';
      return;
    }

    if (views.landing)   views.landing.style.display = 'block';
    if (views.header)    views.header.style.display  = 'flex';

    const ws = el('workspace-view');
    if (ws) {
      ws.style.display = 'none';
      ws.classList.remove('active');
    }

    // Auth-aware CTA swap
    if (hCta) {
      const user = (typeof Auth !== 'undefined') ? Auth.getUser() : null;
      if (user) {
        hCta.innerHTML = `
          <button class="btn btn-primary btn-sm" onclick="Router.go('workspace')">Return to Dashboard →</button>
          <button class="btn btn-ghost btn-sm" data-logout>Logout</button>
        `;
        const lo = hCta.querySelector('[data-logout]');
        if (lo) lo.addEventListener('click', e => Auth.logout(e));
      } else {
        hCta.innerHTML = `
          <a href="#contact" class="btn btn-ghost btn-sm">Book Strategy Call</a>
          <button class="btn btn-primary btn-sm" data-auth-open="login">Client Login →</button>
        `;
        const li = hCta.querySelector('[data-auth-open]');
        if (li) li.addEventListener('click', () => Auth.openModal('login'));
      }
      hCta.classList.remove('hidden');
    }

    document.body.style.overflow = '';
  }

  /* ── Workspace View ───────────────────────────────────────── */
  function showWorkspace() {
    _current = STATES.WORKSPACE;
    sessionStorage.setItem('amk_state', 'workspace');

    const views = _getViews();
    const currentPath = window.location.pathname;
    const isDashboardPage = currentPath.endsWith('dashboard.html');

    if (!isDashboardPage) {
      console.log("[AMK Digital Agency] showWorkspace() called on landing/other page. Redirecting to dashboard.");
      window.location.href = 'dashboard.html';
      return;
    }

    if (views.landing) views.landing.style.display = 'none';
    if (views.header)  views.header.style.display  = 'none';

    const ws = el('workspace-view');
    if (ws) {
      ws.style.display = 'flex';
      requestAnimationFrame(() => ws.classList.add('active'));
    }

    document.body.style.overflow = 'hidden';

    // Activate Audit Hub by default instead of first pillar
    const auditHub = el('tab-audit-hub');
    if (auditHub) {
        auditHub.click();
    } else {
        const firstPillar = q('.pillar-item');
        if (firstPillar) firstPillar.click();
    }
  }

  /* ── Navigation ───────────────────────────────────────────── */
  function go(state) {
    if (state === _current) return; // HALT cyclical redirection
    if (state === STATES.WORKSPACE) showWorkspace();
    else showLanding();
  }

  function current() { return _current; }

  /* ── Init (async-aware) ───────────────────────────────────── */
  /**
   * Router.init() is now called AFTER Auth.init() resolves.
   * See main.js DOMContentLoaded bootstrap for the correct order.
   * The router simply reads the already-validated Auth.getUser()
   * to decide which view to restore.
   */
  function init() {
    const currentPath = window.location.pathname;
    const isLandingPage = currentPath === '/' || currentPath.endsWith('index.html') || currentPath === '' || currentPath.endsWith('/');
    const isDashboardPage = currentPath.endsWith('dashboard.html');
    
    const user = (typeof Auth !== 'undefined') ? Auth.getUser() : null;
    const searchParams = new URLSearchParams(window.location.search);

    if (isDashboardPage) {
      // A Google SSO redirect lands here as /dashboard.html?login_token=...&connected=google
      // BEFORE main.js has finished hydrating the session (it calls /api/v1/me async).
      // Treat that handoff like the ?scan= exception so we don't bounce mid-login.
      const hasGoogleHandoff = searchParams.has('login_token') || searchParams.get('connected') === 'google';
      // Guard dashboard: anonymous users are only allowed if they have an active URL scan handoff (?scan=...)
      if (!user && !searchParams.has('scan') && !hasGoogleHandoff) {
        console.warn("[AMK Digital Agency] Direct anonymous access to /dashboard.html. Redirecting to login.");
        window.location.href = 'index.html?login=1';
      } else {
        console.log("[AMK Digital Agency] Access granted to dashboard.");
        showWorkspace();
      }
    } else if (isLandingPage) {
      console.log("[AMK Digital Agency] Landing page detected.");
      showLanding();

      // If ?login=1 is present, open login modal
      if (searchParams.get('login') === '1') {
        console.log("[AMK Digital Agency] ?login=1 parameter found. Triggering login popup.");
        const newUrl = window.location.pathname;
        window.history.replaceState({}, document.title, newUrl);
        
        setTimeout(() => {
          if (typeof Auth !== 'undefined') {
            Auth.openModal('login');
          }
        }, 200);
      }
    } else {
      console.log("[AMK Digital Agency] Navigated to non-routed page.");
    }
  }

  return { go, current, init, STATES };
})();


/* ── Bootstrap ────────────────────────────────────────────────
   Auth.init() is async (validates session via timestamp + optional
   backend ping). Router.init() must wait for it to complete so
   that Auth.getUser() returns the correctly validated user.
───────────────────────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    console.log('%c[AMK Digital Agency] Booting secure session engine...', 'color:#6C63FF; font-weight:700;');

    // Step 1: Auth validates & restores (or purges) the session
    if (typeof Auth !== 'undefined') {
      await Auth.init(); // ← await ensures validation finishes first
    }

    // Step 2: Router decides which view to show based on validated state
    if (typeof Router !== 'undefined') {
      Router.init();
    }

    console.log('%c[AMK Digital Agency] ✅ Secure boot complete.', 'color:#1DD1A1; font-weight:700;');
  } catch (err) {
    console.error('[AMK Digital Agency] Critical boot error:', err);
    // Fail safe — show landing page so user isn't stuck on a blank screen
    document.querySelector('.landing-view')?.style.setProperty('display', 'block');
    document.getElementById('workspace-view')?.style.setProperty('display', 'none');
  }
});
