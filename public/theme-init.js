// Applies the saved theme before first paint (external file: the CSP forbids inline scripts).
// Only a UI preference is stored; never credentials.
try {
  const t = window.localStorage.getItem('eph-theme');
  if (t === 'light' || t === 'dark') window.document.documentElement.dataset.theme = t;
} catch {
  /* storage unavailable: follow the OS preference */
}
