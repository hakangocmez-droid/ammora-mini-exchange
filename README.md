# Ammora Launchpad Studio

A community-built GIWA Sepolia launchpad workspace using `@ammora-protocol/sdk@0.3.9`.

## Current scope
- Loads GIWA Sepolia launch records with `AmmoraDataApiClient` from the official Ammora SDK.
- Verifies the SDK's `giwaSepoliaAutoRouteDeployment` catalog is chain 91342 / Launch V4.
- Checks the public GIWA Sepolia RPC using viem.
- Optional wallet connection checks the active chain only; it does not request signatures.
- Local launch-brief configurator is a preview only. It does not create tokens or submit transactions.

## Run locally

Requires Node.js 22 or 24.

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Safety and scope

Testnet only. No private keys are stored. No approvals, signatures, transactions, token issuance, or real-fund actions are implemented. The app makes public read requests to Ammora's GIWA Sepolia Data API and RPC. The launch configurator is explicitly a local draft, not an on-chain launch plan.

## Official references
- https://docs.ammora.org/guides/sdk-quickstart
- https://www.npmjs.com/package/@ammora-protocol/sdk
- https://github.com/AmmoraLabs/ammora-examples
