import enum
import math
import time

from sqlalchemy import Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class BondStatus(str, enum.Enum):
    PENDING_FUNDING = "PENDING_FUNDING"
    AVAILABLE = "AVAILABLE"
    FULL = "FULL"
    EXPIRED = "EXPIRED"


class OrderState(str, enum.Enum):
    PENDING_PAYMENT = "PENDING_PAYMENT"
    PAID = "PAID"
    EXPIRED = "EXPIRED"


class Bond(Base):
    __tablename__ = "bonds"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    description: Mapped[str] = mapped_column(String, nullable=False, default="")
    max_slots: Mapped[int] = mapped_column(Integer, nullable=False)
    bond_sats: Mapped[int] = mapped_column(Integer, nullable=False)
    fee_rate: Mapped[float] = mapped_column(Float, nullable=False)
    timelock_index: Mapped[int] = mapped_column(Integer, nullable=False)
    timelock_expiry: Mapped[int] = mapped_column(Integer, nullable=False)
    timelocked_address: Mapped[str] = mapped_column(String, nullable=False)
    bond_pubkey_hex: Mapped[str] = mapped_column(String, nullable=False)
    witness_script_hex: Mapped[str] = mapped_column(String, nullable=False)
    utxo_txid: Mapped[str | None] = mapped_column(String, nullable=True)
    utxo_vout: Mapped[int | None] = mapped_column(Integer, nullable=True)
    utxo_sats: Mapped[int | None] = mapped_column(Integer, nullable=True)
    status: Mapped[str] = mapped_column(String, default=BondStatus.PENDING_FUNDING)
    used_slots: Mapped[int] = mapped_column(Integer, default=0)
    confirmed_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[int] = mapped_column(Integer, default=lambda: int(time.time()))

    orders: Mapped[list["BondOrder"]] = relationship("BondOrder", back_populates="bond")

    @property
    def price_per_slot_sats(self) -> int:
        return math.ceil((self.bond_sats / self.max_slots) * (1 + self.fee_rate))

    @property
    def utxo(self) -> str | None:
        if self.utxo_txid is not None and self.utxo_vout is not None:
            return f"{self.utxo_txid}:{self.utxo_vout}"
        return None

    @property
    def slots_available(self) -> int:
        if self.status != BondStatus.AVAILABLE:
            return 0
        return max(0, self.max_slots - self.used_slots)


class BondOrder(Base):
    __tablename__ = "bond_orders"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    bond_id: Mapped[str] = mapped_column(String, ForeignKey("bonds.id"), nullable=False)
    beneficiary_npub: Mapped[str] = mapped_column(String, nullable=False)
    bond_sats: Mapped[int] = mapped_column(Integer, nullable=False)
    price_sats: Mapped[int] = mapped_column(Integer, nullable=False)
    state: Mapped[str] = mapped_column(String, default=OrderState.PENDING_PAYMENT)
    preimage_hash: Mapped[str] = mapped_column(String, nullable=False)
    preimage_r_enc: Mapped[str] = mapped_column(String, nullable=False)
    payment_request: Mapped[str] = mapped_column(String, nullable=False)
    encrypted_cert: Mapped[str | None] = mapped_column(String, nullable=True)
    cert_nonce: Mapped[str | None] = mapped_column(String, nullable=True)
    lnbits_payment_hash: Mapped[str] = mapped_column(String, nullable=False, index=True)
    created_at: Mapped[int] = mapped_column(Integer, default=lambda: int(time.time()))
    expires_at: Mapped[int] = mapped_column(Integer, nullable=False)
    paid_at: Mapped[int | None] = mapped_column(Integer, nullable=True)

    bond: Mapped["Bond"] = relationship("Bond", back_populates="orders")
