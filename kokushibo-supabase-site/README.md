# KOKUSHIBO Anime Universe — website source

The public website is served from this directory. Admin credentials are verified by the Vercel serverless API in the repository root at `/api/admin/[...route].js`.

Do not place the real admin email, password, session signing secret, or Supabase service-role key in files in this directory. Configure them as private Vercel Environment Variables. See the repository-root README for complete deployment steps.

Supabase is still used for the member-facing Google login and as the database. The admin password itself is not stored in Supabase Auth.
