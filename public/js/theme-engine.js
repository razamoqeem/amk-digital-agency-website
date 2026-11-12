/* ============================================================
   AMK Digital Agency — THEME-ENGINE.JS
   Global, FOUC-proof theme persistence micro-script.

   ARCHITECTURE:
   ─ Runs as an IIFE before the DOM body is painted.
   ─ Reads amk_theme from localStorage and sets data-theme
     on <html> instantly — zero flash, zero flicker.
   ─ Exposes window.AMKTheme as the single global API for
     toggle buttons on any page (landing, workspace, settings).
   ─ Keeps settings.js / applyTheme() as a legacy shim so no
     other code breaks.
   ============================================================ */

// Force immediate execution to prevent flashing
(function initTheme() {
    try {
        const sysBody = document.documentElement;
        const savedTheme = localStorage.getItem('amk_os_theme') || 'LIGHT';
        
        if (savedTheme === 'DARK') {
            sysBody.classList.add('dark');
            sysBody.setAttribute('data-theme', 'dark');
            sysBody.style.colorScheme = 'dark';
        } else {
            sysBody.classList.remove('dark');
            sysBody.removeAttribute('data-theme');
            sysBody.style.colorScheme = 'light';
        }
    } catch(e) {}
})();

// Global Theme API for compatibility
window.AMKTheme = (function() {
    function set(themeStr) {
        const sysBody = document.documentElement;
        if (themeStr === 'dark' || themeStr === 'DARK') {
            sysBody.classList.add('dark');
            sysBody.setAttribute('data-theme', 'dark');
            sysBody.style.colorScheme = 'dark';
            try { localStorage.setItem('amk_os_theme', 'DARK'); } catch(e){}
        } else {
            sysBody.classList.remove('dark');
            sysBody.removeAttribute('data-theme');
            sysBody.style.colorScheme = 'light';
            try { localStorage.setItem('amk_os_theme', 'LIGHT'); } catch(e){}
        }
        // Sync the checkbox state if visible
        const checkbox = document.getElementById('theme-switch-toggle');
        if (checkbox) checkbox.checked = (themeStr === 'dark' || themeStr === 'DARK');
    }

    function toggle() {
        const isDark = document.documentElement.classList.contains('dark');
        set(isDark ? 'LIGHT' : 'DARK');
    }

    function bindAll() {
        const sysBody = document.documentElement;
        const toggles = document.querySelectorAll('.theme-toggle-btn');
        toggles.forEach(btn => {
            if (!btn._themeBound) {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    window.AMKTheme.toggle();
                });
                btn._themeBound = true;
            }
        });

        // Sync and bind the checkbox state if visible
        const checkbox = document.getElementById('theme-switch-toggle');
        if (checkbox) {
            checkbox.checked = sysBody.classList.contains('dark');
            if (!checkbox._themeBound) {
                checkbox.addEventListener('change', () => {
                    window.AMKTheme.set(checkbox.checked ? 'DARK' : 'LIGHT');
                });
                checkbox._themeBound = true;
            }
        }
    }

    return { set, toggle, bindAll };
})();

window.toggleAMKTheme = function() { window.AMKTheme.toggle(); };

document.addEventListener('DOMContentLoaded', () => {
    window.AMKTheme.bindAll();
});
