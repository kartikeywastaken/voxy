# Identity and API disambiguation

| Value | Meaning |
| --- | --- |
| Entity key / `$key` | Entity identity, returned as `entityKey` after create |
| Transaction hash / `txHash` | Signed transaction identity; one batch can create several entities |
| `$owner` | Current mutation authority; receiving a transfer does not authenticate content |
| `$creator` | Original creating wallet; does not authenticate later mutable values |
| User column `owner` | Application data; unrelated to protected `$owner` |
| Transaction nonce | Signer transaction ordering |
| Entity nonce | Separate create counter used by `predictEntityKeys` |
| `$expiresAt` | Absolute block deadline in returned flat rows |
| Create option `expiration` | Branded `ExpirationTime` input, relative or absolute |
| `created_at: u64(...)` | App timestamp under an explicit clock/unit policy |
| `arkiv.schema` | Public indexed name tag, added by a named SDK schema |
| `$attributes` | All typed attributes; still public when unindexed |
| `$attributeSchema` | Names, types and indexing flags without values |

Use `getEntity(entityKey, Schema)` for a typed flat row; `getEntity(entityKey)` returns system fields and `$attributes`. A query `select` projection uses `$` system names; raw RPC selection uses wire names without `$`. A field available in selection is not automatically filterable.

Rabdi is chain 7794095 (`0x76edaf`). `rabdi({ accessKey })` is a function, not a chain object constant. Its access key is encoded in HTTP/WSS URL paths. Redact those URLs in diagnostics.

Source: [SDK 1.0.1 README](https://unpkg.com/@arkiv-network/sdk@1.0.1/README.md).
