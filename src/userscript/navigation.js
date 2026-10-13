/**
 * Getting around between sites and the Malagueta home screen.
 *
 * The home screen is the app's own page (index.html), the first entry in the
 * app's history; sites are opened from it in the same window. A website may
 * not open the app's local page directly, but it can go back in history, so:
 *  - Back goes back one page; from a site's first page that is the home screen.
 *  - Home goes back to the first history entry.
 */

/**
 * Goes back to the first history entry (the home screen).
 *
 * history.go(-n) does nothing when n is further back than the current entry,
 * and a page can't read its own position in the history. So try the biggest
 * possible jump first and smaller ones after it: the first that works is the
 * jump to the very first entry.
 */
export function goHome() {
  let leaving = false;
  const onHide = () => { leaving = true; };
  window.addEventListener('pagehide', onHide);
  let n = history.length - 1;
  const step = () => {
    if (leaving || n < 1) return;
    history.go(-n);
    n--;
    setTimeout(step, 150);
  };
  step();
}

/** Back one page (to the home screen from a site's first page). */
export function goBack() {
  history.back();
}

/**
 * Clears what this site stored in the browser: storage and every cookie that
 * scripts can see, on every domain and path level they might use. Cookies a
 * site marks HttpOnly can't be removed from a page, so use the site's own
 * "Log out" too if it still shows you as signed in.
 */
export function clearSiteData() {
  try { localStorage.clear(); } catch (e) { /* ignore */ }
  try { sessionStorage.clear(); } catch (e) { /* ignore */ }

  const host = location.hostname.split('.');
  const domains = [''];
  for (let i = 0; i < host.length - 1; i++) {
    const d = host.slice(i).join('.');
    domains.push('; domain=' + d, '; domain=.' + d);
  }
  const segs = location.pathname.split('/');
  const paths = ['/'];
  for (let i = 2; i <= segs.length; i++) paths.push(segs.slice(0, i).join('/') || '/');

  document.cookie.split(';').forEach((pair) => {
    const name = pair.split('=')[0].trim();
    if (!name) return;
    domains.forEach((d) => paths.forEach((p) => {
      document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=' + p + d;
    }));
  });
}

/** Clears the site's data and reloads its start page. */
export function signOut() {
  clearSiteData();
  location.href = location.origin + '/';
}
