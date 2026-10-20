/**
 * Project page: the dimension cards and "why" links point at sections that are collapsed
 * <details>. Open the target section when it is reached by a link or by the URL fragment, so
 * the link never lands on a closed box. Progressive enhancement: without JS the summaries
 * are still visible and can be opened by hand.
 */
function openSection(id: string): void {
  if (!id) return;
  const el = document.getElementById(id);
  if (el instanceof HTMLDetailsElement) el.open = true;
}

const fromHash = () => openSection(decodeURIComponent(location.hash.slice(1)));

fromHash();
window.addEventListener('hashchange', fromHash);
document.addEventListener('click', (event) => {
  const link = (event.target as Element | null)?.closest?.('a[href^="#"]');
  const target = link?.getAttribute('href')?.slice(1);
  if (target) openSection(decodeURIComponent(target));
});
