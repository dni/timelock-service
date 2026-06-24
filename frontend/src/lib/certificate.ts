import { secp256k1 } from '@noble/curves/secp256k1'
import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex, hexToBytes, concatBytes } from '@noble/hashes/utils'
import { mnemonicToSeedSync } from '@scure/bip39'
import { HDKey } from '@scure/bip32'
import type { Certificate } from './types'

const BOND_PATH_PREFIX = "m/84'/0'/0'/2"
const BITCOIN_MSG_MAGIC = new TextEncoder().encode('Bitcoin Signed Message:\n')
const GENESIS_MS = Date.UTC(2009, 0, 3, 18, 15, 5, 0)

function compactSize(n: number): Uint8Array {
  if (n < 253) return new Uint8Array([n])
  return new Uint8Array([253, n & 0xff, (n >> 8) & 0xff])
}

function bitcoinMessageHash(message: string): Uint8Array {
  const msgBytes = new TextEncoder().encode(message)
  const payload = concatBytes(
    new Uint8Array([BITCOIN_MSG_MAGIC.length]),
    BITCOIN_MSG_MAGIC,
    compactSize(msgBytes.length),
    msgBytes,
  )
  return sha256(sha256(payload))
}

export function buildCertMessage(certPubkeyHex: string, certExpiry: number): string {
  return `fidelity-bond-cert|${certPubkeyHex}|${certExpiry}`
}

export function generateCertKeypair(): { privkeyHex: string; pubkeyHex: string } {
  const priv = secp256k1.utils.randomPrivateKey()
  const pub = secp256k1.getPublicKey(priv, true)
  return { privkeyHex: bytesToHex(priv), pubkeyHex: bytesToHex(pub) }
}

export function currentBlockPeriod(): number {
  const elapsedMs = Date.now() - GENESIS_MS
  const estimatedHeight = Math.floor(elapsedMs / (10 * 60 * 1000))
  return Math.floor(estimatedHeight / 2016)
}

export function periodToApproxDate(period: number): string {
  const blockHeight = period * 2016
  const ms = GENESIS_MS + blockHeight * 10 * 60 * 1000
  return new Date(ms).toISOString().slice(0, 10)
}

function signWithBondKey(
  bondPrivKey: Uint8Array,
  bondPubKey: Uint8Array,
  certPubkeyHex: string,
  certPrivkeyHex: string,
  certExpiry: number,
): Certificate {
  const message = buildCertMessage(certPubkeyHex, certExpiry)
  const msgHash = bitcoinMessageHash(message)
  const sig = secp256k1.sign(msgHash, bondPrivKey)
  const headerByte = 0x1f + sig.recovery!
  const sigBytes = new Uint8Array(65)
  sigBytes[0] = headerByte
  sigBytes.set(sig.toCompactRawBytes(), 1)
  return {
    message,
    certPubkeyHex,
    certPrivkeyHex,
    certExpiry,
    expiryBlockHeight: certExpiry * 2016,
    expiryApproxDate: periodToApproxDate(certExpiry),
    bondPubkeyHex: bytesToHex(bondPubKey),
    signatureBase64: btoa(String.fromCharCode(...sigBytes)),
  }
}

export function signCertificate(
  mnemonic: string,
  passphrase: string,
  bondIndex: number,
  certPubkeyHex: string,
  certPrivkeyHex: string,
  certExpiry: number,
): Certificate {
  const seed = mnemonicToSeedSync(mnemonic, passphrase)
  const master = HDKey.fromMasterSeed(seed)
  const child = master.derive(`${BOND_PATH_PREFIX}/${bondIndex}`)
  return signWithBondKey(child.privateKey!, child.publicKey!, certPubkeyHex, certPrivkeyHex, certExpiry)
}

const ZPUB_VERSIONS = { private: 0x04b2430c, public: 0x04b24746 }

export function signCertificateFromXprv(
  xprv: string,
  bondIndex: number,
  certPubkeyHex: string,
  certPrivkeyHex: string,
  certExpiry: number,
): Certificate {
  let key: HDKey
  try {
    key = HDKey.fromExtendedKey(xprv.trim())
  } catch {
    key = HDKey.fromExtendedKey(xprv.trim(), ZPUB_VERSIONS)
  }
  const child = key.depth === 0
    ? key.derive(`${BOND_PATH_PREFIX}/${bondIndex}`)
    : key.derive(`m/2/${bondIndex}`)
  return signWithBondKey(child.privateKey!, child.publicKey!, certPubkeyHex, certPrivkeyHex, certExpiry)
}
