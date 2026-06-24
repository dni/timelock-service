# Timelock Service

NIP-600 fidelity bond certificate service.

This service sells encrypted fidelity bond certificates backed by Bitcoin
timelocked UTXOs. It exposes a FastAPI HTTP API for listing available bonds,
creating Lightning invoices through LNbits, and releasing certificate material
after payment.

## What It Does

- Derives BIP46 timelocked P2WSH addresses from a service HD wallet.
- Lets admins create bonds directly, each backed by a single timelocked UTXO
  with a configurable number of slots.
- Lets users request a certificate slot for a Nostr public key.
- Creates an LNbits invoice using a freshly generated Lightning preimage.
- Encrypts certificate data with AES-256-GCM using that preimage as the key.
- Marks orders paid from an LNbits webhook and exposes the encrypted certificate
  for client-side decryption.

The encrypted certificate is safe to return with the invoice because only the
payer receives the Lightning payment preimage needed to decrypt it. After
payment, the user copies the preimage from their wallet into the browser. The
browser decrypts the certificate locally, then the user can publish their own
NIP-600 event.

## Repository Layout

```text
app/
  main.py              FastAPI app, routing, startup job
  config.py            Environment-based settings
  database.py          Async SQLAlchemy engine/session setup
  models.py            SQLAlchemy models (Bond, BondOrder)
  repository.py        Database access layer
  endpoints/
    admin.py           Admin CRUD for bonds and orders
    bond.py            Public bond request and status endpoints
    tiers.py           Public bond listing endpoint
    lnurl.py           LNURL-pay and Lightning address endpoints
    webhook.py         LNbits payment webhook
  services/
    bond.py            Bond and order orchestration
    lnbits.py          LNbits HTTP client
  crypto/
    bip46.py           BIP46 timelocked address derivation
    certificate.py     NIP-600 certificate signing
    aes.py             AES-256-GCM (cert storage) and LUD-10 AES-CBC helpers
    nostr.py           Nostr pubkey normalization
tests/                 BIP46, certificate, AES, and Nostr helper tests
pyproject.toml         Python project metadata and dependencies
```

## Requirements

- Python 3.12+
- `uv`
- SQLite by default, or any SQLAlchemy async-compatible database URL
- LNbits wallet with invoice API access

## Configuration

Configuration is loaded from environment variables and `.env`.

```env
BIP46_XPRV=xprv...
BIP46_XPUB=xpub...

LNBITS_URL=https://lnbits.example.com
LNBITS_INVOICE_KEY=...
LNBITS_WEBHOOK_SECRET=...

ADMIN_API_KEY=change-me
PREIMAGE_ENCRYPTION_KEY=64_hex_chars_for_32_bytes

DATABASE_URL=sqlite+aiosqlite:///./data/timelock.db
DEFAULT_FEE_RATE=0.10
INVOICE_EXPIRY_SECONDS=3600
MIN_BOND_SATS=100000
SERVICE_BASE_URL=https://timelock.example.com
```

Notes:

- `PREIMAGE_ENCRYPTION_KEY` must be 64 hex characters (32 bytes). It encrypts
  stored Lightning preimages at rest.
- `SERVICE_BASE_URL` is used to build the LNbits payment webhook URL
  (`/api/v1/webhook/payment`) and Lightning-address identifiers.
- The app creates tables on startup. There are no migrations.

## Local Development

```bash
uv sync --extra dev
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

Interactive API docs: `http://localhost:8000/docs`

## API Overview

### Public Endpoints

List bonds available for purchase:

```bash
curl http://localhost:8000/api/v1/bonds
```

Request a certificate slot:

```bash
curl -X POST http://localhost:8000/api/v1/bond/request \
  -H 'Content-Type: application/json' \
  -d '{"bond_id": "bond-uuid", "npub": "npub1..."}'
```

Response fields:

- `invoice` — Lightning invoice to pay
- `lnurl` — bech32 LNURL-pay link for wallets that support LNURL
- `lnurl_pay_url` — raw LNURL-pay endpoint URL
- `lightning_address` — Lightning-address identifier for this order
- `payment_hash` — LNbits payment hash / checking ID
- `encrypted_cert`, `cert_nonce` — encrypted certificate delivered with the
  invoice (safe to return pre-payment; decryption requires the preimage)
- `timelocked_address`, `bond_expiry` — BIP46 address and UNIX expiry timestamp

Poll order status:

```bash
curl http://localhost:8000/api/v1/bond/{order_id}
```

When `state` is `PAID`, ask the user for the Lightning payment preimage from
their wallet. Decrypt `encrypted_cert` with AES-256-GCM using the preimage as
the 32-byte key and `cert_nonce` as the nonce. The decrypted JSON contains
`bond_sig`, `xpub`, `utxo`, `timelock_index`, and `expiry` — the fields needed
to assemble and publish the NIP-600 event.

### LNURL / Lightning Address Flow

A bond order can also be paid through an LNURL-pay or Lightning address flow.
The wallet receives the encrypted certificate through a LUD-10 `successAction`
(AES-256-CBC, payment preimage as key).

```text
GET  /api/v1/lnurlp/{order_id}            LNURL payRequest metadata
GET  /.well-known/lnurlp/{order_id}       Lightning address well-known alias
GET  /api/v1/lnurlp/{order_id}/callback   Invoice + LUD-10 success action
```

### Admin Endpoints

All admin endpoints require:

```
X-Admin-Key: $ADMIN_API_KEY
```

**Create a bond** — derives the BIP46 address immediately:

```bash
curl -X POST http://localhost:8000/api/v1/admin/bonds \
  -H "X-Admin-Key: $ADMIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "12-month bond",
    "description": "12 month fidelity bond",
    "max_slots": 10,
    "bond_sats": 1000000,
    "timelock_duration_months": 12,
    "fee_rate": 0.10
  }'
```

Supply `timelock_index` (0–959) instead of `timelock_duration_months` to pin a
specific BIP46 index.

The response includes `timelocked_address`. Send `bond_sats` to that address
on-chain, then record the UTXO.

**Record a funded UTXO** — activates the bond for sale immediately:

```bash
curl -X POST http://localhost:8000/api/v1/admin/bonds/{bond_id}/record-utxo \
  -H "X-Admin-Key: $ADMIN_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"txid": "...", "vout": 0, "sats": 1000000}'
```

**List / inspect bonds:**

```bash
curl http://localhost:8000/api/v1/admin/bonds \
  -H "X-Admin-Key: $ADMIN_API_KEY"

curl http://localhost:8000/api/v1/admin/bonds/{bond_id} \
  -H "X-Admin-Key: $ADMIN_API_KEY"
```

**List orders:**

```bash
curl http://localhost:8000/api/v1/admin/orders \
  -H "X-Admin-Key: $ADMIN_API_KEY"
```

### Webhook

LNbits must be configured to call:

```
POST /api/v1/webhook/payment
X-Api-Key: $LNBITS_WEBHOOK_SECRET
```

The JSON body must contain `payment_hash` or `checking_id`. On receipt the
service transitions the matching order from `PENDING_PAYMENT` to `PAID`.

## Lifecycle

1. Admin creates a bond → receives a BIP46 timelocked address.
2. Admin sends `bond_sats` to that address on-chain.
3. Admin calls `record-utxo` → bond becomes `AVAILABLE`.
4. User calls `POST /bond/request` with `bond_id` and Nostr pubkey.
5. Service reserves a slot, signs certificate data, encrypts it with the
   generated preimage, and returns the invoice plus encrypted certificate.
6. User pays the invoice (directly or via LNURL / Lightning address).
7. LNbits webhook marks the order `PAID`.
8. User polls order status until `PAID`, then decrypts the certificate locally
   with the payment preimage.
9. User signs and publishes the NIP-600 event with their own Nostr key.

Pending orders expire after `INVOICE_EXPIRY_SECONDS`; the background expiry job
marks them `EXPIRED` and returns the slot to the bond.

## States

Bond statuses:

| Status            | Meaning                                      |
|-------------------|----------------------------------------------|
| `PENDING_FUNDING` | Created but UTXO not yet recorded            |
| `AVAILABLE`       | Funded and selling slots                     |
| `FULL`            | All slots reserved or sold                   |
| `EXPIRED`         | Bond locktime has passed                     |

Order states:

| State             | Meaning                                      |
|-------------------|----------------------------------------------|
| `PENDING_PAYMENT` | Invoice created, slot reserved               |
| `PAID`            | Payment confirmed, certificate available     |
| `EXPIRED`         | Invoice expired, slot returned to bond       |

## Testing

```bash
uv run pytest
```

Tests cover: BIP46 timestamp and script helpers, certificate message format,
Bitcoin-message hash, certificate signature format, AES-GCM encryption, LUD-10
AES-CBC encryption, and Nostr pubkey normalization.

## Security Notes

- Keep `BIP46_XPRV`, `PREIMAGE_ENCRYPTION_KEY`, LNbits keys, and `ADMIN_API_KEY`
  secret. Together they control fund access and certificate issuance.
- Back up the database and HD wallet material together. Stored encrypted
  preimages require `PREIMAGE_ENCRYPTION_KEY` to recover.
- CORS is currently open to all origins.
- Admin authentication is a static header key; put the service behind a reverse
  proxy and restrict admin routes to trusted networks.

## Implementation Notes

- BIP46 indexes map month-by-month from January 2020 (index `0`) through
  December 2099 (index `959`).
- The private signing derivation path is `m/84h/0h/0h/2/{index}`.
- Public verification derives from the account xpub at `m/2/{index}`.
- Certificates are signed over:

  ```
  fidelity-bond-cert|{npub_hex}|{expiry}
  ```

- Certificate payloads contain `bond_sig`, `xpub`, `utxo`, `timelock_index`,
  and `expiry`.
- The `lnurl` PyPI package provides AES-CBC primitives for LUD-10 success
  actions (`lnurl.helpers.aes_encrypt`).
- The `bip46` and `bip32` PyPI packages handle HD key derivation and witness
  script construction.
