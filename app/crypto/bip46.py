"""
Port of timelock-wallet/src/lib/timelock.ts.
Derives BIP46 timelocked P2WSH addresses from a service HD wallet.
"""
import calendar
import hashlib
from dataclasses import dataclass

from embit import bip32
from embit.networks import NETWORKS

BOND_PATH_PREFIX = "m/84h/0h/0h/2"

# Opcodes used in the witness script
OP_CHECKLOCKTIMEVERIFY = b"\xb1"
OP_DROP = b"\x75"
OP_CHECKSIG = b"\xac"


@dataclass
class TimelockBond:
    index: int
    timelock_ts: int
    address: str
    pubkey_hex: str
    witness_script_hex: str


def index_to_timelock_ts(index: int) -> int:
    """
    Port of indexToTimelock() from timelock.ts.
    Index 0 = 2020-01, index 12 = 2021-01, index 959 = 2099-12.
    Returns Unix timestamp for the first of the encoded month (UTC midnight).
    """
    if not (0 <= index <= 959):
        raise ValueError(f"Invalid BIP46 index: {index}")
    year = 2020 + index // 12
    month = 1 + index % 12
    return int(calendar.timegm((year, month, 1, 0, 0, 0, 0, 0, 0)))


def _encode_cscriptnum(n: int) -> bytes:
    """
    Bitcoin CScriptNum minimal little-endian encoding.
    Used for encoding the locktime in the witness script.
    """
    if n == 0:
        return b""
    negative = n < 0
    absval = abs(n)
    result = []
    while absval > 0:
        result.append(absval & 0xFF)
        absval >>= 8
    if result[-1] & 0x80:
        result.append(0x80 if negative else 0x00)
    elif negative:
        result[-1] |= 0x80
    return bytes(result)


def build_witness_script(pubkey_bytes: bytes, locktime: int) -> bytes:
    """
    Port of buildWitnessScript() from timelock.ts.
    Script: <locktime> OP_CLTV OP_DROP <pubkey> OP_CHECKSIG
    """
    locktime_encoded = _encode_cscriptnum(locktime)
    return (
        bytes([len(locktime_encoded)])
        + locktime_encoded
        + OP_CHECKLOCKTIMEVERIFY
        + OP_DROP
        + bytes([len(pubkey_bytes)])
        + pubkey_bytes
        + OP_CHECKSIG
    )


def witness_script_to_p2wsh(witness_script: bytes) -> str:
    """
    Port of witnessScriptToP2WSH() from timelock.ts.
    P2WSH = bech32('bc', [OP_0, SHA256(witness_script)]).
    """
    script_hash = hashlib.sha256(witness_script).digest()
    # Build the P2WSH scriptPubKey: OP_0 <32-byte-hash>
    script_pubkey = b"\x00\x20" + script_hash
    from embit.script import Script
    from embit.networks import NETWORKS
    return Script(script_pubkey).address(NETWORKS["main"])


def derive_bond_from_xprv(xprv: str, index: int) -> TimelockBond:
    """Full derivation from master xprv (custodial path). Path: m/84h/0h/0h/2/{index}."""
    master = bip32.HDKey.from_string(xprv)
    child = master.derive(f"{BOND_PATH_PREFIX}/{index}")
    pubkey_bytes = child.key.get_public_key().sec()
    ts = index_to_timelock_ts(index)
    ws = build_witness_script(pubkey_bytes, ts)
    address = witness_script_to_p2wsh(ws)
    return TimelockBond(
        index=index,
        timelock_ts=ts,
        address=address,
        pubkey_hex=pubkey_bytes.hex(),
        witness_script_hex=ws.hex(),
    )


def derive_bond_from_xpub(xpub: str, index: int) -> TimelockBond:
    """Public-only derivation (non-custodial / verification). Path from account: m/2/{index}."""
    account = bip32.HDKey.from_string(xpub)
    child = account.derive(f"m/2/{index}")
    pubkey_bytes = child.key.sec()
    ts = index_to_timelock_ts(index)
    ws = build_witness_script(pubkey_bytes, ts)
    address = witness_script_to_p2wsh(ws)
    return TimelockBond(
        index=index,
        timelock_ts=ts,
        address=address,
        pubkey_hex=pubkey_bytes.hex(),
        witness_script_hex=ws.hex(),
    )


def next_available_index(current_index: int, duration_months: int) -> int:
    """Returns the BIP46 index for a bond expiring ~duration_months from now."""
    import time as _time
    now = int(_time.time())
    for idx in range(current_index, 960):
        ts = index_to_timelock_ts(idx)
        months_from_now = (ts - now) / (30 * 24 * 3600)
        if months_from_now >= duration_months:
            return idx
    raise ValueError("No valid BIP46 index found for the requested duration")
