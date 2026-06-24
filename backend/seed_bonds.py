#!/usr/bin/env python3
"""
Seed test bonds via the admin API.

Usage:
    python seed_bonds.py [--url http://localhost:8000] [--key <admin_key>]

Reads ADMIN_API_KEY and SERVICE_BASE_URL from .env if not passed as flags.
"""
import argparse
import json
import os
import secrets
import sys
import urllib.request
import urllib.error
from pathlib import Path


def load_env(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def request(method: str, url: str, key: str, body: dict | None = None) -> dict:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", "X-Admin-Key": key},
        method=method,
    )
    try:
        with urllib.request.urlopen(req) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        print(f"  ERROR {e.code}: {e.read().decode()}", file=sys.stderr)
        sys.exit(1)


BONDS = [
    {
        "name": "Solo Bond",
        "description": "Single-user bond — full bond value, one certificate.",
        "max_slots": 1,
        "bond_sats": 500_000,
        "fee_rate": 0.10,
        "timelock_duration_months": 12,
    },
    {
        "name": "Group Bond (10)",
        "description": "Shared bond split across up to 10 users.",
        "max_slots": 10,
        "bond_sats": 1_000_000,
        "fee_rate": 0.08,
        "timelock_duration_months": 12,
    },
    {
        "name": "Community Bond (100)",
        "description": "Shared bond split across up to 100 users.",
        "max_slots": 100,
        "bond_sats": 5_000_000,
        "fee_rate": 0.05,
        "timelock_duration_months": 12,
    },
]


def main() -> None:
    env = load_env(Path(__file__).parent.parent / ".env")

    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=env.get("SERVICE_BASE_URL", "http://localhost:8000"))
    parser.add_argument("--key", default=env.get("ADMIN_API_KEY", ""))
    args = parser.parse_args()

    if not args.key:
        print("ADMIN_API_KEY not set. Pass --key or set it in .env", file=sys.stderr)
        sys.exit(1)

    endpoint = args.url.rstrip("/") + "/api/v1/admin/bonds"
    print(f"Seeding bonds → {endpoint}\n")

    for bond in BONDS:
        print(f"  Creating '{bond['name']}' (max_slots={bond['max_slots']})…")
        result = request("POST", endpoint, args.key, bond)
        bond_id = result["id"]
        price = result.get("price_per_slot_sats", "?")
        address = result.get("timelocked_address", "?")
        print(f"    id       : {bond_id}")
        print(f"    address  : {address}")
        print(f"    price    : {price:,} sats/slot")

        fake_txid = secrets.token_hex(32)
        utxo_url = f"{args.url.rstrip('/')}/api/v1/admin/bonds/{bond_id}/record-utxo"
        utxo_body = {"txid": fake_txid, "vout": 0, "sats": bond["bond_sats"]}
        updated = request("POST", utxo_url, args.key, utxo_body)
        print(f"    utxo     : {fake_txid[:16]}…:0")
        print(f"    status   : {updated['status']}")
        print()

    print("Done. All bonds are AVAILABLE with test UTXOs.")


if __name__ == "__main__":
    main()
