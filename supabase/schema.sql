create extension if not exists pgcrypto;

create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('meta', 'uazapi')),
  name text not null,
  instance_name text,
  site_integration_key uuid not null default gen_random_uuid() unique,
  status text not null default 'disconnected',
  created_at timestamptz not null default now()
);

alter table public.connections add column if not exists site_integration_key uuid not null default gen_random_uuid();
alter table public.connections add column if not exists uazapi_token_cipher text;
alter table public.connections add column if not exists uazapi_token_hash text;
create unique index if not exists connections_site_integration_key_idx on public.connections(site_integration_key);

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  phone text not null,
  source text not null check (source in ('site', 'manual', 'payment')),
  music_request text,
  status text not null default 'waiting_pix',
  provider text,
  connection_id uuid references public.connections(id) on delete set null,
  external_order_id text,
  order_context jsonb not null default '{}'::jsonb,
  kie_task_id text,
  music_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.leads add column if not exists connection_id uuid references public.connections(id) on delete set null;
alter table public.leads add column if not exists external_order_id text;
alter table public.leads add column if not exists order_context jsonb not null default '{}'::jsonb;
-- Uma geração Kie e um pedido externo só podem pertencer a uma execução da conta.
create unique index if not exists leads_kie_task_id_unique_idx on public.leads(kie_task_id) where kie_task_id is not null;
create unique index if not exists leads_owner_external_order_unique_idx on public.leads(owner_id, external_order_id) where external_order_id is not null;

create table if not exists public.flows (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active' check (status in ('active', 'paused')),
  share_code text not null unique default ('FLW-' || upper(replace(gen_random_uuid()::text, '-', ''))),
  nodes jsonb not null default '[]'::jsonb,
  edges jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.connection_flow_configs (
  connection_id uuid primary key references public.connections(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  payment_flow_id uuid references public.flows(id) on delete set null,
  site_flow_id uuid references public.flows(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.flows add column if not exists share_code text;
update public.flows set share_code = 'FLW-' || upper(replace(gen_random_uuid()::text, '-', '')) where share_code is null;
create unique index if not exists flows_share_code_unique_idx on public.flows(share_code);
alter table public.connection_flow_configs add column if not exists conversation_flow_id uuid references public.flows(id) on delete set null;
-- Dois gatilhos de pagamento independentes: prévia pronta ou geração no WhatsEntregavel.
alter table public.connection_flow_configs add column if not exists payment_preview_flow_id uuid references public.flows(id) on delete set null;
alter table public.connection_flow_configs add column if not exists payment_generation_flow_id uuid references public.flows(id) on delete set null;
-- Preserva o comportamento das contas existentes: o fluxo antigo passa a ser o de geração sem prévia.
update public.connection_flow_configs set payment_generation_flow_id = payment_flow_id where payment_generation_flow_id is null and payment_flow_id is not null;

-- Chave estavel por conta. O usuario pode trocar de WhatsApp sem alterar o site.
create table if not exists public.site_integrations (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  integration_key uuid not null default gen_random_uuid() unique,
  connection_id uuid references public.connections(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- As chaves ficam criptografadas pela aplicacao antes de chegar nesta tabela.
-- Nunca grave chaves de API dentro de flows.nodes (o canvas e lido pelo navegador).
create table if not exists public.flow_credentials (
  flow_id uuid primary key references public.flows(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  gpt_key_cipher text,
  kie_key_cipher text,
  updated_at timestamptz not null default now()
);

-- Credenciais da conta: usadas por todos os fluxos do mesmo usuário.
-- Os valores chegam aqui já criptografados pelo backend.
create table if not exists public.account_credentials (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  gpt_key_cipher text,
  kie_key_cipher text,
  efi_client_id_cipher text,
  efi_client_secret_cipher text,
  efi_certificate_p12_cipher text,
  efi_certificate_password_cipher text,
  efi_pix_key_cipher text,
  efi_environment text not null default 'production' check (efi_environment in ('production', 'homologation')),
  updated_at timestamptz not null default now()
);

-- Cobranças Pix dinâmicas da Efi. Cada txid é vinculada a uma única conta,
-- conversa e etapa do fluxo antes do código copia e cola ser enviado.
create table if not exists public.efi_pix_charges (
  txid text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  connection_id uuid not null references public.connections(id) on delete cascade,
  flow_id uuid not null references public.flows(id) on delete cascade,
  node_id text not null,
  amount numeric(12,2),
  status text not null default 'pending' check (status in ('pending','paid','expired','failed')),
  payment_payload jsonb,
  paid_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists efi_pix_charges_pending_idx on public.efi_pix_charges(status, expires_at);

alter table public.connections enable row level security;
alter table public.leads enable row level security;
alter table public.flows enable row level security;
alter table public.connection_flow_configs enable row level security;
alter table public.flow_credentials enable row level security;
alter table public.account_credentials enable row level security;
alter table public.site_integrations enable row level security;
alter table public.efi_pix_charges enable row level security;
drop policy if exists "users access own connections" on public.connections;
drop policy if exists "users access own leads" on public.leads;
drop policy if exists "users access own flows" on public.flows;
drop policy if exists "users access own connection flow configs" on public.connection_flow_configs;
drop policy if exists "users access own flow credentials" on public.flow_credentials;
drop policy if exists "users access own account credentials" on public.account_credentials;
drop policy if exists "users access own site integration" on public.site_integrations;
drop policy if exists "users access own efi pix charges" on public.efi_pix_charges;
create policy "users access own connections" on public.connections for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "users access own leads" on public.leads for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "users access own flows" on public.flows for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "users access own connection flow configs" on public.connection_flow_configs for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "users access own flow credentials" on public.flow_credentials for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "users access own account credentials" on public.account_credentials for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "users access own site integration" on public.site_integrations for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "users access own efi pix charges" on public.efi_pix_charges for select to authenticated using ((select auth.uid()) = owner_id);

-- Modelos criados automaticamente para cada nova conta.
create or replace function public.create_default_flows_for_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.flows (owner_id, name, description, status, nodes, edges)
  values
    (new.id, 'Fluxo Gerar Música KIE', 'Use quando o pagamento aprovado chegar com letra, estilo e voz para gerar a música pela Kie.ai.', 'active',
      jsonb_build_array(
        jsonb_build_object('id','entry','type','builderNode','position',jsonb_build_object('x',40,'y',170),'data',jsonb_build_object('kind','start','title','Entrada','icon','1','tone','violet','description','Início do fluxo','config',jsonb_build_object('trigger','payment'))),
        jsonb_build_object('id','message','type','builderNode','position',jsonb_build_object('x',320,'y',170),'data',jsonb_build_object('kind','message','title','Mensagem','icon','M','tone','blue','description','Envia texto no WhatsApp','config',jsonb_build_object('message','Seu pedido foi confirmado. Estamos finalizando a sua música e enviaremos aqui neste WhatsApp.'))),
        jsonb_build_object('id','music','type','builderNode','position',jsonb_build_object('x',610,'y',170),'data',jsonb_build_object('kind','kie','title','Gerar música','icon','K','tone','pink','description','Envia pedido para Kie.ai','config',jsonb_build_object('model','Suno V5','style','','instrumental',false,'credential','Chave do fluxo'))),
        jsonb_build_object('id','deliver','type','builderNode','position',jsonb_build_object('x',900,'y',170),'data',jsonb_build_object('kind','deliver','title','Entrega gerada','icon','OK','tone','teal','description','Envia as 2 músicas geradas no fluxo','config',jsonb_build_object('intro','Sua música está pronta! Vou enviar as duas faixas em áudio.','tracks',2)))
      ),
      jsonb_build_array(jsonb_build_object('id','entry-message','source','entry','target','message','type','smoothstep','animated',true),jsonb_build_object('id','message-music','source','message','target','music','type','smoothstep','animated',true),jsonb_build_object('id','music-deliver','source','music','target','deliver','type','smoothstep','animated',true))),
    (new.id, 'Fluxo Prévia Pronta', 'Use quando o pagamento aprovado chegar com as duas músicas da prévia já geradas pelo site.', 'active',
      jsonb_build_array(
        jsonb_build_object('id','entry','type','builderNode','position',jsonb_build_object('x',40,'y',170),'data',jsonb_build_object('kind','start','title','Entrada','icon','1','tone','violet','description','Início do fluxo','config',jsonb_build_object('trigger','payment'))),
        jsonb_build_object('id','message','type','builderNode','position',jsonb_build_object('x',320,'y',170),'data',jsonb_build_object('kind','message','title','Mensagem','icon','M','tone','blue','description','Envia texto no WhatsApp','config',jsonb_build_object('message','Seu pagamento foi confirmado. Vou enviar agora a música que você aprovou.'))),
        jsonb_build_object('id','preview-deliver','type','builderNode','position',jsonb_build_object('x',610,'y',170),'data',jsonb_build_object('kind','previewDeliver','title','Enviar música da prévia','icon','PV','tone','teal','description','Entrega a música que o cliente ouviu no site','config',jsonb_build_object('intro','Sua música está pronta! Vou enviar as duas faixas da sua prévia em áudio.','tracks',2)))
      ),
      jsonb_build_array(jsonb_build_object('id','entry-message','source','entry','target','message','type','smoothstep','animated',true),jsonb_build_object('id','message-preview-deliver','source','message','target','preview-deliver','type','smoothstep','animated',true)));
  return new;
end;
$$;

revoke all on function public.create_default_flows_for_user() from public;
revoke execute on function public.create_default_flows_for_user() from anon, authenticated;
drop trigger if exists on_auth_user_created_default_flows on auth.users;
create trigger on_auth_user_created_default_flows after insert on auth.users for each row execute procedure public.create_default_flows_for_user();
