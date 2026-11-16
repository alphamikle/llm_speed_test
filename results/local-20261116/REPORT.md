# sllm benchmark results

Profile: **full**. Finished 12/192 cases. Quality passes: 11. Active wall time: 2352.31 s.

PP/TG: native tokens/s. TTFT: milliseconds. Missing native values are shown as `n/a`.

| Model | Language | Kit | Quality | PP mean | PP median | PP min | PP max | TG mean | TG median | TG min | TG max | TTFT mean | Wall s | Steps |
|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| flash-next | en | 01-prose-short | pass | 3838.20 | 4255.66 | 557.22 | 4423.56 | 276.42 | 280.60 | 248.10 | 307.59 | 908.21 | 117.38 | 0.00 |
| flash-next | en | 02-prose-long | pass | 4598.95 | 4888.42 | 2652.83 | 4960.82 | 296.38 | 297.79 | 281.15 | 311.12 | 1173.80 | 115.98 | 0.00 |
| flash-next | en | 03-prose-summary-short | pass | 10694.46 | 10694.46 | 10694.46 | 10694.46 | 264.34 | 264.34 | 264.34 | 264.34 | 2869.63 | 10.82 | 0.00 |
| flash-next | en | 04-prose-summary-long | pass | 10625.60 | 10625.60 | 10625.60 | 10625.60 | 246.48 | 246.48 | 246.48 | 246.48 | 2979.77 | 8.73 | 0.00 |
| flash-next | en | 05-sql-generation | pass | 595.29 | 595.29 | 595.29 | 595.29 | 195.18 | 195.18 | 195.18 | 195.18 | 484.08 | 6.29 | 0.00 |
| flash-next | en | 06-json-generation | pass | 489.77 | 489.77 | 483.35 | 496.19 | 449.50 | 449.50 | 394.23 | 504.78 | 616.83 | 62.92 | 0.00 |
| flash-next | en | 07-json-prefill | fail | 10022.44 | 10022.44 | 10022.44 | 10022.44 | 105.26 | 105.26 | 105.26 | 105.26 | 18959.21 | 20.39 | 0.00 |
| flash-next | en | 08-code-generation | pass | 585.43 | 585.43 | 585.43 | 585.43 | 220.89 | 220.89 | 220.89 | 220.89 | 695.73 | 10.44 | 0.00 |
| flash-next | en | 09-code-prefill | pass | 10478.18 | 10478.18 | 10478.18 | 10478.18 | 187.64 | 187.64 | 187.64 | 187.64 | 9908.52 | 13.12 | 0.00 |
| flash-next | en | 10-agent-battleship | pass | 662.91 | 372.15 | 115.58 | 4322.99 | 180.55 | 173.68 | 101.55 | 349.83 | 537.35 | 1045.18 | 149.00 |
| flash-next | en | 11-agent-repair | pass | 524.12 | 247.62 | 117.29 | 1688.26 | 172.75 | 167.52 | 102.93 | 246.13 | 467.64 | 87.85 | 21.00 |
| flash-next | en | 12-mixed-iterations | pass | 1953.65 | 327.50 | 317.82 | 10067.64 | 179.22 | 179.59 | 165.77 | 193.55 | 1010.08 | 52.00 | 0.00 |
