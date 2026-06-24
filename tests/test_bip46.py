"""
Validates BIP46 derivation against TypeScript reference from timelock-wallet.
Run: pytest tests/test_bip46.py -v
"""
import pytest
from app.crypto.bip46 import (
    _encode_cscriptnum,
    build_witness_script,
    index_to_timelock_ts,
    witness_script_to_p2wsh,
)


def test_index_to_timelock_ts_boundaries():
    # Index 0 = 2020-01-01 00:00:00 UTC
    assert index_to_timelock_ts(0) == 1577836800
    # Index 1 = 2020-02-01 00:00:00 UTC
    assert index_to_timelock_ts(1) == 1580515200
    # Index 12 = 2021-01-01 00:00:00 UTC
    assert index_to_timelock_ts(12) == 1609459200
    # Index 72 = 2026-01-01 00:00:00 UTC
    assert index_to_timelock_ts(72) == 1767225600
    # Index 959 = 2099-12-01
    ts = index_to_timelock_ts(959)
    assert ts > 0


def test_index_invalid():
    with pytest.raises(ValueError):
        index_to_timelock_ts(-1)
    with pytest.raises(ValueError):
        index_to_timelock_ts(960)


def test_encode_cscriptnum_zero():
    assert _encode_cscriptnum(0) == b""


def test_encode_cscriptnum_small():
    assert _encode_cscriptnum(1) == b"\x01"
    assert _encode_cscriptnum(127) == b"\x7f"
    assert _encode_cscriptnum(128) == b"\x80\x00"


def test_encode_cscriptnum_locktime():
    # Unix ts ~1.7B fits in 5 bytes
    ts = index_to_timelock_ts(72)  # 1767225600
    encoded = _encode_cscriptnum(ts)
    assert 4 <= len(encoded) <= 5


def test_witness_script_structure():
    # Use a dummy 33-byte pubkey
    pubkey = bytes(33)
    pubkey = b"\x02" + bytes(32)
    locktime = index_to_timelock_ts(72)
    script = build_witness_script(pubkey, locktime)
    # Script must end with OP_CHECKSIG (0xac)
    assert script[-1] == 0xAC
    # Must contain OP_CLTV (0xb1) and OP_DROP (0x75)
    assert b"\xb1" in script
    assert b"\x75" in script
    # Pubkey push: 0x21 (33 bytes) followed by pubkey
    assert b"\x21" + pubkey in script


def test_witness_script_to_p2wsh_format():
    pubkey = b"\x02" + bytes(32)
    locktime = index_to_timelock_ts(0)
    script = build_witness_script(pubkey, locktime)
    address = witness_script_to_p2wsh(script)
    # Must be a valid mainnet P2WSH (bech32, starts with bc1q, length 62)
    assert address.startswith("bc1q")
    assert len(address) == 62


# ── Known-good test vectors ────────────────────────────────────────────────────
# Generated from timelock-wallet TypeScript:
#   npx tsx -e "import {deriveBonds} from './src/lib/timelock'; ..."
# Replace with actual values from TypeScript after running the reference script.

KNOWN_VECTORS: list[tuple[int, int, str]] = [
    # (index, expected_timelock_ts, expected_address_prefix)
    # Placeholder — fill with TypeScript output
    # (72, 1767225600, "bc1q"),
]


@pytest.mark.parametrize("index, expected_ts, addr_prefix", KNOWN_VECTORS)
def test_known_vectors(index, expected_ts, addr_prefix):
    assert index_to_timelock_ts(index) == expected_ts
    # Full address check requires a real xpub/xprv
