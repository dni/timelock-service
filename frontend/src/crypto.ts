function hexToBytes(hex: string): ArrayBuffer {
  if (hex.length % 2 !== 0) throw new Error("Invalid hex string");
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i >> 1] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes.buffer as ArrayBuffer;
}

function b64ToBytes(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
}

export interface CertFields {
  beneficiary_pubkey: string;
  cert_sig: string;
  utxo: string;
  timelock_index: number;
  expiry: number;
}

/**
 * Decrypt an AES-256-GCM encrypted certificate.
 * key   = preimage (64 hex chars = 32 bytes)
 * nonce = cert_nonce (24 hex chars = 12 bytes)
 * ct    = encrypted_cert (base64, includes 16-byte GCM tag)
 */
export async function decryptCert(
  encryptedB64: string,
  nonceHex: string,
  preimageHex: string,
): Promise<CertFields> {
  if (preimageHex.length !== 64)
    throw new Error("Preimage must be 64 hex characters (32 bytes)");

  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(preimageHex),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: hexToBytes(nonceHex) },
    key,
    b64ToBytes(encryptedB64),
  );

  return JSON.parse(new TextDecoder().decode(plaintext)) as CertFields;
}
