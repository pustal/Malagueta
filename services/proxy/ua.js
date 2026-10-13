/**
 * User-Agent handling.
 *
 * The TV's browser identifies itself as "Web0S; Linux/SmartTV", and several
 * sites answer that with a stripped-down TV page or an "unsupported browser"
 * notice. In "desktop" mode (the default) the proxy sends a plain desktop
 * Linux Chrome User-Agent instead, keeping the TV's real Chrome version so
 * the claim matches what the browser engine can actually do (sites that
 * check for features then behave consistently, and bot checks see no
 * mismatch). The page script reports the same string to the page.
 *
 * Runs on the TV's Node.js (v8 on webOS 4), so: ES2017 at most.
 */
'use strict';

/** Used when the TV's version can't be read (e.g. no User-Agent header). */
var FALLBACK_CHROME = '108.0.0.0';

/**
 * Desktop Chrome User-Agent with the same Chrome version as `tvUa`.
 * @param {string|null|undefined} tvUa  the browser's own User-Agent
 */
function desktop(tvUa) {
  var m = /Chrome\/([\d.]+)/.exec(tvUa || '');
  var version = m ? m[1] : FALLBACK_CHROME;
  return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' + version + ' Safari/537.36';
}

module.exports = { desktop: desktop };
