"""AES encryption: GCM for cert storage, CBC (via lnurl) for LUD-10 success actions."""
import base64
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from lnurl.helpers import aes_encrypt as _lud10_aes_encrypt


def encrypt_cert(cert_json: str, preimage_r: bytes) -> tuple[str, str]:
    """
    Encrypt cert_json with AES-256-GCM using preimage_r as the key.
    Returns (ciphertext_b64, nonce_hex).
    """
    assert len(preimage_r) == 32, "preimage_r must be 32 bytes"
    nonce = os.urandom(12)
    aesgcm = AESGCM(preimage_r)
    ciphertext = aesgcm.encrypt(nonce, cert_json.encode("utf-8"), None)
    return base64.b64encode(ciphertext).decode(), nonce.hex()


def decrypt_cert(ciphertext_b64: str, nonce_hex: str, preimage_r: bytes) -> str:
    """
    Decrypt with AES-256-GCM. Raises cryptography.exceptions.InvalidTag if r is wrong.
    """
    nonce = bytes.fromhex(nonce_hex)
    ciphertext = base64.b64decode(ciphertext_b64)
    aesgcm = AESGCM(preimage_r)
    plaintext = aesgcm.decrypt(nonce, ciphertext, None)
    return plaintext.decode("utf-8")


def encrypt_bytes(data: bytes, key: bytes) -> tuple[str, str]:
    """General-purpose AES-256-GCM encryption for secrets at rest."""
    assert len(key) == 32
    nonce = os.urandom(12)
    aesgcm = AESGCM(key)
    ciphertext = aesgcm.encrypt(nonce, data, None)
    return base64.b64encode(ciphertext).decode(), nonce.hex()


def decrypt_bytes(ciphertext_b64: str, nonce_hex: str, key: bytes) -> bytes:
    nonce = bytes.fromhex(nonce_hex)
    ciphertext = base64.b64decode(ciphertext_b64)
    aesgcm = AESGCM(key)
    return aesgcm.decrypt(nonce, ciphertext, None)


def encrypt_lud10_success_action(message: str, preimage_r: bytes) -> tuple[str, str]:
    """
    Encrypt a LUD-10 successAction payload (AES-256-CBC, PKCS7 padding).
    Returns (ciphertext_b64, iv_b64).
    """
    return _lud10_aes_encrypt(preimage_r, message)
