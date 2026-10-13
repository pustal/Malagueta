/**
 * Builds a site's search URL. Shared by the home screen and the user script.
 *
 * Templates in sites.json are paths containing {q}, e.g. "/video/search?search={q}";
 * `space` says how the site writes spaces in searches ("+", "-" or "%20").
 *
 * @param {{url:string, search?:string, space?:string}} site
 * @param {string} q        what the user typed
 * @param {string} [base]   origin to search on (default: the site's start page),
 *                          e.g. the page's own origin when already on the site
 * @returns {string|null}   null when the site has no search or q is empty
 */
export function searchUrl(site, q, base) {
  if (!site.search || !q || !q.trim()) return null;
  let enc = encodeURIComponent(q.trim());
  if (site.space && site.space !== '%20') enc = enc.replace(/%20/g, site.space);
  const path = site.search.replace('{q}', enc);
  if (/^https?:\/\//i.test(path)) return path;
  const root = (base || site.url).replace(/^(https?:\/\/[^/]+).*$/i, '$1');
  return root + (path.charAt(0) === '/' ? '' : '/') + path;
}
