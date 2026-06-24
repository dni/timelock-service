"""Nostr utility: npub normalisation (hex ↔ bech32). Event building/signing is client-side."""
from bech32 import bech32_decode, convertbits


def normalize_public_key(key: str) -> str:
    """Accepts npub1... bech32 or 64-char hex. Returns 64-char lowercase hex."""
    if key.startswith("npub1"):
        _, decoded_data = bech32_decode(key)
        if not decoded_data:
            raise ValueError("Key is not valid npub1.")
        decoded_data_bits = convertbits(decoded_data, 5, 8, False)
        if not decoded_data_bits:
            raise ValueError("Key is not valid npub1.")
        return bytes(decoded_data_bits).hex()
    if len(key) != 64:
        raise ValueError("Key has wrong length (expected 64 hex chars).")
    try:
        int(key, 16)
    except Exception as exc:
        raise ValueError("Key is not valid hex.") from exc
    return key
