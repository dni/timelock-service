import { generateMnemonic as bip39Generate, validateMnemonic as bip39Validate, mnemonicToSeedSync } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english.js'
import { HDKey } from '@scure/bip32'
import { sha256 } from '@noble/hashes/sha256'
import { ripemd160 } from '@noble/hashes/ripemd160'
import { bytesToHex } from '@noble/hashes/utils'
import { bech32 } from '@scure/base'
import type { DerivedWallet, StandardAddress } from './types'

export function generateMnemonic(wordCount: 12 | 24): string {
  return bip39Generate(wordlist, wordCount === 24 ? 256 : 128)
}

export function validateMnemonic(mnemonic: string): boolean {
  return bip39Validate(mnemonic, wordlist)
}

export function deriveWallet(mnemonic: string, passphrase = ''): DerivedWallet {
  const seed = mnemonicToSeedSync(mnemonic, passphrase)
  const master = HDKey.fromMasterSeed(seed)
  const account = master.derive("m/84'/0'/0'")

  return {
    mnemonic,
    seedHex: bytesToHex(seed),
    masterXprv: master.privateExtendedKey!,
    masterXpub: master.publicExtendedKey!,
    accountXprv: account.privateExtendedKey!,
    accountXpub: account.publicExtendedKey!,
  }
}

function hash160(pubkey: Uint8Array): Uint8Array {
  return ripemd160(sha256(pubkey))
}

function pubkeyToP2WPKH(pubkey: Uint8Array): string {
  const h160 = hash160(pubkey)
  return bech32.encode('bc', [0, ...bech32.toWords(h160)])
}

const ZPUB_VERSIONS = { private: 0x04b2430c, public: 0x04b24746 }

function parseAccountKey(xpub: string): HDKey {
  try {
    return HDKey.fromExtendedKey(xpub)
  } catch {
    return HDKey.fromExtendedKey(xpub, ZPUB_VERSIONS)
  }
}

// Returns null if valid, or an error string describing the problem.
export function validateXpub(xpub: string): string | null {
  let key: HDKey
  try {
    key = parseAccountKey(xpub.trim())
  } catch {
    return 'Not a valid extended public key'
  }
  if (key.depth !== 3) {
    return `Wrong key depth: expected 3 (account level m/84'/0'/0') but got ${key.depth}`
  }
  const HARDENED = 0x80000000
  if (key.index !== HARDENED) {
    const got = key.index >= HARDENED
      ? `${key.index - HARDENED}'`
      : String(key.index)
    return `Wrong account index: expected 0' but got ${got}`
  }
  return null
}

export function validateXprv(xprv: string): string | null {
  let key: HDKey
  try {
    key = HDKey.fromExtendedKey(xprv.trim())
  } catch {
    try {
      key = HDKey.fromExtendedKey(xprv.trim(), ZPUB_VERSIONS)
    } catch {
      return 'Not a valid extended private key'
    }
  }
  if (!key.privateKey) return 'Key has no private key material (is this a public key?)'
  if (key.depth !== 0 && key.depth !== 3) {
    return `Unexpected key depth ${key.depth} — expected master (0) or account (3, m/84'/0'/0')`
  }
  return null
}

export function deriveStandardAddressesFromXpub(xpub: string, count = 10): StandardAddress[] {
  const account = parseAccountKey(xpub.trim())
  const addresses: StandardAddress[] = []
  for (let i = 0; i < count; i++) {
    const child = account.derive(`m/0/${i}`)
    const pubkey = child.publicKey!
    addresses.push({
      index: i,
      path: `m/84'/0'/0'/0/${i}`,
      address: pubkeyToP2WPKH(pubkey),
      pubkeyHex: bytesToHex(pubkey),
    })
  }
  return addresses
}

export function deriveStandardAddresses(
  mnemonic: string,
  passphrase = '',
  count = 10
): StandardAddress[] {
  const seed = mnemonicToSeedSync(mnemonic, passphrase)
  const account = HDKey.fromMasterSeed(seed).derive("m/84'/0'/0'")
  const external = account.derive('0')

  const addresses: StandardAddress[] = []
  for (let i = 0; i < count; i++) {
    const child = external.derive(`${i}`)
    const pubkey = child.publicKey!
    addresses.push({
      index: i,
      path: `m/84'/0'/0'/0/${i}`,
      address: pubkeyToP2WPKH(pubkey),
      pubkeyHex: bytesToHex(pubkey),
    })
  }
  return addresses
}
