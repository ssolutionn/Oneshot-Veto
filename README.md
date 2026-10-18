# Oneshot · captains' veto

The CyberClash captains' map veto as a site of its own: personal signed links
for both captains, a coin tossed in the room, spectators and an admin view with
the HLTV text. English by default, Russian with the flag.

**Generated — do not edit here.** The source lives in the panel repository
(`veto.html`, `veto.js`, `veto-room.js`, …); `node scripts/build-veto-site.mjs`
there rebuilds this copy without any panel files or roster data.

## Publish (Cloudflare)

The included **Deploy veto to Cloudflare** GitHub Actions workflow publishes
both the Worker relay and Pages on a push to `main`. Configure the two
repository credentials described in `RELAY.md`; no credentials belong in
the site files. The workflow verifies public assets and relay health after
deployment. A missing credential is an explicit failed check.

Alternatively, using the Cloudflare Git integration:

Workers & Pages → Create → Import a repository → this one. `wrangler.jsonc`
serves the files as static assets (`.assetsignore` leaves the config out);
turn the `workers.dev` address on in Settings → Domains & Routes. As Pages:
no build command, output directory `/`. `_headers` sets the security headers.

Every push to `main` should go live by itself. Settings → Builds: production
branch `main`, no build command, deploy command `npx wrangler deploy`
(`wrangler versions upload` would only upload a version with 0 % traffic).
A push that shows no new row in Deployments means the Cloudflare GitHub app
does not see this repository: Settings → Builds → Git repository → Manage.

VDO rooms work on any static host. Server rooms need the relay described in
`RELAY.md`: deploy this Worker's Durable Objects first; Pages forwards only
`/api/veto-relay` to that Worker. For a future server use Node >=22 and the
same HTTP protocol. A static file server alone cannot synchronize clients.
