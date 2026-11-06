---
name: arkiv-mcp
description: Explain an already connected Arkiv MCP or plugin, including the plugin's General connection, separate event profiles the human adds, the ended and frozen Devfolio profile, and how to confirm the actual profile with server_status. Use for profile, server_status, event-connection and tools-versus-skills questions, source discovery, optional public-evidence verification and PostgreSQL-to-entity modeling. Entity writes belong to SDK skills; this skill does not install or configure a plugin.
license: MIT
metadata:
  arkiv-sdk: ">=1.0.0 <2"
  network: "rabdi"
  verified: "2026-10-30"
---

# Arkiv MCP

A skill is guidance the agent reads. A tool is a callable operation that returns data. The reviewed Arkiv gateway supplies knowledge, model-only schema conversion and narrow public-evidence checks; it does not sign or submit chain transactions. Knowledge/model requests also send their arguments to the service. Optional feedback requires separate sharing consent.

Use this skill for an **existing authorized connection**. If the user chooses skills/SDK only, honor that choice. Use `arkiv-first-write`, `arkiv-query` and `arkiv-troubleshooting` directly; an MCP is not a prerequisite.

## Plugin and standalone connections

The Arkiv plugin bundles the **General** profile at `https://mcp.arkiv.network/` in supported clients. General serves Arkiv building guidance: official documentation, packages, skills with errata, local workflows, PostgreSQL-to-entity modeling and bounded public observations. It does not serve event rules. Plugin users already have this connection; do not add another one for building work. Check the client-specific installation guide; installing a plugin does not authorize SDK installation, wallet access, signing, feedback or transactions.

**Event profiles are separate MCP servers with their own URLs on the same gateway.** A host cannot switch servers by itself. General's initialization instructions name an active event profile and its URL, and list ended events as ended; the `start` workflow returns every entry in `activeEvents`. When the developer works on an active event, suggest that the human add that event's URL as a separate MCP server. Providing the URL does not authorize adding a connection, switching profiles or changing configuration: the developer chooses. Keep each event's rules, dates and capabilities separate; never borrow them from another event.

**The Devfolio profile (Arkiv: Global Tour Stop) has ended and is frozen** at `https://mcp.arkiv.network/devfolio`. Its rules, deadlines, submission guidance and event-only tools are historical references, not current guidance; do not use them for new building work or another event. Earlier plugin releases bundled that profile. If `server_status` reports `id: "devfolio"`, explain that the event ended and that General is the building connection; updating the plugin or adding General is the developer's decision. The ETHRome profile and the separate Ideathon MCP have also ended.

Standalone users may have connected General or an event profile directly. Either way, inspect the actual `server_status` before relying on rules, dates or draft/frozen state. A synthetic status response establishes fixture behavior only, not current production state.

## Discover the actual profile

The gateway is [mcp.arkiv.network](https://mcp.arkiv.network/). Event paths are separate profiles, not arbitrary query parameters. Do not install a connector, edit host configuration or switch profiles merely because a tool is missing. Ask for the intended profile when that choice changes the task.

1. Inspect the tools and prompts exposed by the already connected host, or the protocol's `tools/list` and `prompts/list` through that connection. Use the current names and input schemas; hosts add different tool-name prefixes.
2. Read `server_status`. Its `id` and `label` name the profile: General reports `general` and no event. It also reports the server version and content/configuration revisions. An event profile reports its own identifier and, when supplied, an `event` object with its source revision and draft/frozen state. Read `network_status` for its checked SDK and network details, distinguishing live observations from dated catalog data.
3. Choose the narrow capability that answers the question. Argument-free `server_status`, `network_status`, `list_skills` and `list_packages` avoid sending task text during discovery; these are still network requests. Do not send a private schema, logs, keys or source code to learn whether a tool exists.
4. Compare returned version/source dates with the project's installed SDK. Neither an available tool nor fetched skill text proves an example works.

A GET response, HTTP 405 or an old connector catalog is not a Streamable HTTP protocol test. See [protocol preflight](references/protocol-preflight.md) for an explicitly authorized direct HTTP check without installing or changing a connector. Report which connection and operation failed. If discovery is unavailable, use the local SDK/docs instead of inventing tool availability.

## Match tools to the task

The table lists General's capabilities. Event profiles can add or omit tools, so the connection's current `tools/list` and `prompts/list` remain the authority.

| Need | Capability on General | Skill to read |
| --- | --- | --- |
| Network/version context | `server_status`, `network_status` | `arkiv` |
| Primary knowledge/package documentation | `list_knowledge`, `search_knowledge`, `read_knowledge`, `list_packages`, `get_package` | Relevant core or library skill; minimize submitted search text |
| Served skill text | `list_skills`, `get_skill` | Use the locally installed task skill if missing, `recommended: false`, execution-incompatible or pinned older; record the served revision |
| Local workflow guidance | `get_workflow`; prompts `start`, `minimal_app`, `integrate_package`, `diagnose_query`, `apply_skill` | `arkiv-first-write`, `arkiv-query`, or the selected task skill; returned guidance does not execute writes |
| Design and create Arkiv entities from requirements | `get_workflow` with `name: "model_entities"` (also a prompt), optional `signingMode` `wallet` (preferred) or `local_env` after the developer chooses | `arkiv-data-modeling`, `arkiv-first-write`, `arkiv-write-safety` |
| Convert PostgreSQL `CREATE TABLE` text to an entity model | `generate_entity_model`: model only, no database connection, row migration or writes | `arkiv-data-modeling`, `arkiv-security-trust` |
| Entity/transaction public observation | `verify_entity`, `verify_tx` | `arkiv-query` for reads, `arkiv-write-safety` for receipts, `arkiv-entity-expiration` for absence, `arkiv-troubleshooting` |
| Optional minimized feedback/outcome | `submit_feedback`, `report_outcome` | `arkiv-feedback` |

`prepare_feedback` is a **prompt**, not a tool. Hosts without prompt support can use `get_workflow` with `{ "name": "prepare_feedback" }`. Prompt and workflow content guides local work; fetching it does not submit an issue or application. Discover arguments before use. No fixed tool counts or generic health badge establish current capability.

`design_entity_model` and the `prepare_devfolio` and `pillar_fit` workflows belong to the frozen Devfolio profile. `check_schema` and `check_submission` are event-profile validators. General exposes none of them. On General, use `model_entities` for entity design or `generate_entity_model` for an authorized PostgreSQL schema, and check event requirements against the active event's own sources. Do not change profiles to obtain a tool without authorization. If a connected profile lacks a verifier, inspect the receipt directly using [write safety](../arkiv-write-safety/SKILL.md) and read the entity with the SDK.

## Read the evidence boundary

- `network_status` checks the RPC chain ID live in the reviewed service; other onboarding/service entries are dated catalog observations. The same chain ID can survive a network reset. Recheck embedded transaction hashes, entity keys and reported blocks against the current RPC before citing them as current evidence. It does not test funding, a signing adapter or complete faucet/login flow.
- Knowledge/model tools do not run arbitrary entity queries. Use the local SDK/RPC for actual application reads. `verify_entity` and `verify_tx` are bounded development observations with no SLA, not a substitute for selected entity contents or a full application query.
- Public verification requires the tool's current acknowledgment fields (`publicEvidenceReviewed: true` in the reviewed schemas) and a reviewed public key/hash. Never submit secrets or private identifiers. Inspect **status, observation, warnings and error together**. On `rate_limited`, wait `retryAfterSeconds`; do not retry at once. A `not_found` result with `reason: "unknown"` does not prove expiration, deletion or nonexistence; only `reason: "expired"` reports an observed Entity Expiration. A successful receipt does not certify a particular entity content, finality, authorship or a working app.
- `generate_entity_model` returns a deterministic model and handoff; `needs-input` or `blocked` results are not ready to implement. Event validators, where an event profile exposes them, are shallow text checks. Neither certifies security, protocol acceptance, event eligibility or judging results. Verify generated names, types and code locally against the installed SDK.
- A skill catalog may lag the repository or serve unchanged examples. Record its source revision and warnings; prefer the installed current task skill when the served entry is missing, deprecated or older. Updating the service catalog belongs to its owner after repository integration.

For event work, use that event's own connection. Inspect `server_status.event` when present; otherwise read that profile's event guide. Check its current event sources, draft/frozen state and evidence checklist. Event workflows apply only if actually exposed. Preparing evidence is separate from submitting it.

## Writes and privacy

Writes happen in the developer's project through the SDK and authorized EOA, with a verified network, spending budget and read-back. A service requesting a private key is not an acceptable signing path. Keep signing keys out of URLs, prompts, tools and logs. Rabdi RPC access keys belong in the chain URL path, server-side for operator clients; never send those keyed URLs to MCP tools or logs. The MCP connection URL is separate from the RPC URL.

Read-only tool annotations describe effects, not confidentiality or absence of telemetry. The reviewed General descriptions state that `search_knowledge` telemetry keeps declared categories and strictly minimized search text, and that `generate_entity_model` telemetry keeps operation, status and counts, never schemas or their derivatives. Its schema argument still travels to the service, so send only schemas the developer is authorized to share; confidential schemas stay in the offline `postgres-to-entity` package. Review current descriptions and privacy terms before sending caller text; incomplete annotations are not a safety signal. A request to send nothing to the service means use local skills/SDK without MCP calls.

`submit_feedback` and `report_outcome` require explicit consent for the minimized fields and `sharingApproved: true` under the reviewed schemas. A boolean asserts consent; it does not obtain it. Do not infer a user opinion from the agent's success or claim best-effort acknowledgment guarantees storage. Never upload a full report as optional feedback or silently substitute it for a GitHub issue.

## Worked diagnosis

Request: “My post is missing.” Load `arkiv-troubleshooting` for the reported failure, `arkiv-query` for the read and [entity expiration](../arkiv-entity-expiration/SKILL.md) for the receipt/history procedure that distinguishes absence causes. Inspect installed SDK, chain, exact key, constructor types, actual schema names and indexing flags, creator/owner scope and Entity Expiration, and query locally with the SDK. `verify_entity` can add a bounded public observation of a reviewed key; a `not_found` with `reason: "unknown"` does not explain the cause, and only `reason: "expired"` indicates expiration. A missing tool or a rate limit does not mean the network is down; do not add another integration automatically.

Request: “The plugin used to show Global Tour Stop rules; now `check_submission` is gone.” Read `server_status`. A `general` profile is the current plugin connection and has no event rules; a `devfolio` profile is the ended, frozen event. Explain the difference, point to an active event's URL only if General's instructions list one, and leave the connection choice to the developer. A text check never authorizes or replaces an application submission.

Sources: [Arkiv gateway](https://mcp.arkiv.network/), [official SDK](https://www.npmjs.com/package/@arkiv-network/sdk/v/1.0.1), [Arkiv documentation](https://docs.arkiv.network). The 2026-10-25 review read General's tool and prompt catalog from the reviewed service source and confirmed the same names and descriptions through a classified `tools/list` and `prompts/list` on the production General connection; it made no event-profile request. Discover the connected profile again before relying on these observations.

## SDK/network catalog gate

Current local guidance targets SDK 1.0.x on Rabdi (7794095). A served catalog or network_status response can lag this repository. Read its actual source pin and warnings; do not treat an old served example as Rabdi-compatible. Configure SDK clients with rabdi({ accessKey }); the RPC key is an encoded URL path segment. Missing keys raise MissingAccessKeyError, and keyless access can return 429. Get free keys/funds through Hub access-keys/faucet. Verify remote tool behavior separately; this documentation change does not deploy a gateway.

Sources: [SDK 1.0.1 source](https://unpkg.com/@arkiv-network/sdk@1.0.1/src/), [SDK 1.0.1 README](https://unpkg.com/@arkiv-network/sdk@1.0.1/README.md). Inspect the installed declarations before adapting executable examples.
