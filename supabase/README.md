# Supabase setup for Angelico

Supabase stores everything the site needs from a server:

| What | Where |
|---|---|
| Live site content (all text, products, collections) | table `site_content` |
| Every publish, so you can restore old versions | table `site_versions` |
| Appointment requests from the website form | table `appointments` |
| Uploaded product photos | Storage bucket `media` |
| Admin sign in | Supabase Auth (email and password) |

Publishing is instant: the public site reads the content straight from Supabase.
If Supabase is ever unreachable, the site falls back to `content/site.json` so it
never goes blank.

## One time setup (about 10 minutes)

### 1. Create the project
1. Go to https://supabase.com, sign in, **New project**.
2. Name it `angelico`, choose a region close to your customers, set a strong database password (save it somewhere safe), **Create**.
3. Wait about two minutes until it finishes setting up.

### 2. Create the tables and rules
1. In the dashboard open **SQL Editor**, **New query**.
2. Open `supabase/schema.sql` from this repository, copy everything, paste it, **Run**.
3. It should finish with "Success. No rows returned". You can run it again any time safely.

### 3. Turn off public sign ups
Only you should be able to create accounts.
1. **Authentication**, **Sign In / Providers** (older dashboards: **Settings**).
2. Under **Email**, switch **Allow new users to sign up** OFF. Save.

### 4. Create your admin account
1. **Authentication**, **Users**, **Add user**, **Create new user**.
2. Enter your email and a strong password. Tick **Auto Confirm User**. Create.
3. Back in **SQL Editor**, run this with your email:
   ```sql
   insert into public.admin_users (user_id)
   select id from auth.users where email = 'you@example.com';
   ```
   For a second admin, repeat steps 1 to 3 with their email.

### 5. Connect the site
1. **Project Settings**, **API**.
2. Copy the **Project URL** and the **publishable** key (`sb_publishable_...`). The older **anon public** key (`eyJ...`) works too.
3. Paste them into `js/supabase-config.js`:
   ```js
   window.ANGELICO_SUPABASE = {
     url: "https://abcdefghijkl.supabase.co",
     anonKey: "eyJhbGciOi..."
   };
   ```
   Both values are safe to publish. **Never** use the `service_role` key anywhere in this repository.
4. Deploy the site files as usual.

### 6. First sign in
Open `/admin/`, sign in with the account from step 4. Nothing is published in
Supabase yet, so the admin loads the starter content from `content/site.json` and
marks it unpublished. Press **Publish** once to put it live.

## Day to day
* **Edit and publish** in `/admin/`. Changes are live instantly.
* **Requests** in the admin menu shows appointment requests. Set a status, add private notes, or download a CSV.
* **Photos** you upload go to Storage. The site's original photos stay in the repository.
* **Restore** any earlier version from the dashboard history.

## Security model
The public (anon) key can only:
* read the published content,
* view public photos,
* submit an appointment request (name, email, interest, date, language only).

Everything else needs a signed in account listed in `admin_users`. There is no way to become an admin through the API, only through the SQL Editor. This was tested against a real PostgreSQL: visitors and ordinary signed in users cannot read requests, edit content, upload photos, or grant themselves admin.

## Good to know
* **Free projects pause after about a week without activity.** While paused, the site shows the fallback copy in `content/site.json` (possibly older than your last publish) and appointment requests fail until you resume the project from the dashboard. Visiting the admin or the site regularly keeps it awake, or upgrade to a paid plan for a live business.
* **Keep a fresh fallback.** In the admin, Settings, **Download content backup**, then replace `content/site.json` in the repository now and then.
* **Spam.** The form has a hidden trap field and database limits, but no CAPTCHA. If spam appears, add Cloudflare Turnstile or similar.
* **Email alerts** for new requests are not built in. Supabase can send them with a Database Webhook plus an Edge Function or a service such as Resend, if you want that later.
* **Backups.** Paid plans include daily database backups. On the free plan, download content backups yourself.
