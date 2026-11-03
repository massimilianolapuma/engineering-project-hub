// Applies the saved colour mode (Primer data-color-mode) before first paint.
// External file: the CSP forbids inline scripts.
// Only a UI preference is stored; never credentials.
try {
  const t = window.localStorage.getItem('eph-theme');
  if (t === 'light' || t === 'dark') window.document.documentElement.dataset.colorMode = t;
} catch {
  /* storage unavailable: data-color-mode stays auto (OS preference) */
}
