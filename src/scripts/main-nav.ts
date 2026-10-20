/**
 * Phones: the main nav is one row that scrolls sideways inside itself. Bring the current page's
 * link into view, so it is never hidden past the right edge. Only the nav scrolls, never the page.
 */
{
  // Block scope: these scripts are not modules, so top-level names would be shared globals.
  const nav = document.querySelector<HTMLElement>('.mainnav');
  const link = nav?.querySelector<HTMLElement>('a[aria-current="page"]');
  if (nav && link && nav.scrollWidth > nav.clientWidth) {
    const overflow = link.getBoundingClientRect().right - nav.getBoundingClientRect().right;
    if (overflow > 0) nav.scrollLeft += overflow + 16;
  }
}
