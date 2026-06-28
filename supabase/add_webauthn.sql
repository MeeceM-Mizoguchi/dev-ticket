-- ============================================================
-- Dev Ticket — 生体認証ログイン (WebAuthn / Passkey) 用テーブル
-- Run this in: Supabase Dashboard → SQL Editor → New query
-- チケット: ENHA2-013 生体認証ログイン
-- ============================================================

-- ── 登録済みクレデンシャル（公開鍵）─────────────────────────────
-- Web (WebAuthn/Passkey) で登録した公開鍵を保持する。
-- ネイティブ(Mac/iPad)はKeychainにSupabaseトークンを保存するため、
-- このテーブルは主にWeb用。
create table if not exists webauthn_credentials (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  credential_id text        not null unique,            -- base64url
  public_key    text        not null,                   -- base64url (COSE公開鍵)
  counter       bigint      not null default 0,
  transports    text[],
  device_label  text,
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create index if not exists idx_webauthn_credentials_user on webauthn_credentials(user_id);

-- ── チャレンジの一時保管 ─────────────────────────────────────
-- options発行 → verify の2リクエスト間でチャレンジを照合するための短命ストア。
-- serverlessはステートレスなのでDBに置く。5分で失効。
create table if not exists webauthn_challenges (
  challenge   text        primary key,                  -- base64url
  expires_at  timestamptz not null default (now() + interval '5 minutes'),
  created_at  timestamptz not null default now()
);

-- ── ネイティブ(Mac/iPad)端末の生体ログイン用シークレット ──────────
-- ネイティブは WebAuthn を使わず、端末固有のシークレットをKeychainに保存し、
-- 生体認証をローカルゲートとして使う。サーバはシークレットのハッシュのみ保持し、
-- 一致すれば magiclink でセッションを発行する（Webと同じセッション確立経路）。
create table if not exists native_biometric_devices (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        not null references auth.users(id) on delete cascade,
  secret_hash  text        not null unique,             -- sha256(secret) base64url
  device_label text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create index if not exists idx_native_biometric_user on native_biometric_devices(user_id);

-- ── RLS ────────────────────────────────────────────────────
-- 検証・発行はService Role（RLSバイパス）のAPI経由でのみ行う。
-- 念のためRLSは有効化し、一般クライアントからは自分の行のみ参照/削除可とする。
alter table webauthn_credentials     enable row level security;
alter table webauthn_challenges      enable row level security;
alter table native_biometric_devices enable row level security;

drop policy if exists "own_select_webauthn_credentials" on webauthn_credentials;
create policy "own_select_webauthn_credentials" on webauthn_credentials
  for select using (auth.uid() = user_id);

drop policy if exists "own_delete_webauthn_credentials" on webauthn_credentials;
create policy "own_delete_webauthn_credentials" on webauthn_credentials
  for delete using (auth.uid() = user_id);

drop policy if exists "own_select_native_biometric" on native_biometric_devices;
create policy "own_select_native_biometric" on native_biometric_devices
  for select using (auth.uid() = user_id);

-- challenges / native_biometric_devices の発行・照合はService Role API専用。
-- RLS有効＋必要最小限のポリシーのみ = anon/authenticated からは実質書込不可。
