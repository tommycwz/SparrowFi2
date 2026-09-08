# .spw File Format Specification

The `.spw` file is a custom binary format used by SparrowFi to persist user data securely offline. Three format versions exist; the application can read all three and always exports in the latest format available.

| Magic | Version | Protection |
| :--- | :--- | :--- |
| `SPW1` | Legacy | None — plain UTF-8 JSON after header |
| `SPW2` | Current (unencrypted) | Byte-wise XOR obfuscation (`key = 0x53`) |
| `SPW3` | Current (encrypted) | AES-256-GCM with PBKDF2-derived keys |

---

## SPW1 / SPW2 — Unencrypted Formats

### File Layout

| Offset | Size (Bytes) | Description |
| :--- | :--- | :--- |
| `0x00` | 4 | ASCII magic header: `SPW1` or `SPW2` |
| `0x04` | Variable | JSON payload (SPW1: raw UTF-8 · SPW2: XOR-obfuscated) |

The XOR key for SPW2 is `0x53` (`'S'` for Sparrow).

### Exporting (SPW2)
1. Serialize the state object to a JSON string.
2. Encode to `Uint8Array` via `TextEncoder`.
3. Apply a byte-wise XOR with `0x53` to every byte.
4. Prepend the 4-byte `SPW2` magic header (`[83, 80, 87, 50]`).
5. Save as a `Blob` and trigger a browser download.

### Importing (SPW1 / SPW2)
1. Read the file as an `ArrayBuffer` via `FileReader`.
2. Check the first 4 bytes for `SPW2` or `SPW1`.
3. For SPW2, XOR all payload bytes with `0x53` to recover the UTF-8 string.
4. For SPW1, decode the payload bytes directly as UTF-8.
5. `JSON.parse()` the resulting string into the application state.

---

## SPW3 — Password-Protected Format

### File Layout (168-byte fixed header)

| Offset | Size (Bytes) | Field |
| :--- | :--- | :--- |
| `0x00` | 4 | ASCII magic: `SPW3` |
| `0x04` | 16 | `password_salt` |
| `0x14` | 12 | `password_iv` |
| `0x20` | 16 | `recovery_salt` |
| `0x30` | 12 | `recovery_iv` |
| `0x3C` | 48 | `master_key` wrapped with password key (32-byte key + 16-byte GCM tag) |
| `0x6C` | 48 | `master_key` wrapped with recovery key |
| `0x9C` | 12 | `data_iv` |
| `0xA8` | Variable | AES-256-GCM encrypted JSON payload |

### Key Derivation
Both the password key and the recovery key are derived using **PBKDF2**:
- Hash: `SHA-256`
- Iterations: `100,000`
- Output: 256-bit AES-GCM key

### Recovery Key Format
A 18-character alphanumeric string (`A-Z`, `0-9`) displayed in three groups of six, e.g. `ABC123-DEF456-GHI789`. Generated client-side via `crypto.getRandomValues`; never transmitted or stored.

### Exporting (SPW3)
1. Generate a random 256-bit master key, salts, and IVs using `crypto.getRandomValues`.
2. Derive a **password wrapping key** (PBKDF2 + `password_salt`).
3. Derive a **recovery wrapping key** (PBKDF2 + `recovery_salt`).
4. Wrap (encrypt) the master key with both wrapping keys using AES-GCM.
5. Encrypt the JSON payload with the master key using AES-GCM + `data_iv`.
6. Assemble the 168-byte header followed by the encrypted payload and trigger a download.

### Importing (SPW3)
1. Read the first 4 bytes; confirm the `SPW3` magic.
2. Parse all fields from the 168-byte header.
3. Derive the wrapping key from the user-supplied password (or recovery key) and the matching salt.
4. Unwrap the master key using AES-GCM decryption. An authentication failure here means a wrong credential.
5. Decrypt the payload with the master key and `data_iv`.
6. `JSON.parse()` the decrypted UTF-8 string into the application state.

---

## JSON State Schema

This schema applies to the plaintext (post-decode / post-decrypt) JSON for all three format versions.

```json
{
  "user": {
    "isNew": false,
    "lastExport": "2026-05-14T10:00:00Z"
  },
  "settings": {
    "currency": "myr",
    "passwordEnabled": true
  },
  "banks": [
    {
      "id": "uuid-string",
      "name": "Bank Name",
      "initialCapital": 0,
      "color": "#22C55E"
    }
  ],
  "wallets": [
    {
      "id": "uuid-string",
      "name": "Wallet Name",
      "initialCapital": 0,
      "color": "#F97316"
    }
  ],
  "cards": [
    {
      "id": "uuid-string",
      "name": "Card Name",
      "color": "#3B82F6"
    }
  ],
  "categories": [
    {
      "id": "uuid-string",
      "name": "Food & Drink",
      "color": "#F97316",
      "type": "expense"
    }
  ],
  "transactions": [
    {
      "id": "uuid-string",
      "date": "2026-05-14",
      "time": "14:30",
      "amount": 50.25,
      "type": "expense",
      "accountType": "bank",
      "accountId": "uuid-string",
      "categoryId": "uuid-string",
      "notes": "Lunch with team"
    }
  ],
  "fixedDeposits": [
    {
      "id": "uuid-string",
      "bankId": "uuid-string",
      "toBankId": "uuid-string",
      "startDate": "2026-01-01",
      "amount": 10000,
      "percentage": 3.5,
      "months": 12,
      "status": "active"
    }
  ]
}
```

### Field Notes

**`settings.currency`** — Supported values: `myr`, `usd`, `eur`, `gbp`, `sgd`, `aud`.

**`settings.passwordEnabled`** — `true` when the file was saved as SPW3.

**`banks` / `wallets` — `initialCapital`** — Always stored as `0` in current files. On first import of an older file, any non-zero value is converted into an `Adjustment (In)` transaction with `notes: "Initial balance"` and then set to `0` to prevent double-counting.

**`transactions.type`** — One of `income`, `expense`, `others-in`, `others-out`.

**`transactions.accountType`** — One of `bank`, `wallet`, `card`, `cash`, `others`.

**`transactions.time`** — Optional `HH:mm` string; used for display only.

**`categories.type`** — One of `income`, `expense`, `others-in`, `others-out`. Controls how a transaction affects account balances and net-worth calculations.

**`fixedDeposits.status`** — One of `active`, `matured`, `withdrawn`. Older files may use a boolean `isMatured` field, which is automatically migrated on load.

**`fixedDeposits.toBankId`** — Optional. Links the matured FD proceeds to a destination bank account.

---

## Legacy Migration

When loading older `.spw` files, `StateService.setState()` applies the following migrations automatically:

| Old Field | Migration Rule |
| :--- | :--- |
| `creditCards[]` | Mapped to `cards[]` (copies `id` and `name`); original field deleted. |
| `dropboxes[]` | Children flattened into `categories[]`; original field deleted. |
| `bank.initialCapital !== 0` | Converted to an `Adjustment (In)` transaction; field set to `0`. |
| `wallet.initialCapital !== 0` | Same as above for wallets. |
| `fixedDeposit.isMatured` | Converted to `status: 'matured'` or `status: 'active'`; old field deleted. |
