/* KivoReach Website — site settings.
   The domain is not confirmed yet, so every address below is empty.
   Fill these in when the addresses are known (see .env.example for the names).
   Never write a *.vercel.app address here. */
window.AMK_SITE = {
  // Public address of this website, e.g. "https://www.example.com"
  siteUrl: "",
  // Address of the KivoReach Studio (sign-in, sign-up), e.g. "https://app.example.com"
  appUrl: "",
  // Leave empty to use the same address as the pages (the normal case on Vercel).
  // Only fill in if the tools run on a different address.
  apiUrl: "",
  // Cloudflare Turnstile SITE key (public by design, safe to commit). Empty = bot check off.
  // The matching SECRET key goes in the host environment variables as TURNSTILE_SECRET, never here.
  turnstileSiteKey: "0x4AAAAAAGFrDO7LLNU3A2Fl"
};
