CREATE TABLE testnet_wallet_challenges (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  address text NOT NULL,
  xdr text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed boolean NOT NULL DEFAULT false
);
CREATE TABLE testnet_wallets (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  address text NOT NULL UNIQUE,
  verified_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE testnet_escrows (
  project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  agreement_version integer NOT NULL,
  client_address text NOT NULL,
  freelancer_address text NOT NULL,
  token_contract text NOT NULL,
  wasm_hash text NOT NULL,
  amount_base_units text NOT NULL,
  terms_hash text NOT NULL,
  contract_id text,
  chain_state jsonb,
  checked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(project_id,agreement_version) REFERENCES agreement_versions(project_id,version)
);
CREATE TABLE testnet_intents (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL CHECK(action IN ('deploy','accept','faucet','fund','release','refund')),
  xdr text NOT NULL,
  hash text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','submitted','confirmed','failed','expired')),
  expires_at bigint NOT NULL,
  min_ledger bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX testnet_one_pending_intent ON testnet_intents(project_id) WHERE state IN ('prepared','submitted');
