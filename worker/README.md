# Sync worker

A small Cloudflare Worker that lets people sign in with Google and keep their quiz progress and
"make a call" guesses across devices. The page code is [site/sync.js](../site/sync.js); its
settings are in [site/sync-config.js](../site/sync-config.js).

## How it works

1. The page shows Google's "Sign in with Google" button. Google hands the page a signed ID token.
2. The page sends that token to `POST /login`. The worker checks Google's signature, the audience
   (our client ID) and the expiry, then makes a random session token.
3. Each person gets one Durable Object, named after Google's ID number for them (`sub`). It holds
   their sessions (up to 10 devices, 120 days each) and their progress.
4. `GET /progress` and `PUT /progress` read and write `{quiz, calls}`. The worker keeps only those
   fields, in the shapes the page writes, up to 64 KB. `DELETE /progress` wipes everything.
   `POST /logout` ends one session.

Stored per person: Google's ID number, session tokens, quiz progress, calls. Never email or name.
Only the origins in `ALLOWED_ORIGINS` can call it.

## Setup (once)

- **Cloudflare:** create an API token with the "Edit Cloudflare Workers" template. Add it and your
  account ID as GitHub repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.
  [The workflow](../.github/workflows/sync-worker.yml) deploys on every change under `worker/`.
- **Google:** create an OAuth client (type "Web application") with `https://nosv1.github.io` as an
  authorized JavaScript origin. Put the client ID in `wrangler.toml` (`GOOGLE_CLIENT_ID`) and in
  `site/sync-config.js`. Put the worker's URL in `site/sync-config.js` too.

## Test locally

```sh
cd worker
printf 'DEV_FAKE_LOGIN=1\nGOOGLE_CLIENT_ID=test\n' > .dev.vars   # gitignored; never deployed
npx wrangler@4 dev --port 8787
```

`DEV_FAKE_LOGIN=1` lets `POST /login` accept `{"dev_sub": "123"}` instead of a Google token. It's
off unless that local file sets it.
