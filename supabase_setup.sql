-- === Tabela de perfis ===
create table if not exists public.usuarios (
  uid uuid primary key,
  email text,
  full_name text,
  phone text,
  user_type text,
  store_name text,
  cnpj text,
  address text,
  cpf text,
  cnh text,
  vehicle_model text,
  license_plate text,
  selfie_url text,
  doc_front_url text,
  doc_back_url text,
  created_at timestamptz default now()
);

alter table public.usuarios enable row level security;

do \$\$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='usuarios' and policyname='own_row_read') then
    create policy "own_row_read" on public.usuarios for select using (auth.uid() = uid);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='usuarios' and policyname='own_row_write') then
    create policy "own_row_write" on public.usuarios for insert with check (auth.uid() = uid);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='usuarios' and policyname='own_row_update') then
    create policy "own_row_update" on public.usuarios for update using (auth.uid() = uid) with check (auth.uid() = uid);
  end if;
end
\$\$;

-- === Storage: bucket privado user_files ===
insert into storage.buckets (id, public)
values ('user_files', false)
on conflict (id) do nothing;

-- Policies de Storage: permitir ler/escrever apenas no próprio caminho user_files/{uid}/*
do \$\$
begin
  if not exists (
    select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='read_own_files'
  ) then
    create policy "read_own_files" on storage.objects
      for select using (
        bucket_id = 'user_files'
        and auth.role() = 'authenticated'
        and (storage.foldername(name))[1] = 'user_files'
        and (storage.foldername(name))[2] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='write_own_files'
  ) then
    create policy "write_own_files" on storage.objects
      for insert with check (
        bucket_id = 'user_files'
        and auth.role() = 'authenticated'
        and (storage.foldername(name))[1] = 'user_files'
        and (storage.foldername(name))[2] = auth.uid()::text
      );
  end if;
end
\$\$;
