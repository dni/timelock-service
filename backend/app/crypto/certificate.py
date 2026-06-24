"""
Port of timelock-wallet/src/lib/certificate.ts.
Produces cert_sig: Bitcoin-message-signed secp256k1 signature over the cert message.
"""
import base64
import hashlib

import coincurve
from bip32 import BIP32
from bip46 import lockindex_to_derivation_path

BITCOIN_MSG_MAGIC = b"Bitcoin Signed Message:\n"


def _compact_size(n: int) -> bytes:
    """Bitcoin CompactSize (varint) encoding."""
    if n < 253:
        return bytes([n])
    return bytes([253, n & 0xFF, (n >> 8) & 0xFF])


def _bitcoin_message_hash(message: str) -> bytes:
    """
    Double-SHA256 with Bitcoin Signed Message prefix.
    Port of bitcoinMessageHash() from certificate.ts — must be byte-exact.
    """
    msg_bytes = message.encode("utf-8")
    payload = (
        bytes([len(BITCOIN_MSG_MAGIC)])
        + BITCOIN_MSG_MAGIC
        + _compact_size(len(msg_bytes))
        + msg_bytes
    )
    return hashlib.sha256(hashlib.sha256(payload).digest()).digest()


def build_cert_message(npub_hex: str, expiry: int) -> str:
    """Port of buildCertMessage() from certificate.ts."""
    return f"fidelity-bond-cert|{npub_hex}|{expiry}"


def sign_bond_cert(xprv: str, index: int, npub_hex: str, expiry: int) -> str:
    """
    Port of signCertificate() from certificate.ts.
    Returns cert_sig: base64-encoded 65-byte signature (1-byte header + 64-byte compact sig).
    Header byte = 0x1f + recovery (mirrors the TypeScript: 0x1f + sig.recovery).
    """
    path = lockindex_to_derivation_path(index, network="mainnet")
    privkey_bytes = BIP32.from_xpriv(xprv).get_privkey_from_path(path)

    message = build_cert_message(npub_hex, expiry)
    msg_hash = _bitcoin_message_hash(message)

    # sign_recoverable: 65 bytes = compact_sig(64) + recovery_byte(1)
    recoverable = coincurve.PrivateKey(privkey_bytes).sign_recoverable(msg_hash, hasher=None)
    compact_sig = recoverable[:64]  # r||s
    recovery = recoverable[64]      # 0 or 1
    sig_bytes = bytes([0x1F + recovery]) + compact_sig
    return base64.b64encode(sig_bytes).decode()
