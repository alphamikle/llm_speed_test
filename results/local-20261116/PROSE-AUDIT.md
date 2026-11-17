# Prose repetition audit

Post-run diagnostic only. Original validation and timing records are unchanged. A flag requests review; it is not a semantic quality verdict.

Audited 32/32 completed screenplay cases. Flagged 25; unavailable 0.

Compare five-token shingle multisets after NFKC/lowercase/number normalization; repeated shingles retain their frequency. Han characters are individual tokens. A page needs at least 100 tokens. Near duplicates have Dice similarity >= 0.90; internal repetition is flagged at >= 0.65. The first occurrence is excluded from the repeated-page count. This conservative heuristic does not certify plot continuity, factual accuracy or literary merit.

| Slot | Language | Kit | Structural pass | Later near-duplicate pages | Internally repetitive pages | Maximum page similarity | Audit |
|---|---|---|---|---:|---:|---:|---|
| deepseek | en | 01-prose-short | true | 2 / 50 | 0 | 0.9433 | review |
| deepseek | en | 02-prose-long | true | 17 / 50 | 0 | 1.0000 | review |
| deepseek | ru | 01-prose-short | true | 5 / 50 | 0 | 0.9820 | review |
| deepseek | ru | 02-prose-long | true | 18 / 50 | 0 | 1.0000 | review |
| deepseek | ste | 01-prose-short | true | 33 / 50 | 0 | 0.9410 | review |
| deepseek | ste | 02-prose-long | true | 24 / 50 | 0 | 1.0000 | review |
| deepseek | zh | 01-prose-short | false | 14 / 50 | 0 | 1.0000 | review |
| deepseek | zh | 02-prose-long | true | 29 / 50 | 0 | 1.0000 | review |
| deepseek-uncensored | en | 01-prose-short | true | 6 / 50 | 0 | 0.9327 | review |
| deepseek-uncensored | en | 02-prose-long | true | 18 / 50 | 0 | 1.0000 | review |
| deepseek-uncensored | ru | 01-prose-short | true | 35 / 50 | 0 | 1.0000 | review |
| deepseek-uncensored | ru | 02-prose-long | true | 20 / 50 | 0 | 0.9979 | review |
| deepseek-uncensored | ste | 01-prose-short | true | 0 / 50 | 0 | 0.8985 | no flag |
| deepseek-uncensored | ste | 02-prose-long | true | 4 / 50 | 0 | 1.0000 | review |
| deepseek-uncensored | zh | 01-prose-short | true | 22 / 50 | 0 | 0.9931 | review |
| deepseek-uncensored | zh | 02-prose-long | true | 35 / 50 | 0 | 1.0000 | review |
| flash-next | en | 01-prose-short | true | 0 / 50 | 0 | 0.1092 | no flag |
| flash-next | en | 02-prose-long | true | 2 / 50 | 0 | 1.0000 | review |
| flash-next | ru | 01-prose-short | true | 0 / 50 | 0 | 0.0122 | no flag |
| flash-next | ru | 02-prose-long | true | 2 / 50 | 0 | 1.0000 | review |
| flash-next | ste | 01-prose-short | true | 0 / 50 | 0 | 0.0856 | no flag |
| flash-next | ste | 02-prose-long | true | 15 / 50 | 0 | 1.0000 | review |
| flash-next | zh | 01-prose-short | true | 0 / 50 | 0 | 0.7871 | no flag |
| flash-next | zh | 02-prose-long | true | 9 / 50 | 0 | 1.0000 | review |
| flash-next-uncensored | en | 01-prose-short | true | 2 / 50 | 0 | 1.0000 | review |
| flash-next-uncensored | en | 02-prose-long | true | 2 / 50 | 0 | 1.0000 | review |
| flash-next-uncensored | ru | 01-prose-short | true | 0 / 50 | 0 | 0.0553 | no flag |
| flash-next-uncensored | ru | 02-prose-long | true | 4 / 50 | 0 | 1.0000 | review |
| flash-next-uncensored | ste | 01-prose-short | true | 0 / 50 | 0 | 0.6706 | no flag |
| flash-next-uncensored | ste | 02-prose-long | true | 1 / 50 | 1 | 1.0000 | review |
| flash-next-uncensored | zh | 01-prose-short | true | 14 / 50 | 0 | 1.0000 | review |
| flash-next-uncensored | zh | 02-prose-long | true | 5 / 50 | 0 | 1.0000 | review |
