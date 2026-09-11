# Evangelism Care: Ministry Overview

The live dashboard for the church pastor.

A single read-only web page that shows the church pastor how the Evangelism Care
ministry is doing: people in care, how many are past due, the journey from new
to connected member, campuses, conversations, the team, open prayer requests,
and what the ministry phone number costs. It shows counts and trends, not the
list of who is waiting — that belongs in the app, where a carer can act on it.

It is plain HTML, CSS, and JavaScript modules. There is no build step and nothing
to install.

## How the data stays private

- **A password is required.** The page asks for one password and nothing else. It
  signs in as the single account named by `DASHBOARD_EMAIL` in `config.js`, reads
  that account's own row in `profiles`, and only continues for an active account
  with `role = 'admin'`. Supabase checks the password, never this page, so copying
  or editing the page gets nobody in.
- **The password is shared, so treat it as a key.** Everyone who has it sees the
  same figures, including people's names and prayer requests. It is never written
  down in this repository — changing it is one step in the Supabase dashboard
  (below) and needs no redeploy.
- **One data source.** Every figure comes from a single database function,
  `ministry_dashboard`, which checks on the server that the caller is an admin and
  refuses everyone else. The page never queries tables directly, so even a
  modified copy of this page cannot read more than an admin is allowed to.
- **Row-level security still applies** to the profile lookup and the live-update
  subscription.
- **The anon key in `config.js` is public by design.** Supabase anon keys are meant
  to ship to browsers; they grant nothing beyond what row-level security and the
  admin-only function allow. No service-role key or other secret belongs here.
- **Search engines are told to stay away** (`robots.txt`, `noindex` meta tag), and
  a Content Security Policy limits what the page may load or connect to.
- Names and prayer requests are written to the page as plain text, never as HTML.

## Run it locally

```sh
cd evangelism-care-dashboard
python3 -m http.server 8080
```

- http://localhost:8080/ is the real dashboard (needs the real values in `config.js`).
- http://localhost:8080/?demo=1 shows made-up figures with no sign-in, so the layout
  can be checked. Demo mode only works on `localhost` or `127.0.0.1`.
  Add `&state=empty`, `loading`, `stale`, `missing`, `error`, or `offline` to see
  those states.

## Deploy

GitHub Pages, from the `main` branch root:

1. Put the real Supabase project URL and anon key into `config.js`.
2. Push to `main`.
3. In the repository: Settings, Pages, Build and deployment, "Deploy from a branch",
   branch `main`, folder `/ (root)`.

`.nojekyll` makes Pages serve the files as they are.

## Create the dashboard account

The page signs in as one account. Its address is typed only here, in `config.js`;
whoever opens the page types just the password.

1. Supabase dashboard: Authentication, Users, **Add user**, Create new user. Use
   exactly the address in `DASHBOARD_EMAIL` (`pastor@evangelismcare.app`), set the
   password you intend to share, and tick **Auto Confirm User**. No mail is ever
   sent to that address, so it does not have to be a real mailbox.
2. In the SQL editor, give that account an admin profile:

   ```sql
   insert into public.profiles (id, name, email, role, active, campus)
   select id, 'Pastor', email, 'admin', true, 'Church'
   from auth.users
   where email = 'pastor@evangelismcare.app'
   on conflict (id) do nothing;
   ```

3. Send the pastor the page address and the password privately. Keep the password
   out of this repository — it is public.

**To change the password**, set a new one on that user under Authentication,
Users. The page needs no change. **To take access away entirely**, set
`active = false` (or change `role`) on that profile, for example from the app's
Members tab; the page notices on its next refresh and signs itself out.

## What the Supabase project needs

- `public.ministry_dashboard(p_window text)` returning the JSON described in the
  data contract, with `p_window` one of `week`, `month`, `90d`, `all`. Until it
  exists the page says the data source isn't set up yet.
- The `telnyx-costs` Edge Function, which the "Refresh spend" button calls (at most
  once every 10 minutes from a browser).
- For instant updates, `public.messages` and `public.calls` in the
  `supabase_realtime` publication. Without that, figures still refresh every minute.

## Files

| File | What it does |
|---|---|
| `index.html` | Sign-in view and dashboard view |
| `styles.css` | Colours, type, layout, dark mode, print |
| `theme.js` | The light/dark button; light by default, remembered per browser |
| `config.js` | Supabase URL, anon key, dashboard account, refresh timings |
| `app.js` | Starts the page and wires everything together |
| `auth.js` | Sign-in, the admin check, sign-out |
| `data.js` | Calls `ministry_dashboard` and `telnyx-costs`, polling, live updates |
| `render.js` | Draws every section and chart |
| `format.js` | Numbers, money, times, and dates in plain English |
| `demo.js` | Made-up figures for `?demo=1` on localhost |
