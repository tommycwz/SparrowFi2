/**
 * Supabase project connection details for the optional Cloud Backup
 * feature. This is the ONLY place in the app that names an external
 * service - everything else in SparrowFi runs fully offline.
 *
 * The anon/public key is safe to ship in client code; it has no special
 * privileges by itself. Every table is scoped to `auth.uid()` via Row
 * Level Security (see `supabase/schema.sql`), so this key only ever grants
 * access to whichever user is currently signed in.
 *
 * To set up: create a Supabase project, then replace the two values below
 * with Settings -> API -> Project URL / anon public key.
 */
export const SUPABASE_URL = 'https://hwarfnobptxwrcqpdlwt.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imh3YXJmbm9icHR4d3JjcXBkbHd0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg5NTE3MDEsImV4cCI6MjEwNDUyNzcwMX0.tWp4ywfgpilKjhLfep2br-xyyyJeNY37a9VRIAIsFYI';

/** True once the two values above have been filled in with a real project.
 * Checked against the *shape* of the un-set placeholders (rather than
 * comparing the two constants to each other, which broke this check
 * entirely once both were edited to the same real values) so Cloud Backup
 * UI can show a "not set up yet" state instead of attempting network calls
 * against a project that doesn't exist. */
export const SUPABASE_CONFIGURED =
  !SUPABASE_URL.includes('YOUR-PROJECT-REF') && !SUPABASE_ANON_KEY.includes('YOUR-ANON-PUBLIC-KEY');

/**
 * Cloud Backup sign-in is a plain username + password, checked against a
 * `app_users` table via Postgres functions (see `supabase/schema.sql`) -
 * it does NOT use Supabase Auth at all. Two earlier approaches were tried
 * and abandoned: mapping a username to a synthetic email domain (Supabase
 * rejects fake domains outright as invalid), and using real email
 * addresses (Supabase's shared default email service has a very low
 * send-rate limit - about 2/hour - that ordinary testing kept tripping).
 * A username/password table sidesteps both: no email is ever sent, so
 * there's no rate limit to hit and no address to validate.
 *
 * `@supabase/supabase-js` is still used here, but only as a thin client
 * for calling those Postgres functions (`.rpc(...)`) - its `.auth` module
 * is never touched. See `cloud-auth.service.ts` for the actual login
 * logic and `supabase/schema.sql` for the database side.
 */
