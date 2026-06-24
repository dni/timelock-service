from pydantic import BaseModel, Field


# ── Tiers ─────────────────────────────────────────────────────────────────────

class TierResponse(BaseModel):
    id: str
    name: str
    description: str
    max_slots: int
    bond_sats: int
    price_per_slot_sats: int
    fee_rate: float
    timelock_duration_months: int
    is_active: bool

    model_config = {"from_attributes": True}


class TierWithAvailabilityResponse(TierResponse):
    slots_available: int


# ── Bond orders ───────────────────────────────────────────────────────────────

class BondRequestBody(BaseModel):
    tier_id: str
    npub: str = Field(description="Nostr pubkey — hex (64 chars) or npub1... bech32")


class BondOrderResponse(BaseModel):
    order_id: str
    state: str
    invoice: str
    payment_hash: str
    price_sats: int
    bond_sats: int
    encrypted_cert: str | None
    cert_nonce: str | None
    timelocked_address: str
    bond_expiry: int
    expires_at: int

    model_config = {"from_attributes": True}


class BondStatusResponse(BaseModel):
    order_id: str
    state: str
    price_sats: int
    bond_sats: int
    encrypted_cert: str | None
    cert_nonce: str | None
    payment_hash: str
    timelocked_address: str
    bond_expiry: int
    expires_at: int
    paid_at: int | None

    model_config = {"from_attributes": True}


# ── Admin ─────────────────────────────────────────────────────────────────────

class CreateTierBody(BaseModel):
    name: str
    description: str
    max_slots: int
    bond_sats: int
    timelock_duration_months: int
    fee_rate: float | None = None


class CreatePoolBody(BaseModel):
    tier_id: str
    timelock_index: int | None = Field(
        default=None,
        description="BIP46 index (0–959). If omitted, auto-selected based on tier duration.",
    )
    fund_via_cln: bool = Field(
        default=False,
        description="If true, immediately trigger CLN on-chain withdraw to fund the pool.",
    )


class RecordUtxoBody(BaseModel):
    txid: str
    vout: int
    sats: int | None = None


class PoolResponse(BaseModel):
    id: str
    tier_id: str
    tier_name: str | None
    timelock_index: int
    timelock_expiry: int
    timelocked_address: str
    utxo: str | None
    utxo_sats: int | None
    status: str
    used_slots: int
    max_slots: int | None
    created_at: int
    confirmed_at: int | None
