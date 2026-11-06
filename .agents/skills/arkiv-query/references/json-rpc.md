# SDK 1.0.x wire protocol

Use the versioned source for non-TypeScript clients. Rabdi is chain 7794095 (`0x76edaf`); HTTP is `https://rpc.rabdi.db-chain.testnet.arkiv.network/<accessKey>` and WSS uses the same host/path. Put actual keys in a local secret store; redact URLs and never interpolate untrusted configuration into shell source.

```json
{"jsonrpc":"2.0","id":1,"method":"arkiv_query","params":["arkiv.schema = str('example_notes') ORDER BY $key:key ASC",{"select":{"key":true,"attributes":{"body":true},"count":true},"limit":"0x14","offset":"0x0"}]}
```

The response contains `data`, hex `blockNumber` and optional hex `count`. Options are `select`, hex `limit` (1–100) and hex `offset`. Selection wire names omit `$`: `key`, `owner`, `creator`, `createdAt`, `updatedAt`, `expiresAt`, `creationFlags`, `attributes`, `attributeSchema`. SDK flat-row names add `$` only for system fields. `attributes` can be true or a map of selected names. `attributeSchema` is a list of name/type/indexed entries without values.

For count only, use `select: {count:true}`; SDK `count()` uses that projection. Counts include all filter matches, regardless of page size or schema mismatch. `arkiv_getEntity` takes `[entityKey]` and returns a live entity or null. There is no historical block/cursor option in the SDK 1.0.x RPC schema. Do not invent an old-state fallback.

Attributes return name/type/value. i32 is a JSON number, u64/u256 a hex quantity, dec a decimal string, bytes/key/address hex and str a string. Preserve the tag, exact integers and indexing metadata. Bytes values are never indexed. Raw names and literals must follow the source grammar; strings escape apostrophes by doubling them. Build expressions with the SDK where possible.

Queryable system fields are `$key:key`, `$owner:addr`, `$creator:addr`, `$expiresAt:u64`. `EXISTS(name)` and `TYPEOF(name) = tag` apply to indexed app attributes, not those system fields. Prefix matching applies to str. No general SQL JOIN or aggregate language is implied. Ordering accepts one typed non-bytes key and applies before limit/offset.

Query errors map -32001/-32002/-32003/-32004 to parse/type/literal/limits. These method-specific mappings do not classify arbitrary Ethereum-compatible RPC errors. Preserve actual HTTP status; an access denial or quota limit is not an empty result. Each arkiv_query costs 10 quota units under the current provider policy.

## Native writes

Use the SDK's public write methods; the native `execute((uint8 operation, bytes operationData)[] ops)` call targets `0x4400000000000000000000000000000000000044`. Operation tags are create 1, patch 2, extend 3, transfer 4, delete 5. One batch is atomic. A raw implementation needs exact SDK-equivalent sorted attribute names, type encoding and indexing bits; do not reuse an older encoder merely because the ABI entrypoint looks the same.

The attribute type byte combines the type ID and bit `0x80` for indexed. Current SDK types are bool 1, i32 2, u64 3, u256 4, dec 5, bytes 7, str 8, addr 9, key 10. The SDK does not expose type 6 as a constructor. Bytes cannot carry the indexed bit. Use source/roundtrip test vectors for encoding rather than hand-built transactions.

Native events are EntityCreated, EntityPatched, ExpiryExtended, OwnershipTransferred, EntityDeleted. Validate address, receipt success and provenance before decoding; events do not contain full attribute values. Natural expiration has no event. Raw access does not establish historical retention or missing-event recovery.

Sources: [RPC types](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/types/rpcSchema.ts), [rendering](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/query/expression.ts), [ordering](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/query/order.ts), [codec](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/schema/codec.ts), [operations](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/entity/operations.ts).
