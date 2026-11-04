// Shared online highscores (optional).
// Leave this empty to keep highscores on each player's own computer.
// To share them: create a free Supabase project, run the SQL below in its SQL editor,
// then fill in your project URL and the public "anon" key (Project Settings -> API) and uncomment:
//
// window.HS_CONFIG = { url: 'https://YOUR-PROJECT.supabase.co', key: 'YOUR-ANON-PUBLIC-KEY' };
//
// ---- SQL ----
// create table scores (
//   id bigint generated always as identity primary key,
//   created_at timestamptz default now(),
//   name text not null check (char_length(name) between 1 and 16),
//   hero text, damage bigint check (damage >= 0), pops bigint check (pops >= 0),
//   cash bigint check (cash >= 0), loops int check (loops between 0 and 1000), level int check (level between 1 and 2000),
//   data jsonb check (pg_column_size(data) < 20000)
// );
// alter table scores enable row level security;
// create policy "anyone can read" on scores for select using (true);
// create policy "anyone can submit" on scores for insert with check (true);
