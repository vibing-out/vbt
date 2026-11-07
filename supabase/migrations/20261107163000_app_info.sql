-- One public, read-only row the hello-world page reads (T-01), proving the app reaches the product
-- database before T-04 adds the real schema. Holds no voter data.
create table public.app_info (
  key text primary key,
  value text not null
);

insert into public.app_info (key, value) values ('greeting', 'Hello, VBT');

alter table public.app_info enable row level security;

create policy app_info_public_read on public.app_info for select to anon, authenticated using (true);

revoke all on public.app_info from anon, authenticated;
grant select on public.app_info to anon, authenticated;
