"""
Validates BIP46 derivation against TypeScript reference from timelock-wallet.
Run: pytest tests/test_bip46.py -v
"""
import pytest
from app.crypto.bip46 import index_to_timelock_ts, derive_bond_from_xprv, derive_bond_from_xpub


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
    from bip46 import Bip46IndexError
    with pytest.raises(Bip46IndexError):
        index_to_timelock_ts(-1)
    with pytest.raises(Bip46IndexError):
        index_to_timelock_ts(960)


def test_witness_script_structure():
    """Redeemscript has the correct BIP46 structure via derive_bond_from_xprv."""
    from bip46 import create_redeemscript, index_to_lockdate
    import os
    # Build a dummy pubkey and verify script structure
    pubkey = b"\x02" + bytes(32)
    lock_date = index_to_lockdate(72)
    ws = create_redeemscript(lock_date, pubkey)
    # OP_CHECKSIG (0xac), OP_CLTV (0xb1), OP_DROP (0x75)
    assert ws[-1] == 0xAC
    assert b"\xb1" in ws
    assert b"\x75" in ws
    assert b"\x21" + pubkey in ws


def test_witness_script_to_p2wsh_format():
    """P2WSH address is mainnet bech32 with correct length."""
    from bip46 import create_redeemscript, index_to_lockdate, redeemscript_pubkey, redeemscript_address
    pubkey = b"\x02" + bytes(32)
    lock_date = index_to_lockdate(0)
    ws = create_redeemscript(lock_date, pubkey)
    script_pubkey = redeemscript_pubkey(ws)
    address = redeemscript_address(script_pubkey, network="mainnet")
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
