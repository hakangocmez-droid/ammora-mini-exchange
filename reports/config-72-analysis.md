# Ammora GIWA Sepolia — Config #72 Technical Analysis

**Assessment date:** 23 November 2026  
**Network:** GIWA Sepolia, chain ID 91342  
**Registry entry:** Config #72 — Enabled  
**Evidence basis:** Values transcribed from the user's Config Explorer output at a verified finalized block. This is a configuration review, not a live token/curve audit.

## Executive summary

Config #72 is enabled. Ammora SDK 0.3.9 documentation defines migrationMode 0 as concentrated. Its visible fee settings specify a 20% cliff fee, 19 periods, 15 seconds per period and a 100-bps reduction factor. If feeSchedulerMode 1 uses the documented linear schedule, the illustrative fee path falls by one percentage point every 15 seconds, reaching 1% after 19 reductions (4 minutes 45 seconds). The exact enum semantics and first-reduction boundary still need source-level confirmation.

creatorShareOfNonProtocolBps = 3000 means the Creator receives 30% of the non-Protocol portion; the Partner receives the remaining 70%. It does not mean 30% of trading volume. The configured post-migration fee is 1%. Dynamic fees and the rate limiter are disabled.

The LP distribution fields show 62.5% partner permanent-lock allocation and 37.5% creator permanent-lock allocation. The displayed unlocked and vesting fields are zero. These are configuration values, not proof of current liquidity, an active LP position, realized fees or future returns.

**Preliminary verdict:** Inspectable and enabled, but not yet qualified as a safe launch template. Graduation readiness, quote-token metadata/policy, complete segment coverage, recipient authority and derived reserve reconciliation remain unverified.

## 1. Registry identity

| Field | On-chain value |
|---|---|
| Config ID | 72 |
| Enabled | true |
| Owner | 0xFa256d8b6F73f719b88F8e4281d6741184F9B88C |
| Fee claimer | 0xFa256d8b6F73f719b88F8e4281d6741184F9B88C |
| Partner recipient | 0xFa256d8b6F73f719b88F8e4281d6741184F9B88C |
| Quote token | 0x4200000000000000000000000000000000000006 |
| Created at block | 41,935,575 |
| Migration mode | 0 (Concentrated per SDK guide) |
| Segments | At least one visible in supplied excerpt; full array not included |

## 2. Fee policy

| Field | Raw value | Interpretation |
|---|---:|---|
| cliffFeeBps | 2,000 | 20% initial fee |
| feeNumberOfPeriods | 19 | 19 scheduled reduction periods |
| feePeriodFrequency | 15 | 15-second period frequency |
| feeReductionFactorBps | 100 | 1 percentage-point reduction per period, conditional on scheduler mode semantics |
| feeSchedulerMode | 1 | Enum value; exact label not inferred |
| creatorShareOfNonProtocolBps | 3,000 | Creator gets 30% of non-Protocol share; Partner gets 70% |
| postMigrationFeeBps | 100 | 1% post-migration fee |
| postMigrationFeeNumberOfPeriods | 0 | No post-migration period schedule configured |
| postMigrationFeePeriodFrequency | 0 | No post-migration period frequency configured |
| postMigrationFeeReductionFactorBps | 0 | No post-migration reduction configured |
| postMigrationFeeSchedulerMode | 0 | Enum value; label not inferred |
| dynamicFeeEnabled | false | Dynamic fee disabled |
| rateLimiterEnabled | false | Rate limiter disabled |
| enableFirstSwapWithMinFee | false | First-swap minimum-fee option disabled |

### Illustrative initial fee schedule

Assuming mode 1 applies a linear 100-bps reduction once per 15-second period:

| Elapsed time | Fee |
|---:|---:|
| Start | 20% |
| 15 sec | 19% |
| 30 sec | 18% |
| 1 min | 16% |
| 2 min | 12% |
| 3 min | 8% |
| 4 min | 4% |
| 4 min 45 sec | 1% |

This is a parameter-derived illustration, not an observed transaction-fee trace. Exact first-reduction timing and enum semantics must be confirmed against the SDK/contract implementation.

### Creator / Partner split

The Creator percentage applies after the Protocol share is removed. The remaining non-Protocol fee share is split 30% Creator / 70% Partner. Protocol share is separately determined by deployed fee policy. After graduation, LP fee accounting follows actual positions and fee rights; do not reuse the pre-graduation split formula.

## 3. Supply and graduation parameters

| Field | Raw on-chain value |
|---|---:|
| totalSupply | 562500000001232215 |
| tokenDecimals | 9 |
| migrationQuoteThreshold | 50000000000000000 |
| migrationBaseThreshold | 62500000001232215 |
| poolCreationFee | 0 |
| migrationQuoteFeeBps | 0 |
| creatorMigrationFeeShareBps | 0 |
| leftoverReceiver | 0xFa256d8b6F73f719b88F8e4281d6741184F9B88C |

Amounts are raw integer units. The base token has 9 configured decimals. Quote-token decimals and token policy were not included in the supplied excerpt, so the quote threshold is not converted into a human-readable amount. The thresholds alone do not prove that a new curve can graduate; sale supply, derived Graduation reserves and full inventory budget must be reconciled.

## 4. Post-migration pool and LP distribution

| Field | Raw value | Interpretation |
|---|---:|---|
| postMigrationFeeBps | 100 | 1% |
| postMigrationCompoundingFeeBps | 0 | No compounding share configured |
| postMigrationCollectFeeMode | 0 | Enum value; exact label not inferred |
| postMigrationSqrtMinPrice | 2608763565087129600 | Fixed-point price parameter; not converted here |
| postMigrationSqrtMaxPrice | 26087635650459832848 | Fixed-point price parameter; not converted here |
| postMigrationLiquidity | 1630477228185885111837621106422520111 | Raw fixed-point liquidity value; not a human token amount |
| partnerUnlockedBps | 0 | No partner unlocked allocation shown |
| partnerPermanentLockedBps | 6,250 | 62.5% partner permanent-lock allocation |
| creatorPermanentLockedBps | 3,750 | 37.5% creator permanent-lock allocation |
| partner vesting fields | all 0 | No partner vesting schedule shown |
| creator vesting fields | all 0 | No creator vesting schedule shown |
| lockedBaseVesting fields | all 0 | No locked-base vesting schedule shown |

The two permanent-lock allocations sum to 10,000 bps (100%). This describes configured allocation, not proof that LP has already been created or that a position is active.

## 5. Risk review

| Check | Assessment | Reason |
|---|---|---|
| Registry enabled | Pass | Config is enabled on-chain |
| Identity fields | Pass | Owner, fee claimer and partner recipient are present |
| Initial fee burden | Caution | 20% starting fee is high and may deter early trading |
| Fee schedule | Verify | Mode 1 enum and exact boundary behavior need SDK/contract confirmation |
| Dynamic fee / rate limiter | Caution | Both are disabled |
| Graduation readiness | Not established | Derived reserves and full sale-supply reconciliation not supplied |
| Quote-token units/policy | Not established | Quote decimals and protocol token policy not supplied |
| LP distribution | Inspect further | Lock split is configured, but actual position and ownership are not proven |
| Segment coverage | Not established | Full segments array and bounds were not included |
| Safety / future returns | Not established | Config values cannot establish liquidity, volume, returns or security |

## 6. Required checks before qualifying this Config

1. Read the complete Config #72 and every segment at the same verified finalized block.
2. Resolve quote-token metadata (decimals, symbol and protocol token policy) from the token contract.
3. Confirm feeSchedulerMode = 1 and feeReductionFactorBps semantics from the exact SDK 0.3.9 / contract implementation.
4. Use the official SDK preview/readiness flow to derive and reconcile sale supply and Graduation reserves; check all required inventory and thresholds.
5. Inspect the actual launched curve state and, if graduated, the canonical pool and LP position/NFT ownership.
6. Inspect protocol fee policy and actual Creator/Partner claim entitlements; Config ownership alone does not grant every fee right.

## 7. Safety boundaries

- Config #72 is not automatically recommended for a launch merely because it is enabled.
- Do not use quarantined Config #6. Ammora's current guide warns against it even when enabled.
- Config #10 is not an automatic replacement.
- This report does not perform wallet signatures, approvals, transactions, token launches, swaps, liquidity actions or claims.
- These are testnet configuration values, not an investment recommendation.

## Official references

- [Ammora SDK 0.3.9 launchpad guide](https://docs.ammora.org/guides/launchpad)
- [Ammora fee sharing and Creator/Partner split guide](https://docs.ammora.org/guides/fee-sharing)
- [Ammora SDK examples — Config reads and previews](https://docs.ammora.org/examples)
- [Ammora SDK quickstart](https://docs.ammora.org/guides/sdk-quickstart)
