# My Anime Hub

Anime discovery and fan community website with a separate administrator portal.

## Supabase project
- Project: `anime hub`
- Project ref: `nsvrtvpbvrcsitjhcsuh`
- Frontend Supabase URL and publishable key are configured in `kokushibo-supabase-site/supabase-config.js`.
- Database schema includes catalogue, profiles, public rooms/chat, favorites, announcements, reports, site settings, and participant-only private messages.
- Google OAuth is wired in the frontend, but the Google provider must be enabled in Supabase Auth with your Google OAuth Client ID/Secret and the deployed redirect URLs.

## Admin login
Admin username is `admin`. Keep the password and session signing secret in your hosting provider's private environment variables, never in GitHub:
- `ADMIN_USERNAME=admin`
- `ADMIN_PASSWORD` (set privately)
- `ADMIN_SESSION_SECRET` (a random secret at least 32 bytes)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (server-only)

The admin API is implemented as a Vercel Function. Hosting must support server functions; static-only GitHub Pages won't run admin login.

## Deploy
Import this repository into Vercel with the repository root as Root Directory. Set the private environment variables above. For Google login, configure the OAuth provider in Supabase Auth and add your hosting URL to the redirect allow list.
