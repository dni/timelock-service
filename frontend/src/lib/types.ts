export interface DerivedWallet {
  mnemonic: string
  seedHex: string
  masterXprv: string
  masterXpub: string
  accountXprv: string
  accountXpub: string
}

export interface StandardAddress {
  index: number
  path: string
  address: string
  pubkeyHex: string
}

export interface TimelockBond {
  index: number
  year: number
  month: number
  timelockTs: number
  timelockDate: string
  pubkeyHex: string
  address: string
  witnessScriptHex: string
}

export interface Certificate {
  message: string
  certPubkeyHex: string
  certPrivkeyHex: string
  certExpiry: number
  expiryBlockHeight: number
  expiryApproxDate: string
  bondPubkeyHex: string
  signatureBase64: string
}

export type KeySource =
  | { type: 'mnemonic'; mnemonic: string; passphrase: string }
  | { type: 'xpub'; xpub: string }

export type Tab = 'wallet' | 'bonds'
