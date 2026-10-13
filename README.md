# Malagueta

Adult website viewer for LG webOS TVs. Opens the popular tube sites full screen,
**with their ads and pop-ups blocked**, lets you **sign in to your accounts, browse
and search**, and makes mouse-first websites usable with the TV remote.

<p align="center"><img src="assets/icons/largeIcon.png" width="130" alt="Malagueta icon: a red and a green malagueta pepper"></p>

Sites on the home screen: **Pornhub, Pornhub Premium, xHamster, FapHouse, RedTube,
XVideos, XVideos RED, XNXX, YouPorn, SpankBang, Eporner**, plus any site you add
yourself (Edit sites → + Add a site).

For adults only. Malagueta is an independent viewer; it is not affiliated with,
or endorsed by, any of these sites. Respect each site's terms and your local laws.

## Using it

| Remote | What it does |
| --- | --- |
| Arrows, OK | Move between links and buttons, open them. Age gates and cookie banners are reachable first. The Magic Remote pointer works too. |
| Back | Close the menu → leave full screen → previous page → home screen |
| 🔴 Red | Malagueta menu: Home, Back/Forward/Reload, search, zoom, ad blocking on/off, hide an element, clear site data, exit |
| 🟢 Green | Search the current site |
| 🟡 Yellow | Full screen for the video on the page |
| 🔵 Blue | Hide an element: point at an ad the lists missed (or use ▲/▼ to pick a bigger/smaller area), OK hides it on that site for good |
| ▶ ⏸ ◀◀ ▶▶ | Play, pause, jump 30 s. In full screen, ◀ ▶ jump 10 s and OK pauses |
| CH + / CH − | Scroll a page up or down |

On the home screen, type in the search box and pick which site to search with
the chips under it. **Edit sites** hides sites you don't use and edits your own.
**Settings** can set a 4-digit PIN asked when Malagueta opens (a curtain for a
shared TV, not encryption). **About** shows the version and QR codes for this
page and for [Ko-fi](https://ko-fi.com/pustal), and on the TV can open either in
the TV's browser.

Signing in works as in a browser: use the site's own sign-in page. Each site keeps
its own sign-in. To sign out use the site's own Log out (the menu's **Clear site
data** removes what a page can reach, but not cookies a site locks away).

## How it works

Sites open **at their real addresses**, in the app's own window, exactly as the
TV's browser engine would show them. Players, sign-ins and captchas therefore
behave like in a browser.

webOS's web app manager injects `webOSUserScripts/userScript.js` from an app's
folder into every page that app shows, once the page has finished loading (it is
how [youtube-webos](https://github.com/webosbrew/youtube-webos) blocks ads).
Malagueta's user script (`src/userscript`) adds, on every site:

- **Ad blocking** (`block.js`): requests to ad networks (fetch, XHR, beacons,
  `<script>`, `<iframe>`, `<img>`, ad frames built from inline HTML) get an empty
  answer or never load; ad scripts in the page's HTML are stopped before they run;
  known ad slots are hidden with CSS. Lists: `src/shared/blocklist.json` (shared)
  and `cosmetic` in `src/shared/sites.json` (per site). Video players are left
  alone.
- **Pop-up blocking**: `window.open` only opens the site's own pages, in the same
  window; pop-unders and "new tab" ads never open.
- **Remote control**: D-pad navigation over links and buttons (`src/shared/spatial.js`),
  which keeps to whatever dialog is on top; media keys; the menu (`menu.js`);
  the element picker (`picker.js`).

### Old TV browser engines

webOS 6 TVs browse with **Chromium 79** (2019), webOS 5 with 68. Today's sites
ship code that engine can't run, so without help Pornhub shows a black screen,
FapHouse's buttons do nothing and xHamster asks you to update your browser.
The user script bridges the gap, and does nothing on engines that don't need it.

Because webOS only runs the user script after a page has loaded, the site's
scripts have already failed by then. So on old engines pages are opened through
a **loader** (`loader.js`): the app first opens the site's own `/robots.txt`
(a plain-text page on the same site, with no scripts) with the wanted page in
the address (`/robots.txt#mlg=/path`). There the user script fetches the real
page and its scripts, rewrites what the engine can't run, switches the address
back to the real page and writes the result into the document, so the page is
built with everything fixed before any of its scripts run. Links to the same
site go through the loader; a page that is reached another way (Back, a form
POST) is checked once loaded and reloaded through the loader if it needs it.
The fixes applied:

- **JavaScript syntax** (`compat.js`, `lower.js`): every script the page loads
  is test-compiled; one the engine rejects is rewritten into older syntax and
  run in its original place and order (scripts added later are caught as
  they are inserted). Handles `?.`, `??`,
  `||=`/`&&=`/`??=`, private methods (`#m()`), `static {}` blocks and `1_000`.
  Scripts that compile fine are remembered per site and not checked again.
- **Built-ins** (`polyfills.js`): `replaceAll`, `at`, `Object.hasOwn`,
  `findLast`, `structuredClone`, `Promise.any` and a few more, only when missing.
- **CSS** (`cssfix.js`): `inset` (overlays such as age gates) and `:is()`/`:where()`
  selectors are rewritten into rules the engine understands.
- **Site quirks** (`quirks.js`): xHamster's "Please update your browser" page is
  dismissed automatically.

Expect a short flash of the site's robots.txt text and a dark "Loading…" screen
on each page change on webOS 5/6: that is the loader at work.

Not covered: sites built from ES modules (SpankBang currently), flex `gap`,
`aspect-ratio` and `:has()` in CSS (cosmetic). Troubleshooting on the TV's
DevTools: `localStorage['mlg:disable'] = 'loader'` (or `compat`, `polyfills`,
`blocking`) switches a part off for that site.

The home screen (`src/home`) is the app's own page. Back from a site's first page
returns to it, and the menu's Home jumps back to it through the history.

Sites see the TV's own browser identity (webOS ignores a custom User-Agent
in `appinfo.json` for apps like this one), so some serve their TV versions:
Pornhub shows its remote-friendly TV interface.

### Known limits

- **Checked in Chromium 79, with the user script run after page load as on the
  TV.** Tested against the real sites (age gates, D-pad, menu, ads, players
  loading their streams). That build can't decode H.264, so watching a video
  still needs confirming on the TV; Pornhub's own video endpoint refused the
  test machine.
- **SpankBang** loads its code as ES modules, which the compatibility layer
  can't rewrite yet, so on webOS 6 it may not work. Its Cloudflare checks also show a "Verify you are human" box inside a
  frame the D-pad can't reach: tick it with the Magic Remote pointer.
- **Ad lists need tuning.** Sites change their markup often. For leftovers, use
  🔵 Blue → hide, or add selectors to `src/shared/sites.json`. Search URLs for
  each site are there too.

## Building

Requirements: Node 20+ (see `.nvmrc`). The webOS CLI tools come with `npm install`.

```sh
npm install
npm run build          # dist/: home screen, webOSUserScripts/userScript.js, icons
npm test               # syntax lowering, CSS repairs, search URLs, site list
npm run package        # out/org.malagueta.app_<version>_all.ipk + Homebrew manifest
npm run icons          # regenerate icon.png, largeIcon.png, splash.png from the SVG
```

### Trying it on a computer

```sh
npm run watch          # rebuilds dist/ on every change, including dist/malagueta.user.js
```

- Home screen: open `dist/index.html` in Chrome.
- Sites: install `dist/malagueta.user.js` in Tampermonkey or Violentmonkey and
  open a site. Escape = Back, F9–F12 = the red, green, yellow and blue buttons.

### Installing on the TV

From the [webOS Homebrew Channel](https://github.com/webosbrew/webos-homebrew-channel):
in its **Settings → Add repository**, add

```
https://pustal.github.io/webos-repo/api/apps.json
```

and install Malagueta from the list; updates show up there too. Each GitHub
release carries the `.ipk` and `org.malagueta.app.manifest.json` (both written
by `npm run package`), which is what the repository points at.

To install a build of your own, with Developer Mode or a rooted TV, register it once with `npx ares-setup-device`
(name it `tv`), then:

```sh
npm run tv:deploy      # package, install, launch
npm run tv:inspect     # DevTools for the app (home screen and sites)
```

The package installs on webOS 4.0 and newer; the compatibility layer is aimed
at webOS 5 and 6 (Chromium 68/79). On webOS 4 (Chromium 53) many of today's
sites will still fail.

## Project layout

```
appinfo.json, index.html     webOS app manifest and home screen page
src/home/                    home screen (grid, search, settings, About)
src/userscript/              the script webOS injects into every site
src/shared/                  sites.json, blocklist.json, search, spatial navigation
assets/icons/                launcher icons and splash; source/malagueta.svg is the original
scripts/                     icons, TV helpers, Homebrew manifest
test/                        tests
```

## Support

If you find Malagueta useful, please consider [buying me a Ko-fi](https://ko-fi.com/pustal).

## License

GPL-3.0. The pepper icon was drawn for this project and is under the same license.
