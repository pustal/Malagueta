# Malagueta

Adult website viewer for LG webOS TVs. Opens the popular tube sites full screen,
**with their ads and pop-ups removed**, lets you **sign in to your accounts, browse
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
| Arrows, OK | Move between links and buttons, open them. The Magic Remote pointer works too. |
| Back | Close the menu → leave full screen → previous page → home screen |
| 🔴 Red | Malagueta menu: Home, Back/Forward/Reload, search, zoom, ad blocking on/off, show site as Computer/TV, hide an element, sign out, exit |
| 🟢 Green | Search the current site |
| 🟡 Yellow | Full screen for the video on the page |
| 🔵 Blue | Hide an element: point at an ad the lists missed (or use ▲/▼ to pick a bigger/smaller area), OK hides it on that site for good |
| ▶ ⏸ ◀◀ ▶▶ | Play, pause, jump 30 s. In full screen, ◀ ▶ jump 10 s and OK pauses |
| CH + / CH − | Scroll a page up or down |

On the home screen, type in the search box and pick which site to search with
the chips under it. **Edit sites** hides sites you don't use and edits your own.
**Settings** can set a 4-digit PIN asked when Malagueta opens (a curtain for a
shared TV, not encryption).

Signing in works as on a computer: use the site's own sign-in page. Each site keeps
its own sign-in and cookies; **Sign out & clear site data** in the menu removes them.

## How it works

A webOS app can't put other websites in a frame (the sites forbid it) and can't
inject anything into the TV's browser. So Malagueta brings its own **local proxy**,
which runs on the TV as the app's JS service (`services/proxy`):

```
launcher (index.html) ──luna──▶ proxy service starts
        │
        ▼
home screen   http://127.77.0.1:47100/        (served by the proxy)
        │  /api/open?site=xvideos
        ▼
XVideos       http://127.77.0.7:47106/…       ──https──▶ www.xvideos.com
              http://127.77.0.7:47106/__h/<other host>/…  ──▶ other *.xvideos.com hosts
```

- **One loopback address per site** (127.77.0.*n*), so each site has its own cookie
  jar and storage, and sign-ins persist like in a browser. Cookies are translated
  for the local http origin (`cookies.js`).
- **URL rewriting** (`rewrite.js`): absolute links on the site's own domains are
  pointed at the local origin, and back again for requests going upstream. Video
  and image CDNs on other domains load directly from the TV.
- **Ad blocking** in two layers. The proxy removes ad scripts, frames and links
  from pages and refuses ad hosts (`adblock.js`, lists in
  `src/shared/blocklist.json`). The page script (`src/inject`) catches what pages
  add later, blocks pop-ups/pop-unders and new windows, and hides ad slots with CSS
  (shared selectors plus per-site ones in `src/shared/sites.json`).
- **Page script** injected at the top of every page: keeps runtime-built URLs on the
  proxy (fetch, XHR, `window.open`, element `src`/`href`), D-pad navigation
  (`src/shared/spatial.js`), the menu, element picker and media keys.
- **Desktop mode** (default): sites are told the browser is desktop Chrome on Linux
  (with the TV's real Chrome version), so they serve their full sites instead of
  "Smart TV" or "unsupported browser" pages. Switch a site to "TV" from the menu.
- The service stops itself after 30 minutes without requests. Nothing leaves the TV
  except the requests to the sites themselves.

### Known limits

- **CAPTCHAs.** reCAPTCHA/hCaptcha check the page's domain. If a sign-in page shows
  one, it may refuse to load on the local origin, and that sign-in won't work through
  Malagueta.
- **Untested on a real TV yet.** The proxy is covered by tests on a computer, but
  webOS-specific parts (the app moving itself to the proxy's address, the service
  staying alive, binding 127.77.x.x) need a first run on the TV. If the app can't
  navigate to `http://127.77.0.1`, the launcher shows the error.
- **Ad lists need tuning.** Sites change their markup often. The host list catches
  most ad networks; for leftovers, use 🔵 Blue → hide, or add selectors to
  `src/shared/sites.json`. Search URLs for each site are there too.
- Sites with aggressive bot protection (Cloudflare challenges) may loop on the check.
- No WebSockets through the proxy (live chat/cam widgets won't connect).

## Building

Requirements: Node 20+ (see `.nvmrc`). The webOS CLI tools come with `npm install`.

```sh
npm install
npm run build          # dist/app (web app) + dist/service (proxy, home, page script)
npm test               # after a build: proxy unit + end-to-end tests
npm run package        # out/org.malagueta.app_<version>_all.ipk + Homebrew manifest
npm run icons          # regenerate icon.png, largeIcon.png, splash.png from the SVG
```

### Running on a computer

```sh
npm run dev            # builds, then runs the proxy and prints the home address
```

Open `http://127.0.0.1:47100/` in Chrome. Escape = Back, F9–F12 = the red, green,
yellow and blue buttons. After editing files in `services/proxy`, stop and rerun
`npm run dev`; `npm run watch` in another terminal rebuilds the browser code.

On macOS every site shares 127.0.0.1 (each on its own port) unless you add the
loopback aliases: `for i in $(seq 1 12); do sudo ifconfig lo0 alias 127.77.0.$i up; done`.

### Installing on the TV

With Developer Mode or a rooted TV, register it once with `npx ares-setup-device`
(name it `tv`), then:

```sh
npm run tv:deploy          # package, install, launch
npm run tv:inspect         # DevTools for the app's pages
npm run tv:inspect-service # Node inspector for the proxy
```

The package targets webOS 4.0 and newer (Chromium 53 / Node 8 and up).

## Project layout

```
appinfo.json, index.html     webOS app manifest and launcher page
src/launcher/                starts the service, moves to the home screen
src/home/                    home screen (served by the proxy)
src/inject/                  page script injected into every site
src/shared/                  sites.json, blocklist.json, spatial navigation
services/proxy/              the JS service: proxy.js and its helpers
assets/icons/                launcher icons and splash; source/malagueta.svg is the original
scripts/                     icons, TV helpers, Homebrew manifest
test/                        proxy tests
```

## License

GPL-3.0. The pepper icon was drawn for this project and is under the same license.
