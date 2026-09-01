# Mapbox Token Setup — Seismic Atlas

How to get a Mapbox public token and wire it into the project, both
locally and on Vercel. You only do this once.

---

## 1. What kind of token you need

Mapbox has two token types:

- **Public token** (starts with `pk.`) — safe to ship in a browser app.
  This is what a frontend map uses. It is *designed* to be visible in
  client-side code.
- **Secret token** (starts with `sk.`) — for server-side / account
  management. **Never** put this in a Next.js `NEXT_PUBLIC_*` variable or
  anywhere the browser can see it.

Seismic Atlas is a client-rendered map, so you want a **public (`pk.`)
token**. Every Mapbox account comes with a "Default public token" you can
use, but we'll create a dedicated, URL-restricted one instead (safer).

---

## 2. Get the token from your Mapbox dashboard

You're already logged in, so:

1. Go to your **Access tokens** page:
   https://console.mapbox.com/account/access-tokens/
2. You'll see a **Default public token** already listed. You *can* use it,
   but create a scoped one for this project instead:
3. Click **Create a token**.
4. Give it a name: `seismic-atlas`.
5. **Public scopes** — leave the default public scopes checked. The
   defaults (`styles:read`, `fonts:read`, `datasets:read`, `vision:read`)
   are all a GL JS map needs. Do **not** check any secret scopes.
6. **URL restrictions** (important — do this now or right after first
   deploy): add the URLs allowed to use this token. This stops anyone who
   scrapes the token from your live site from draining your free quota.
   Add:
   - `http://localhost:3000` (for local dev)
   - `https://seismic-atlas-five.vercel.app` (your live Vercel URL)
   - If you later add a custom domain, add it here too.

   > Note: URL restrictions apply to browser (`Referer`) requests. If you
   > ever hit "401 / not authorized" locally, double-check `localhost:3000`
   > is listed exactly, with the right protocol and port.
7. Click **Create token**.
8. Copy the token string (starts with `pk.`). You won't be shown a secret
   half — public tokens are fully visible any time from this page, so you
   can always come back and copy it again.

---

## 3. Wire it in locally

In the project root (`d:/Aman/Code/Seismic Atlas`):

1. Copy the example file to a real one:
   ```
   copy .env.local.example .env.local
   ```
   (Windows `copy`; on Mac/Linux it's `cp`.)
2. Open `.env.local` and paste your token:
   ```
   NEXT_PUBLIC_MAPBOX_TOKEN=pk.your_actual_token_here
   ```
3. Save. **Restart the dev server** — Next only reads env files at startup,
   so a running `npm run dev` won't pick up the change until you stop and
   restart it.

`.env.local` is gitignored, so your token never gets committed. Good.

### Why the `NEXT_PUBLIC_` prefix?

Next.js only exposes environment variables to browser code if they start
with `NEXT_PUBLIC_`. Because the map runs in the browser, the token *must*
have this prefix or the client code will read `undefined`. This is expected
and safe **only because it's a public token** — that's the whole reason we
use `pk.` and lock it with URL restrictions.

---

## 4. Wire it in on Vercel

The `.env.local` file is local-only (and gitignored), so Vercel doesn't
have it. Set the variable in Vercel's dashboard:

1. Go to your project on https://vercel.com → **Settings** → **Environment
   Variables**.
2. Add a new variable:
   - **Key:** `NEXT_PUBLIC_MAPBOX_TOKEN`
   - **Value:** your `pk.` token
   - **Environments:** check **Production**, **Preview**, and
     **Development** (all three, so preview deploys work too).
3. Save.
4. **Redeploy** for the variable to take effect — either push a new commit,
   or in the Vercel dashboard go to **Deployments** → latest → **Redeploy**.
   Env var changes do *not* apply to already-built deployments.

---

## 5. Verify it worked

Locally: after restarting `npm run dev`, once Phase 1's map exists it should
render tiles. If you see a blank/grey box and a console error mentioning
"401" or "access token", the token is missing, misspelled, or the current
URL isn't in the token's allowed list.

Quick sanity check that the var is loaded at all — the map component in
Phase 1 will read `process.env.NEXT_PUBLIC_MAPBOX_TOKEN`; we'll have it show
a clear "Mapbox token missing" message rather than a silent blank if it's
undefined.

---

## Security recap

- Public `pk.` token in `NEXT_PUBLIC_` → correct and safe.
- URL-restrict the token to `localhost:3000` + your Vercel domain.
- Never use an `sk.` secret token in frontend code.
- `.env.local` stays gitignored; Vercel gets its own copy via the dashboard.
- You can rotate (delete + recreate) the token any time from the Mapbox
  console if it ever leaks somewhere it shouldn't.