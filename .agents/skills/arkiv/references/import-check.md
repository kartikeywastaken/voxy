# Installed import check

Run `node <installed-skill-directory>/scripts/check-imports.mjs <file>` from the application workspace. It reads direct named imports, package export maps and installed declarations without executing application code or requesting the network. The JSON distinguishes `measured:false` from supported imports and definite missing names/subpaths.

The router's Claude PostToolUse hook is advisory when that host supports it and CLAUDE_PLUGIN_ROOT is set. Other hosts can run the explicit script. Neither invocation certifies the code's types, chain, schema/indexing or actual skill use. Missing Node, unreadable files, unsupported syntax and unavailable declarations remain unmeasured.

SDK 1.0.x uses `rabdi` from the chains subpath and `defineSchema`/typed constructors from the schema subpath. The [published-import fixture](../../../tests/snippets/published-imports.mjs) obtains the official 1.0.0 and 1.0.1 tarballs, verifies registry integrity and checks installed declarations without executing package scripts. Synthetic tests exercise missing/present exports, aliases, comments, strings, unrelated imports, resolver ambiguity and bounded reads.

The checker supports static named imports and explicit non-wildcard subpath maps. Unsupported conditional roots, fallback arrays, unknown conditions, dynamic/CommonJS/namespace/default imports, ambient declarations and external reexports remain unmeasured. Supported declaration branches are read conservatively as a union, not as proof of one resolver's compatibility. A declaration file is read once, with at most 128 files per check.

Diagnostics echo only plain package subpaths and bounded identifier names. Non-plain names/specifiers leave the file unmeasured and are never echoed. This is not a secret scanner or TypeScript compiler. Run the actual strict compiler against the application's installed version for executable examples.
