/*
  Supabase connection for Angelico.

  Fill in the two values from Supabase: Project Settings, API.
    url      the Project URL, like https://abcdefghijkl.supabase.co
    anonKey  the "anon public" key (a long string starting with eyJ...)

  Both are safe to publish. The anon key can only do what the database's
  Row Level Security allows (see supabase/schema.sql). NEVER put the
  "service_role" key here.

  While url is empty the site keeps using content/site.json and the admin
  keeps using GitHub.
*/
window.ANGELICO_SUPABASE = {
  url: "https://ietdvaxmupgxmjwncpga.supabase.co",
  anonKey: "sb_publishable_Q-CBl4GeqbtFNojWXgqLsg_Ul8h1g7W"
};
