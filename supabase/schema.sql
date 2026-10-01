-- =============================================================================
-- Padaria Tech - schema do banco (Supabase/Postgres)
-- =============================================================================
-- Reconstruido a partir das consultas em backend/main.py apos o projeto
-- Supabase original ser apagado pela politica de inatividade do plano free.
-- Mantenha este arquivo atualizado: recriar o banco deve ser rodar um script,
-- nao redescobrir o schema lendo o codigo.
--
-- Como aplicar num projeto novo:
--   psql "$DATABASE_URL" -f supabase/schema.sql
--   ou colar no SQL Editor do painel do Supabase.
--
-- Isolamento: cada linha pertence ao usuario que a criou (user_id com default
-- auth.uid()). O backend autentica o cliente PostgREST com o token do usuario
-- (ver get_db em backend/main.py), entao o RLS resolve a separacao sozinho e o
-- codigo da aplicacao nunca precisa enviar user_id.
-- =============================================================================

-- ---------------------------------------------------------------- produtos --
create table if not exists public.produtos (
  id            bigint generated always as identity primary key,
  nome          text        not null,
  preco         numeric(10,2) not null check (preco >= 0),
  estoque       integer     not null default 0,
  validade      date,
  codigo_barras text,
  user_id       uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now()
);

comment on table public.produtos is
  'Catalogo da padaria: preco de venda, estoque e validade. Alimentado a mao ou pela importacao de NF-e (XML) / PDF via Gemini, que ja aplica a margem.';

-- A busca por codigo de barras e o caminho quente do PDV (leitor bipando).
create index if not exists produtos_codigo_barras_idx
  on public.produtos (user_id, codigo_barras) where codigo_barras is not null;

-- ----------------------------------------------------------- sessoes_caixa --
-- Criada antes de pedidos: pedidos referencia sessao_id.
create table if not exists public.sessoes_caixa (
  id             bigint generated always as identity primary key,
  valor_abertura numeric(10,2) not null default 0,
  status         text        not null default 'aberto' check (status in ('aberto','fechado')),
  abertura       timestamptz not null default now(),
  fechamento     timestamptz,
  total_vendas   numeric(10,2) not null default 0,
  total_dinheiro numeric(10,2) not null default 0,
  total_cartao   numeric(10,2) not null default 0,
  total_pix      numeric(10,2) not null default 0,
  user_id        uuid        not null default auth.uid() references auth.users(id) on delete cascade
);

comment on table public.sessoes_caixa is
  'Turno de caixa: abre com o fundo de troco e acumula o total por forma de pagamento ate o fechamento.';

-- Serve ao /api/caixa/status, que procura a sessao aberta do usuario.
create index if not exists sessoes_caixa_abertas_idx
  on public.sessoes_caixa (user_id, status) where status = 'aberto';

-- ----------------------------------------------------------------- pedidos --
create table if not exists public.pedidos (
  id              bigint generated always as identity primary key,
  produto_id      bigint      not null references public.produtos(id) on delete restrict,
  quantidade      integer     not null check (quantidade > 0),
  valor_total     numeric(10,2) not null,
  forma_pagamento text        check (forma_pagamento in ('dinheiro','cartao','pix')),
  parcelas        integer     not null default 1 check (parcelas >= 1),
  sessao_id       bigint      references public.sessoes_caixa(id) on delete set null,
  user_id         uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  created_at      timestamptz not null default now()
);

comment on table public.pedidos is
  'Cada item vendido. Uma venda com varios itens vira varias linhas, ligadas pela mesma sessao_id.';

create index if not exists pedidos_sessao_idx  on public.pedidos (user_id, sessao_id);
create index if not exists pedidos_data_idx    on public.pedidos (user_id, created_at desc);

-- ========================================================================= --
-- RLS: cada usuario enxerga e mexe apenas nas proprias linhas.
-- ========================================================================= --
alter table public.produtos      enable row level security;
alter table public.sessoes_caixa enable row level security;
alter table public.pedidos       enable row level security;

do $$
declare t text;
begin
  foreach t in array array['produtos','sessoes_caixa','pedidos'] loop
    execute format('drop policy if exists %I on public.%I', t || '_proprias', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())',
      t || '_proprias', t);
  end loop;
end $$;
