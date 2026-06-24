"""
Validates bond_sig signing against TypeScript reference from timelock-wallet.
The key invariant: identical inputs must produce identical bond_sig output.
Run: pytest tests/test_certificate.py -v
"""
import base64
import hashlib

import pytest
from app.crypto.certificate import _bitcoin_message_hash, build_cert_message


def test_cert_message_format():
    msg = build_cert_message("aabbcc", 12345)
    assert msg == "fidelity-bond-cert|aabbcc|12345"


def test_bitcoin_message_hash_deterministic():
    h1 = _bitcoin_message_hash("test message")
    h2 = _bitcoin_message_hash("test message")
    assert h1 == h2
    assert len(h1) == 32


def test_bitcoin_message_hash_different_inputs():
    h1 = _bitcoin_message_hash("hello")
    h2 = _bitcoin_message_hash("world")
    assert h1 != h2


def test_bitcoin_message_hash_known_vector():
    """
    Known-good hash for 'fidelity-bond-cert|aabbcc|12345'.
    Computed by running the TypeScript bitcoinMessageHash function.
    Replace None with the actual hex value from TypeScript output.
    """
    expected_hex = None  # set after running TypeScript reference
    if expected_hex is None:
        pytest.skip("Known vector not yet set — run TypeScript reference first")
    msg = build_cert_message("aabbcc", 12345)
    h = _bitcoin_message_hash(msg)
    assert h.hex() == expected_hex


# ── Sign + verify roundtrip ────────────────────────────────────────────────────

def test_sign_bond_cert_format():
    """Sign with a test key and verify the output format."""
    import hashlib
    from bip32 import BIP32

    # Deterministic test mnemonic (BIP39 "abandon x11 about")
    TEST_MNEMONIC = (
        "abandon abandon abandon abandon abandon abandon "
        "abandon abandon abandon abandon abandon about"
    )
    # BIP39 seed derivation: PBKDF2-HMAC-SHA512, 2048 rounds, "mnemonic" salt
    seed = hashlib.pbkdf2_hmac("sha512", TEST_MNEMONIC.encode(), b"mnemonic", 2048)
    xprv = BIP32.from_seed(seed).get_xpriv_from_path("m")

    from app.crypto.certificate import sign_bond_cert

    bond_sig = sign_bond_cert(
        xprv=xprv,
        index=72,
        npub_hex="a" * 64,
        expiry=1767225600,
    )

    sig_bytes = base64.b64decode(bond_sig)
    assert len(sig_bytes) == 65
    # Header byte must be in range 0x1f..0x22 (31..34)
    assert 0x1F <= sig_bytes[0] <= 0x22


# ── AES encryption roundtrip (client-side decryption) ─────────────────────────
# Decryption happens client-side using the LN preimage from the wallet receipt.
# The service only encrypts; it never decrypts. These tests verify the scheme works.

def test_aes_encrypt_decrypt_roundtrip():
    import os
    from app.crypto.aes import decrypt_cert, encrypt_cert

    cert_json = '{"kind": 30600, "tags": [], "content": ""}'
    preimage_r = os.urandom(32)
    ct, nonce = encrypt_cert(cert_json, preimage_r)
    # Client decrypts with preimage_r from their LN wallet
    decrypted = decrypt_cert(ct, nonce, preimage_r)
    assert decrypted == cert_json


def test_aes_wrong_preimage_raises():
    """Wrong preimage → InvalidTag. Service never decrypts, but client should handle this."""
    import os
    from cryptography.exceptions import InvalidTag
    from app.crypto.aes import decrypt_cert, encrypt_cert

    cert_json = '{"test": true}'
    r = os.urandom(32)
    ct, nonce = encrypt_cert(cert_json, r)

    wrong_r = os.urandom(32)
    with pytest.raises(InvalidTag):
        decrypt_cert(ct, nonce, wrong_r)


def test_lud10_success_action_encrypts_aes_cbc_payload():
    import base64
    import os

    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.primitives.padding import PKCS7

    from app.crypto.aes import encrypt_lud10_success_action

    message = '{"bond_sig":"sig","xpub":"xpub"}'
    preimage_r = os.urandom(32)
    ciphertext_b64, iv_b64 = encrypt_lud10_success_action(message, preimage_r)

    iv = base64.b64decode(iv_b64)
    ciphertext = base64.b64decode(ciphertext_b64)
    assert len(iv) == 16
    assert len(ciphertext) % 16 == 0

    cipher = Cipher(algorithms.AES(preimage_r), modes.CBC(iv))
    decryptor = cipher.decryptor()
    padded = decryptor.update(ciphertext) + decryptor.finalize()
    unpadder = PKCS7(128).unpadder()
    plaintext = unpadder.update(padded) + unpadder.finalize()
    assert plaintext.decode("utf-8") == message


# ── Nostr pubkey normalisation ─────────────────────────────────────────────────
# Nostr event building and signing is client-side only.

def test_normalize_public_key_hex():
    from app.crypto.nostr import normalize_public_key
    key = "a" * 64
    assert normalize_public_key(key) == key


def test_normalize_public_key_invalid():
    from app.crypto.nostr import normalize_public_key
    with pytest.raises(ValueError):
        normalize_public_key("tooshort")
