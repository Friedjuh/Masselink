create extension if not exists pgcrypto;

create table if not exists public.app_settings (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.customers (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  company_name text not null default '',
  contact_name text not null default '',
  email text not null default '',
  phone text not null default '',
  vat_number text not null default '',
  address_line1 text not null default '',
  postal_code text not null default '',
  city text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists customers_owner_id_idx on public.customers (owner_id);

create table if not exists public.projects (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  customer_id text not null references public.customers (id) on delete cascade,
  project_number text not null default '',
  project_name text not null default '',
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists projects_owner_id_idx on public.projects (owner_id);
create index if not exists projects_customer_id_idx on public.projects (customer_id);

create table if not exists public.invoice_drafts (
  owner_id uuid primary key references auth.users (id) on delete cascade,
  draft jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.invoices (
  id text primary key,
  owner_id uuid not null references auth.users (id) on delete cascade,
  customer_id text references public.customers (id) on delete set null,
  customer_name text not null default '',
  customer_email text not null default '',
  invoice_number text not null,
  invoice_date date not null,
  project_labels jsonb not null default '[]'::jsonb,
  status text not null default 'verzonden' check (status in ('verzonden', 'betaald')),
  revision integer not null default 1,
  total_amount numeric(12, 2) not null default 0,
  last_pdf_at timestamptz,
  snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.invoices
drop constraint if exists invoices_status_check;

alter table public.invoices
add constraint invoices_status_check
check (status in ('verzonden', 'betaald'));

create index if not exists invoices_owner_id_idx on public.invoices (owner_id);
create unique index if not exists invoices_owner_invoice_number_unique
on public.invoices (owner_id, invoice_number);

update public.invoices
set status = 'verzonden'
where status not in ('verzonden', 'betaald');

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

drop trigger if exists customers_touch_updated_at on public.customers;
create trigger customers_touch_updated_at
before update on public.customers
for each row
execute procedure public.touch_updated_at();

drop trigger if exists projects_touch_updated_at on public.projects;
create trigger projects_touch_updated_at
before update on public.projects
for each row
execute procedure public.touch_updated_at();

drop trigger if exists app_settings_touch_updated_at on public.app_settings;
create trigger app_settings_touch_updated_at
before update on public.app_settings
for each row
execute procedure public.touch_updated_at();

drop trigger if exists invoice_drafts_touch_updated_at on public.invoice_drafts;
create trigger invoice_drafts_touch_updated_at
before update on public.invoice_drafts
for each row
execute procedure public.touch_updated_at();

drop trigger if exists invoices_touch_updated_at on public.invoices;
create trigger invoices_touch_updated_at
before update on public.invoices
for each row
execute procedure public.touch_updated_at();

alter table public.app_settings enable row level security;
alter table public.customers enable row level security;
alter table public.projects enable row level security;
alter table public.invoice_drafts enable row level security;
alter table public.invoices enable row level security;

drop policy if exists app_settings_select_own on public.app_settings;
create policy app_settings_select_own
on public.app_settings
for select
using (auth.uid() = owner_id);

drop policy if exists app_settings_insert_own on public.app_settings;
create policy app_settings_insert_own
on public.app_settings
for insert
with check (auth.uid() = owner_id);

drop policy if exists app_settings_update_own on public.app_settings;
create policy app_settings_update_own
on public.app_settings
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists app_settings_delete_own on public.app_settings;
create policy app_settings_delete_own
on public.app_settings
for delete
using (auth.uid() = owner_id);

drop policy if exists customers_select_own on public.customers;
create policy customers_select_own
on public.customers
for select
using (auth.uid() = owner_id);

drop policy if exists customers_insert_own on public.customers;
create policy customers_insert_own
on public.customers
for insert
with check (auth.uid() = owner_id);

drop policy if exists customers_update_own on public.customers;
create policy customers_update_own
on public.customers
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists customers_delete_own on public.customers;
create policy customers_delete_own
on public.customers
for delete
using (auth.uid() = owner_id);

drop policy if exists projects_select_own on public.projects;
create policy projects_select_own
on public.projects
for select
using (auth.uid() = owner_id);

drop policy if exists projects_insert_own on public.projects;
create policy projects_insert_own
on public.projects
for insert
with check (auth.uid() = owner_id);

drop policy if exists projects_update_own on public.projects;
create policy projects_update_own
on public.projects
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists projects_delete_own on public.projects;
create policy projects_delete_own
on public.projects
for delete
using (auth.uid() = owner_id);

drop policy if exists invoice_drafts_select_own on public.invoice_drafts;
create policy invoice_drafts_select_own
on public.invoice_drafts
for select
using (auth.uid() = owner_id);

drop policy if exists invoice_drafts_insert_own on public.invoice_drafts;
create policy invoice_drafts_insert_own
on public.invoice_drafts
for insert
with check (auth.uid() = owner_id);

drop policy if exists invoice_drafts_update_own on public.invoice_drafts;
create policy invoice_drafts_update_own
on public.invoice_drafts
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists invoice_drafts_delete_own on public.invoice_drafts;
create policy invoice_drafts_delete_own
on public.invoice_drafts
for delete
using (auth.uid() = owner_id);

drop policy if exists invoices_select_own on public.invoices;
create policy invoices_select_own
on public.invoices
for select
using (auth.uid() = owner_id);

drop policy if exists invoices_insert_own on public.invoices;
create policy invoices_insert_own
on public.invoices
for insert
with check (auth.uid() = owner_id);

drop policy if exists invoices_update_own on public.invoices;
create policy invoices_update_own
on public.invoices
for update
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists invoices_delete_own on public.invoices;
create policy invoices_delete_own
on public.invoices
for delete
using (auth.uid() = owner_id);
