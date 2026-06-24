"""
BIP46 timelocked P2WSH address derivation using the bip46 + bip32 PyPI packages.
"""
import time as _time
from dataclasses import dataclass

from bip32 import BIP32
from bip46 import (
    create_redeemscript,
    index_to_lockdate,
    lockindex_to_derivation_path,
    redeemscript_address,
    redeemscript_pubkey,
)


@dataclass
class TimelockBond:
    index: int
    timelock_ts: int
    address: str
    pubkey_hex: str
    witness_script_hex: str


def index_to_timelock_ts(index: int) -> int:
    """BIP46 index → Unix timestamp for the first of the encoded month (UTC midnight)."""
    return int(index_to_lockdate(index).timestamp())


def derive_bond_from_xprv(xprv: str, index: int) -> TimelockBond:
    """Full derivation from master xprv. Path: m/84'/0'/0'/2/{index}."""
    path = lockindex_to_derivation_path(index, network="mainnet")
    pubkey = BIP32.from_xpriv(xprv).get_pubkey_from_path(path)
    lock_date = index_to_lockdate(index)
    ws = create_redeemscript(lock_date, pubkey)
    address = redeemscript_address(redeemscript_pubkey(ws), network="mainnet")
    return TimelockBond(
        index=index,
        timelock_ts=int(lock_date.timestamp()),
        address=address,
        pubkey_hex=pubkey.hex(),
        witness_script_hex=ws.hex(),
    )


def derive_bond_from_xpub(xpub: str, index: int) -> TimelockBond:
    """Public-only derivation from account xpub (m/84'/0'/0'). Path: m/2/{index}."""
    pubkey = BIP32.from_xpub(xpub).get_pubkey_from_path(f"m/2/{index}")
    lock_date = index_to_lockdate(index)
    ws = create_redeemscript(lock_date, pubkey)
    address = redeemscript_address(redeemscript_pubkey(ws), network="mainnet")
    return TimelockBond(
        index=index,
        timelock_ts=int(lock_date.timestamp()),
        address=address,
        pubkey_hex=pubkey.hex(),
        witness_script_hex=ws.hex(),
    )


def next_available_index(current_index: int, duration_months: int) -> int:
    """Returns the BIP46 index for a bond expiring ~duration_months from now."""
    now = int(_time.time())
    for idx in range(current_index, 960):
        ts = index_to_timelock_ts(idx)
        months_from_now = (ts - now) / (30 * 24 * 3600)
        if months_from_now >= duration_months:
            return idx
    raise ValueError("No valid BIP46 index found for the requested duration")
