# KOKUSHIBO Anime Universe

KOKUSHIBO is an animated anime discovery and fan-community website with a separate administrator portal.

## Admin login: outside Supabase Auth

The admin email and password are **not stored in Supabase Auth or in browser source code**. They are checked by a server-side Vercel Function using private Vercel environment variables:

- `ADMIN_EMAIL` — administrator email address.
- `ADMIN_PASSWORD` — administrator password.
- `ADMIN_SESSION_SECRET` — long random secret used to sign an HttpOnly session cookie.
- `SUPABASE_URL` — Supabase project URL used by the protected server API.
- `SUPABASE_SERVICE_ROLE_KEY` — private Supabase service-role key, used only on the server to perform admin database and Storage operations.

The browser never receives the admin password or service-role key. The API enforces an HttpOnly, Secure, SameSite=Strict session cookie and only proxies a small allowlist of admin data tables and the site-media Storage bucket.

**Do not put the real admin email/password in `admin.js`, `index.html`, `supabase-config.js`, or any committed file.** The GitHub repository is public, and browser code is visible to every visitor.

## Deploy on Vercel

GitHub Pages can serve the static website, but cannot run the secure admin API. Deploy this repository on Vercel to activate the separated admin login.

1. In Vercel, import the GitHub repository `muhammedvm587/anime-hub`.
2. Keep the Vercel project Root Directory set to the repository root (not the nested `kokushibo-supabase-site` folder). The root `index.html` redirects visitors into the website folder, while `/api/admin/[...route].js` provides the private admin API.
3. Add these Environment Variables in Vercel Project Settings → Environment Variables:
   - `ADMIN_EMAIL`: your administrator Gmail address.
   - `ADMIN_PASSWORD`: a long, unique password. The previous six-digit password is not recommended because it is easy to guess.
   - `ADMIN_SESSION_SECRET`: a randomly generated secret of at least 32 bytes.
   - `SUPABASE_URL`: your Supabase project URL.
   - `SUPABASE_SERVICE_ROLE_KEY`: your Supabase service-role key. This is server-only. Never copy it to the frontend or GitHub.
4. Deploy the project.
5. Open `https://YOUR-VERCEL-DOMAIN/admin.html` to sign in. The site uses the admin email/password from Vercel, not a Supabase Auth admin account.

For a local environment, copy `.env.example` to `.env`, fill it with private local values, and use a Vercel-compatible local development server. `.env` is ignored by Git.

## Supabase database setup

Supabase remains the database and the provider for normal member Google sign-in. It is **not** used to store or verify the administrator password.

1. Create a Supabase project.
2. Run `kokushibo-supabase-site/supabase/schema.sql` in Supabase SQL Editor.
3. Set the public browser configuration in `kokushibo-supabase-site/supabase-config.js` with the Supabase Project URL and publishable key. The publishable key is intended for browser use; never insert a service-role key there.
4. Enable Google as a member sign-in provider in Supabase Auth and configure its OAuth client/redirect URLs.
5. Update the same Supabase Project URL in Vercel's `SUPABASE_URL` variable and put the service-role key in Vercel's `SUPABASE_SERVICE_ROLE_KEY` variable only.

## Website files

- `kokushibo-supabase-site/index.html` — public animated website.
- `kokushibo-supabase-site/admin.html` — separate admin login and control dashboard.
- `kokushibo-supabase-site/admin.js` — admin interface; calls only the authenticated server API for privileged work.
- `api/admin/[...route].js` — server-side admin login/session and protected Supabase REST/Storage proxy.
- `kokushibo-supabase-site/index-supabase.js` — public Google sign-in, member profiles, shared chat, announcements and public settings.
- `kokushibo-supabase-site/supabase/schema.sql` — Supabase database tables, RLS, Storage and Realtime setup.

## Important security notes

- Never commit real secrets or a populated `.env` file.
- A short numeric password is weak; use a long unique password and keep Vercel's deployment access restricted.
- The service-role key bypasses Row Level Security. It is only used by the server function after it verifies the signed administrator session.
- Rotate the Supabase service key and admin password immediately if either is accidentally exposed.
