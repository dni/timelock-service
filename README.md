# Timelock Service

NIP-600 fidelity bond certificate service.

This service sells encrypted fidelity bond certificates backed by Bitcoin
timelocked UTXOs. It exposes a FastAPI API for listing bond tiers, creating
Lightning invoices through LNbits, monitoring funded bond pools, and releasing
certificate material after payment.

## What It Does

- Derives BIP46 timelocked P2WSH addresses from a service HD wallet.
- Groups funded timelocked UTXOs into reusable bond pools.
- Lets admins create tiers and pools, then fund or record pool UTXOs.
- Lets users request a certificate slot for a Nostr public key.
- Creates an LNbits invoice with a custom Lightning preimage.
- Encrypts certificate data with AES-256-GCM using that preimage as the key.
- Marks orders paid from an LNbits webhook and then exposes the encrypted
  certificate for client-side decryption.

The encrypted certificate can be delivered together with the invoice because
only the payer receives the Lightning payment preimage needed to decrypt it. The
service does not sign or publish Nostr events for users. After payment, the user
copies the Lightning payment preimage from their wallet into the browser. The
browser decrypts the returned certificate material locally, then the user can
publish their own NIP-600 event.

## Repository Layout

```text
app/
  main.py              FastAPI app, routing, startup jobs
  config.py            Environment-based settings
  database.py          Async SQLAlchemy engine/session setup
  models.py            SQLAlchemy models and order/pool states
  repository.py        Database access layer
  endpoints/           Public, admin, and webhook HTTP routes
  services/            Bond orchestration plus LNbits, Bitcoin RPC, and electrs clients
  crypto/              BIP46, certificate signing, AES, and Nostr helpers
tests/                 BIP46, certificate, AES, and Nostr helper tests
Dockerfile             uv-based Python 3.12 image
docker-compose.yml     Single-service compose setup with persistent ./data
pyproject.toml         Python project metadata and dependencies
```

## Requirements

- Python 3.12+
- `uv`
- SQLite by default, or any SQLAlchemy async database URL you configure
- LNbits wallet with invoice API access
- Bitcoin Core wallet RPC, if using automatic pool funding
- Electrs/Esplora-compatible HTTP endpoint for UTXO discovery and confirmation

## Configuration

Configuration is loaded from environment variables and `.env`.

```env
BIP46_XPRV=xprv...
BIP46_XPUB=xpub...

LNBITS_URL=https://lnbits.example.com
LNBITS_INVOICE_KEY=...
LNBITS_WEBHOOK_SECRET=...

BITCOIN_RPC_URL=http://127.0.0.1:8332
BITCOIN_RPC_USER=...
BITCOIN_RPC_PASSWORD=...
BITCOIN_RPC_WALLET=timelock

ELECTRS_URL=https://mempool.space/api

ADMIN_API_KEY=change-me
PREIMAGE_ENCRYPTION_KEY=64_hex_chars_for_32_bytes

DATABASE_URL=sqlite+aiosqlite:///./data/timelock.db
DEFAULT_FEE_RATE=0.10
INVOICE_EXPIRY_SECONDS=3600
MIN_BOND_SATS=100000
UTXO_MIN_CONFIRMATIONS=1
SERVICE_BASE_URL=https://timelock.example.com
```

Important notes:

- `BITCOIN_RPC_*` settings are only required when using the admin auto-funding
  endpoint. Pools can still be funded externally and recorded with
  `/record-utxo`.
- `PREIMAGE_ENCRYPTION_KEY` must be 64 hex characters. It is used to encrypt
  stored Lightning preimages at rest.
- `SERVICE_BASE_URL` is used to build the LNbits payment webhook URL:
  `/api/v1/webhook/payment`.
- The default database path writes to `./data/timelock.db`.
- The app creates tables on startup. There are no migrations in this repo yet.

## Local Development

Install dependencies:

```bash
uv sync --extra dev
```

Run the API:

```bash
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Check health:

```bash
curl http://localhost:8000/health
```

Interactive API docs are available at:

```text
http://localhost:8000/docs
```

## Docker

Build and run with compose:

```bash
docker compose up --build
```

The compose file publishes the service on host port `8001` and stores the
SQLite database under `./data`.

```bash
curl http://localhost:8001/health
```

## API Overview

### Public Endpoints

List active tiers and available slots:

```bash
curl http://localhost:8000/api/v1/tiers
```

Create a bond order:

```bash
curl -X POST http://localhost:8000/api/v1/bond/request \
  -H 'Content-Type: application/json' \
  -d '{
    "tier_id": "tier-uuid",
    "npub": "npub1..."
  }'
```

The response includes:

- `invoice`: Lightning invoice to pay.
- `lnurl`: bech32-encoded LNURL-pay link for wallets that support LNURL.
- `lnurl_pay_url`: raw LNURL-pay endpoint URL.
- `lightning_address`: Lightning-address-style identifier for this order, when
  `SERVICE_BASE_URL` has a host.
- `payment_hash`: LNbits payment hash/checking ID.
- `encrypted_cert` and `cert_nonce`: encrypted certificate material delivered
  with the invoice. It is safe to expose before payment because the decryption
  key is the Lightning payment preimage.
- `timelocked_address` and `bond_expiry`: bond pool address and expiry.

Poll order status:

```bash
curl http://localhost:8000/api/v1/bond/order-uuid
```

When `state` is `PAID`, the browser should ask the user for the Lightning
payment preimage from their wallet. Decrypt `encrypted_cert` locally with
AES-256-GCM using that preimage as the 32-byte key and `cert_nonce` as the
nonce.

The decrypted payload contains the fields needed to assemble the NIP-600 event,
including `bond_sig`, `xpub`, `utxo`, `timelock_index`, and `expiry`. The user
then signs and publishes that event with their own Nostr key.

## LNURL Delivery

A bond can also be exposed as an LNURL-pay link or Lightning address flow. In
that model, the wallet pays the order invoice through an LNURL callback and
receives the encrypted certificate through a LUD-10 `successAction`.

The service exposes:

```text
GET /api/v1/lnurlp/{order_id}
GET /.well-known/lnurlp/{order_id}
GET /api/v1/lnurlp/{order_id}/callback?amount={msat}
```

The bond response includes both a bech32 `lnurl` value and the raw
`lnurl_pay_url`. The first two endpoints above return a fixed-amount LNURL
`payRequest`. The callback validates the amount, returns the order invoice as
`pr`, and includes a LUD-10 `successAction` containing the encrypted
certificate.

For LNURL/LUD-10 interoperability, the success action should use:

- `tag: "aes"`
- `description`: short text shown by the wallet
- `ciphertext`: encrypted certificate payload
- `iv`: base64 initialization vector

LUD-10 specifies AES-256-CBC with PKCS padding and the payment preimage as the
key. The LNURL callback implements that format. The direct browser JSON API
still uses AES-256-GCM and returns `encrypted_cert` plus `cert_nonce`.

### Admin Endpoints

Admin endpoints require:

```text
X-Admin-Key: $ADMIN_API_KEY
```

Create a tier:

```bash
curl -X POST http://localhost:8000/api/v1/admin/tiers \
  -H "X-Admin-Key: $ADMIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "12 month",
    "description": "12 month fidelity bond",
    "max_slots": 10,
    "bond_sats": 1000000,
    "timelock_duration_months": 12,
    "fee_rate": 0.10
  }'
```

Create a pool for a tier:

```bash
curl -X POST http://localhost:8000/api/v1/admin/pools \
  -H "X-Admin-Key: $ADMIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "tier_id": "tier-uuid",
    "fund_via_bitcoin_rpc": false
  }'
```

If `timelock_index` is omitted, the service picks the next BIP46 index whose
expiry is at least `timelock_duration_months` in the future.

Fund an existing pool through the configured Bitcoin Core wallet:

```bash
curl -X POST http://localhost:8000/api/v1/admin/pools/pool-uuid/fund \
  -H "X-Admin-Key: $ADMIN_API_KEY"
```

Record a pool UTXO manually:

```bash
curl -X POST http://localhost:8000/api/v1/admin/pools/pool-uuid/record-utxo \
  -H "X-Admin-Key: $ADMIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "txid": "txid",
    "vout": 0,
    "sats": 1000000
  }'
```

List pools:

```bash
curl http://localhost:8000/api/v1/admin/pools \
  -H "X-Admin-Key: $ADMIN_API_KEY"
```

List orders:

```bash
curl http://localhost:8000/api/v1/admin/orders \
  -H "X-Admin-Key: $ADMIN_API_KEY"
```

## Webhooks

LNbits should call:

```text
POST /api/v1/webhook/payment
X-Api-Key: $LNBITS_WEBHOOK_SECRET
```

The JSON body must include either `payment_hash` or `checking_id`. On receipt,
the service schedules background handling that transitions the matching order
from `PENDING_PAYMENT` to `PAID`.

## Lifecycle

1. Admin creates a tier.
2. Admin creates a pool for that tier.
3. Pool is funded to its derived BIP46 timelocked address.
4. The background pool monitor finds/confirms the UTXO through electrs and marks
   the pool `AVAILABLE`.
5. User requests a bond order for a tier and Nostr pubkey.
6. Service reserves one pool slot, signs certificate data, encrypts it with the
   generated LN preimage, and returns an invoice with the encrypted certificate.
   It also returns an LNURL-pay URL and Lightning-address-style identifier for
   wallets that prefer that flow.
7. User pays the invoice.
8. LNbits webhook marks the order `PAID`.
9. User polls order status and receives `encrypted_cert` plus `cert_nonce`.
10. Browser asks the user to paste the Lightning payment preimage from their
    wallet.
11. Browser decrypts the certificate locally and uses the decrypted fields to
    assemble the NIP-600 event.
12. User signs and publishes the NIP-600 event with their own Nostr key.

Pending orders expire after `INVOICE_EXPIRY_SECONDS`; the expiry job marks them
`EXPIRED` and returns the reserved slot to the pool.

## States

Pool states:

- `PENDING_FUNDING`: pool exists but the backing UTXO is not confirmed yet.
- `AVAILABLE`: pool has confirmed funds and can sell slots.
- `FULL`: all slots are reserved or sold.
- `EXPIRED`: defined in the model, but not currently transitioned by jobs.

Order states:

- `PENDING_PAYMENT`: invoice created and slot reserved.
- `PAID`: payment confirmed and encrypted certificate is available.
- `EXPIRED`: invoice expired before payment and slot was released.

## Testing

Run the test suite:

```bash
uv run pytest
```

The current tests cover BIP46 timestamp/script helpers, certificate message
formatting, Bitcoin-message hash behavior, certificate signature format,
AES-GCM certificate encryption, and Nostr pubkey normalization. Some reference
vector tests are placeholders and are skipped until TypeScript reference values
are filled in.

## Security Notes

- Keep `BIP46_XPRV`, `PREIMAGE_ENCRYPTION_KEY`, LNbits keys, Bitcoin RPC
  credentials, and `ADMIN_API_KEY` secret.
- Back up the database and the HD wallet material together. Existing encrypted
  preimages require `PREIMAGE_ENCRYPTION_KEY` to recover.
- Restrict Bitcoin RPC access to trusted hosts only. The configured wallet can
  send funds to timelock pool addresses.
- CORS currently allows all origins.
- Admin authentication is a static header key.

## Implementation Notes

- BIP46 indexes map month-by-month from January 2020 at index `0` through
  December 2099 at index `959`.
- The derivation path for service private signing is `m/84h/0h/0h/2/{index}`.
- Public verification derives from the account xpub at `m/2/{index}`.
- Certificates are signed over:

```text
fidelity-bond-cert|{npub_hex}|{expiry}
```

- Certificate payloads contain `bond_sig`, `xpub`, `utxo`, `timelock_index`,
  and `expiry`.
