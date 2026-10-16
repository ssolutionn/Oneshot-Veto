# Oneshot · captains' veto

The CyberClash captains' map veto as a site of its own: personal signed links
for both captains, a coin tossed in the room, spectators and an admin view with
the HLTV text. English by default, Russian with the flag.

**Generated — do not edit here.** The source lives in the panel repository
(`veto.html`, `veto.js`, `veto-room.js`, …); `node scripts/build-veto-site.mjs`
there rebuilds this copy without any panel files or roster data.

## Publish (Cloudflare Pages)

Workers & Pages → Create → Pages → Connect to Git → this repository.
Framework preset: None. Build command: empty. Build output directory: `/`.
`_headers` sets the security headers.

Locally: any static server, e.g. `python3 -m http.server 8080`.
