# Ammora Launchpad Studio — Delivery Roadmap

## Goal
Deliver a reliable, read-first launchpad workspace for GIWA Sepolia (chain ID 91342), then add guided launch preparation. Keep the default path free and non-custodial.

## Current status (23 Nov 2026)
- [x] Verify SDK deployment catalog is GIWA Sepolia / Launch V4.
- [x] Verify chain ID, finalized block and V4 core contracts through public RPC.
- [x] Read Config Registry directly on-chain; optional Data API failure does not block the registry.
- [x] Paginate Configs (5 per page) and inspect nested Config details.
- [x] Search loaded Configs and filter enabled / disabled / quarantined states.
- [x] Explicitly quarantine Config #6 in the UI.
- [x] Deploy the current search/filter release through GitHub Actions.
- [ ] Add direct lookup by Config ID so any registry entry can be inspected without paging through earlier entries.
- [ ] Add a structured Config risk report (fees, quote token, curve/segments, migration and graduation settings) using only fields verified in the SDK/on-chain response.
- [ ] Add side-by-side Config comparison and safe/unsafe warnings.
- [ ] Add launch draft templates and parameter validation.
- [ ] Add SDK preview / unsigned-plan generation, if supported by the installed SDK version.
- [ ] Add optional wallet-assisted execution only after preview and explicit user approval; never store private keys or auto-submit.

## Fast delivery sequence
### 1. Finish the Explorer
1. Direct Config ID lookup.
2. Config detail normalization and readable field labels.
3. Compare two Configs.
4. Test registry reads, pagination, filtering, mobile layout and RPC fallback.

### 2. Add Config Intelligence
1. Derive fee schedule, quote token, segment/curve and migration facts from verified fields.
2. Add risk checks and explain each warning.
3. Keep Config #6 quarantined. An enabled flag alone is not a safety assessment; Config #10 is not an automatic replacement.

### 3. Build the Launch Studio
1. Save editable local launch drafts and templates.
2. Validate name, symbol, supply and Config parameters.
3. Generate a read-only SDK preview / unsigned plan where the SDK supports it.
4. Show required approvals and actions without signing or sending.

### 4. Test and release
1. Run TypeScript/Vite production build after each change.
2. Verify the GitHub Pages deployment and check browser console/network errors.
3. Test against the verified GIWA Sepolia RPC and document any public-RPC rate limits.
4. Release in small, reversible commits.

## Guardrails
- GIWA Sepolia only; no mainnet execution.
- No real-money funding, paid APIs, or user-funded gas.
- No private-key collection or storage.
- No automatic approvals, signatures, transactions, token issuance, swaps or liquidity actions.
- Wallet connection is optional and must never imply that a transaction has been sent.
- Every protocol-specific warning must be grounded in official documentation or verified on-chain data.

## Architecture direction
Keep the Vite + TypeScript frontend, but split the current large entry point into focused modules as the Explorer and Studio grow:
- `src/chain/`: chain definition, RPC fallback, finalized-block and deployment verification.
- `src/ammora/`: SDK registry reads and Config normalization.
- `src/features/config-explorer/`: listing, search, filters, details and comparison.
- `src/features/launch-studio/`: drafts, templates and validation.
- `src/ui/`: shared rendering and formatting helpers.

Do the split incrementally after Explorer behavior is stable; avoid a risky full rewrite.

## Definition of done
The Explorer is complete when any Config can be fetched directly by ID, inspected, compared and risk-reviewed at a verified finalized block. The Studio is complete when a user can create and validate a launch draft and inspect an SDK preview without signing or sending a transaction. Any later execution feature remains opt-in, testnet-only and explicitly user-approved.
