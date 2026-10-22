# Mormon Bridge multiplayer worker

Cloudflare Worker + Durable Object that hosts private rooms (server-authoritative).

## Local development

From the repo root:

```bash
npm install
npm run dev:worker   # wrangler on http://127.0.0.1:8787
```

In another terminal:

```bash
npm run dev:web      # Vite on http://localhost:5173 (proxies /api → 8787)
```

## Deploy (manual)

```bash
cd worker
npx wrangler login
npm run deploy
```

Worker name in Cloudflare must stay `mormon-bridge` (matches `wrangler.toml`).

## Auto-deploy on push to main (Workers Builds)

Preferred over GitHub Actions: connect this repo in the Cloudflare dashboard.

1. Push `main` (includes `worker/`, `shared/`, and `web/src/game/`).
2. [Workers & Pages](https://dash.cloudflare.com/) → create/select Worker **mormon-bridge** → **Settings** → **Builds** → **Connect**.
3. Authorize the Cloudflare Workers & Pages GitHub app for `dcripplinger/mormon-bridge`.
4. Build settings for this monorepo:

| Setting | Value |
|---|---|
| Production branch | `main` |
| Root directory | `/` (repo root) |
| Build command | `npm ci` |
| Deploy command | `npm run deploy --workspace=worker` |

5. Set `ALLOWED_ORIGINS` (Worker Variables) to your web origins, e.g.  
   `http://localhost:5173,http://127.0.0.1:5173,https://your-itch-page...`
6. Point production web builds at the Worker:

```bash
# web/.env.production
VITE_API_BASE=https://mormon-bridge.<your-subdomain>.workers.dev
```

## Free-tier posture

- One Durable Object instance per room code; state lives in DO storage (no external DB).
- No public lobby listing — join requires knowing the room code.
- Empty rooms are cleared after ~30 minutes with no connections; all rooms expire after 3 days (`HostRuntime` alarm).
- Friend-sized traffic (a few concurrent rooms) fits typical Workers free allowances; watch
  Cloudflare’s current DO/request limits if you grow beyond that.

## Protocol

See `@mormon-bridge/shared`: `HostRuntime` is transport-agnostic so a future client-host
mode can reuse the same lobby/play messages without a second rules engine.
