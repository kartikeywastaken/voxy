---
name: arkiv-large-files
description: Plan manifest/chunk or external-blob storage, byte verification, partial-upload recovery and dependency lifetimes on Rabdi. Check installed package SDK 1.0 compatibility before using library APIs.
license: MIT
metadata:
  arkiv-sdk: ">=1.0.0 <2"
  network: "rabdi"
  verified: "2026-10-30"
---

# Large files and images on Rabdi

Store searchable scalar columns with explicit indexes and binary data in named bytes columns, or keep bulk data in the application's existing blob store. All unencrypted values are public. SDK 1.0.x caps a bytes value and aggregate bytes in a create/patch at 128 KiB; ABI/JSON-RPC overhead and provider limits are additional. Estimate the exact operation rather than treating a column limit as a transaction maximum.

## Package compatibility

Inspect installed `arkiv-chunking` / `arkiv-images` versions, peer ranges, public declarations, consumer AGENTS.md and Rabdi admission. Choose only a source-verified SDK 1.0-compatible release. Do not force peers, downgrade SDK, copy private schema constants or claim another lane's unpublished candidate is ready. Registry metadata, local fixtures, funded byte roundtrips and browser decoding are separate evidence.

Use `arkiv-chunking` 1.1.4 for its published `splitFile`, `hashFile`, `reconstructFile`, `uploadFile` and `downloadFile` exports; its SDK peer is `^1.0.0`, verified by the package with 1.0.1. This does not certify an independently installed image wrapper or browser integration.

Use `arkiv-images` 1.0.5 for its published `inspectImage`, `planImage`, `storeImage` and `retrieveImage` exports. It depends on `arkiv-chunking` 1.1.4 exactly and declares SDK `^1.0.0`, verified by the package with 1.0.1. Its PNG/JPEG container inspection does not replace full browser pixel decoding.

Until package compatibility is verified, design with native schema operations and an explicit manifest contract. No generic upload-resume, cleanup, deduplication or whole-file atomicity is implied. Read installed public APIs before giving package-specific executable code.

## Representation and recovery

- One entity: use bytes columns when encoded size/gas fit. Store MIME in a separately validated public string column. Binary storage avoids base64 expansion.
- Rabdi writes need explicit latest nonce, gas and network gasPrice. Measure large bytes/chunk/image operations and approve at least twice the measured maximum gas, never below 1,000,000 plus 400,000 per extra batch operation. Check successful receipts. Any transaction retry must satisfy every condition of the [write-safety retry contract](../arkiv-write-safety/SKILL.md#reconcile-before-another-submission); no other retry or resend is allowed.
- Manifest/chunks: define format version, trusted creator/publisher, digest, total length, indexed manifest key and sequence, chunk bounds and completion state. Query all bounded pages; reject missing/duplicate indices, wrong lengths, corrupt bytes and incomplete completion state.
- Hybrid pointer: use an approved public URI/CID with exact digest/length and media type. Reject embedded credentials and signed query tokens. Retrieval needs origin/redirect, response-size and content-validation policy; a URI allowlist alone is not server-fetch security.

Verify full-file SHA-256 against an independently trusted digest when authenticity matters. A digest from the same mutable manifest proves only internal agreement. Multiple transaction uploads need an exclusive signer queue and durable step journal capturing intent/signed bytes/hash before forwarding. Progress callbacks are not durable checkpoints. Stop on uncertain outcomes; authenticate existing receipts/parts before continuation. Never restart an entire upload to repair a lost response.

Choose `rootExpiresAt <= min(requiredPartExpiresAt)` and enough upload/read slack. Shared absolute deadlines simplify the contract; relative lifetime in later transactions shifts deadlines. Read actual observed values and verify every dependency before reporting availability. Live roots can outlive missing manifests/chunks. Expiration has no event and neither it nor deletion retracts read copies. Unsupported independent transfers/renewals of package internals need a separately verified workflow.

SDK queries read latest state, so separate chunk pages are not one pinned snapshot. Prefer readonly chunks and an authenticated immutable manifest; validate bytes/digest/dependencies on every retrieval and reject missing or changed data. A current lookup cannot reconstruct expired chunks. A mutable incomplete manifest needs a signed/finalized publication policy before trusted use.

## Example external pointer

```typescript
import { ExpirationTime } from '@arkiv-network/sdk';
import { defineSchema, str, bytes, u64 } from '@arkiv-network/sdk/schema';
export const ExternalFiles = defineSchema('example_external_files', {
  sha256: str().indexed(), size: u64(), media_type: str(), location: bytes(),
});
export async function prepareExternalPointer(data: Uint8Array, uri: string, mediaType: string,
  deadline: bigint, approvedOrigins: ReadonlySet<string>) {
  const url = new URL(uri);
  if (url.protocol !== 'https:' || !approvedOrigins.has(url.origin) || url.username || url.password || url.search || url.hash) throw new Error('Use an approved public URL');
  if (!/^[a-z][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mediaType)) throw new Error('Invalid media type');
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(data));
  const sha256 = '0x' + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  return { schema: ExternalFiles, values: { sha256, size: u64(data.length), media_type: mediaType,
    location: new TextEncoder().encode(url.href) }, expiration: ExpirationTime.atBlock(deadline), flags: { readonly: true } };
}
```

This prepares a descriptor and uploads nothing. Verify blob retrieval first, then submit only with spending authorization. Download consumers must check exact byte length and SHA-256 before use.

## Images

Verify the installed package's actual accepted formats and preprocessing. Do not assume EXIF/GPS removal, resizing, encryption or malware scanning. Decode allowed PNG/JPEG bytes before upload and after retrieval in the browser, handle decoder failures, render only approved raster MIME, revoke owned Blob URLs and treat filenames as text. Return no partial file/image as success. A core fixture or container inspection is not browser pixel decoding.

Sources: [arkiv-chunking 1.1.4 release guide](https://unpkg.com/arkiv-chunking@1.1.4/README.md), [chunking declarations](https://unpkg.com/arkiv-chunking@1.1.4/dist/index.d.ts), [arkiv-images 1.0.5 release guide](https://unpkg.com/arkiv-images@1.0.5/README.md), [image declarations](https://unpkg.com/arkiv-images@1.0.5/dist/index.d.ts), [SDK 1.0.1 source](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/), [SDK 1.0.1 README](https://unpkg.com/@arkiv-network/sdk@1.0.1/README.md). Inspect the installed declarations before adapting executable examples.
