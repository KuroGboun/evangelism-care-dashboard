// Public project settings. The anon key is meant to be shipped to browsers:
// every read still goes through row-level security and an admin-only RPC.
// The two placeholders are replaced with the real public values before deploy.
export const SUPABASE_URL = 'https://lgwzxzqnwyuvhvecwcty.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_xTpYJS01aHlEJ8jSDbcF7A_peLu60Jy';
// The one account this dashboard signs in as. Whoever opens the page types only
// the password; this address is not a secret, never receives mail (the user is
// created with Auto Confirm), and must match the Supabase user exactly.
export const DASHBOARD_EMAIL = 'pastor@evangelismcare.app';
export const MINISTRY_NAME = 'Evangelism Care';
export const POLL_MS = 60_000;
export const SPEND_REFRESH_MIN_MS = 600_000;
