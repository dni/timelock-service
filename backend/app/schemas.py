from pydantic import BaseModel, Field


# ── Public bond listing ───────────────────────────────────────────────────────

class BondListItem(BaseModel):
    id: str
    name: str
    description: str
    max_slots: int
    slots_available: int
    bond_sats: int
    price_per_slot_sats: int
    fee_rate: float
    timelock_expiry: int
    status: str

    model_config = {"from_attributes": True}


# ── Bond orders ───────────────────────────────────────────────────────────────

class BondRequestBody(BaseModel):
    bond_id: str
    npub: str = Field(description="Nostr pubkey — hex (64 chars) or npub1... bech32")


class BondOrderResponse(BaseModel):
    order_id: str
    state: str
    beneficiary_pubkey: str
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
    beneficiary_pubkey: str
    invoice: str
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

class CreateBondBody(BaseModel):
    name: str
    description: str = ""
    max_slots: int
    bond_sats: int
    fee_rate: float = Field(default=0.10, ge=0)
    timelock_index: int | None = Field(
        default=None,
        description="BIP46 index (0–959). If omitted, auto-selected from timelock_duration_months.",
    )
    timelock_duration_months: int | None = Field(
        default=None,
        description="Required when timelock_index is not provided.",
    )


class RecordUtxoBody(BaseModel):
    txid: str
    vout: int
    sats: int | None = None


class AdminBondResponse(BaseModel):
    id: str
    name: str
    description: str
    max_slots: int
    used_slots: int
    bond_sats: int
    price_per_slot_sats: int
    fee_rate: float
    timelock_index: int
    timelock_expiry: int
    timelocked_address: str
    utxo: str | None
    utxo_sats: int | None
    status: str
    confirmed_at: int | None
    created_at: int

    model_config = {"from_attributes": True}
