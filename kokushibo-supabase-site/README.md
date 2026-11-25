# KOKUSHIBO Anime Universe — Supabase-ready website bundle

## Included files

- `index.html` — public animated anime discovery and fan community site.
- `admin.html` — separate admin portal.
- `supabase-config.js` — public Supabase URL and publishable key placeholders.
- `supabase-client.js` — pinned Supabase JS client.
- `index-supabase.js` — Google sign-in, profile sync, shared chat, announcements and public site settings.
- `admin.js` — allowlisted admin dashboard for catalogue, manga/manhwa, image uploads, announcements, moderation, members and settings.
- `supabase/schema.sql` — database schema, Row Level Security, Storage and Realtime setup.

## Configure Supabase

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL Editor.
3. Replace `url` and `publishableKey` in `supabase-config.js` with the project's Project URL and publishable key. Never put a service-role or secret key in browser code.
4. Enable Google in Supabase Authentication → Sign-in Providers. Configure a Google OAuth Web client and add the Supabase callback URL shown by Supabase to Google's Authorized redirect URIs.
5. Add your HTTPS site URL to Supabase Authentication → URL Configuration and Google's Authorized JavaScript origins.
6. Host this directory on an HTTPS web host. Do not open it directly with a `file://` URL; ES modules and OAuth require a served origin.
7. Members use Google sign-in from `index.html`.
8. Create a separate email/password user for the administrator in Supabase Authentication → Users.
9. In the SQL Editor, execute the bootstrap query below with that admin's exact email address:
   ```sql
   insert into public.admin_users(user_id)
   select id from auth.users
   where lower(email) = lower('YOUR_ADMIN_EMAIL@gmail.com')
   on conflict do nothing;
   ```
10. Administrators sign in at `admin.html` with that email and the password configured in Supabase Auth.

## Security model

- Regular members authenticate with Google OAuth.
- The admin portal uses Supabase Auth email/password sign-in and then checks the protected `public.admin_users` allowlist.
- The admin password is not embedded in source code.
- The browser uses only the Supabase publishable key. Never expose service-role keys, secret keys, database passwords, or Google OAuth client secrets in this repository.
- Row Level Security policies limit admin data changes to allowlisted admin accounts.
- Use a strong, unique administrator password; do not use a short numeric password in production.

## Catalogue notes

- Anime and character discovery uses the AniList GraphQL API.
- Manga and manhwa are queried separately by country of origin (JP for manga, KR for manhwa).
- The Manga/Manhwa normalizer is included; this is a live online catalogue, not a static dump of every published title.
- Only artwork you have rights or permission to display should be hosted.

## Current state

The source code has been uploaded, but the Supabase project URL/key and Google OAuth provider still need to be configured before live authentication, shared chat and admin data operations can work.
