/**
 * Small per-site fixes for pages that only exist because the TV's browser
 * engine is old.
 *
 * xHamster answers the webOS 6 browser with a "Please update your browser"
 * page; its "Got it" button lets you in anyway (the site then works, with
 * the compatibility layer in compat.js). Malagueta presses it for you.
 */
import { SITE } from './site.js';

const QUIRKS = [
  {
    site: 'xhamster',
    when: () => /update your browser/i.test(document.title),
    click: /^\s*Got it\s*$/i,
  },
];

function clickByText(re) {
  const list = document.querySelectorAll('button, a, [role=button]');
  for (let i = 0; i < list.length; i++) {
    if (re.test(list[i].textContent || '')) {
      list[i].click();
      return true;
    }
  }
  return false;
}

export function startQuirks() {
  const mine = QUIRKS.filter((q) => q.site === SITE.id);
  if (!mine.length) return;
  const run = () => mine.forEach((q) => {
    if (!q.when()) return;
    // The button's handler may attach a moment after the page is parsed.
    let tries = 0;
    const timer = setInterval(() => {
      if (clickByText(q.click) || ++tries > 20) clearInterval(timer);
    }, 250);
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
  else run();
}
