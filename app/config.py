from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Bitcoin HD wallet (BIP46)
    bip46_xprv: str
    bip46_xpub: str

    # LNbits
    lnbits_url: str
    lnbits_invoice_key: str
    lnbits_webhook_secret: str

    # CLN/clnrest
    cln_rest_url: str
    cln_rest_rune: str

    # Electrs (Esplora-compatible)
    electrs_url: str

    # Admin API
    admin_api_key: str

    # Service behaviour
    database_url: str = "sqlite+aiosqlite:///./data/timelock.db"
    preimage_encryption_key: str  # 64 hex chars (32 bytes)
    default_fee_rate: float = 0.10
    invoice_expiry_seconds: int = 3600
    min_bond_sats: int = 100_000
    utxo_min_confirmations: int = 1
    service_base_url: str = "http://localhost:8000"


settings = Settings()
