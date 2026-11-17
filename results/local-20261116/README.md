# Four-model local inference campaign

**Full profile: 192/192 cases completed, zero infrastructure errors in the latest attempts.** All 16 mixed scenarios were replayed with the same explicit version-2 JSON contract. Output checks passed in 146 cases and failed in 46 cases. A failed output check is a measured model result, not an execution failure.

The plan contains 12 workloads in each of English, Simplified Technical English, Chinese and Russian for each of four model slots. This is one repetition of each workload. It is an observed workload campaign, not a confidence interval or a universal model ranking.

## Model overview

PP/TG below are arithmetic means of native request rates in tokens/s. TTFT is in milliseconds. Different tokenizers and generated response lengths affect comparisons. Full mean/median/min/max, weighted rates and every request are in the linked reports.

| Slot | Cases | Requests | PP mean | TG mean | TTFT mean | TTFT median | Output checks passed | Case wall hours |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| flash-next | 48/48 | 955 | 1364.50 | 194.30 | 828.06 | 524.39 | 38/48 | 1.657 |
| flash-next-uncensored | 48/48 | 1487 | 5712.53 | 167.67 | 1537.86 | 1344.79 | 30/48 | 4.209 |
| deepseek | 48/48 | 873 | 476.62 | 57.60 | 2002.86 | 1388.98 | 38/48 | 6.386 |
| deepseek-uncensored | 48/48 | 697 | 527.89 | 59.49 | 2182.73 | 1475.08 | 40/48 | 5.213 |

Latest attempts contain **4,012 inference requests**. Missing native PP: 0; missing native TG: 0; missing TTFT: 0.

Active suite time: **19.679 hours** (70844.32 s). End-to-end elapsed time: **20.484 hours** (73743.16 s). Case wall time sums the latest case attempts. Suite times also include recorded startup, validation, cooling, recovery and replay overhead; earlier attempts remain on disk.

## Read or download

- [Complete Markdown metric matrix](REPORT.md)
- [Standalone interactive HTML](report.html) (download and open locally)
- [Aggregated matrix CSV](matrix.csv)
- [Every case/repetition CSV](cases.csv)
- [Every inference request CSV](steps.csv)
- [Machine-readable report](report.json)
- [Final completeness and mixed-replay audit](RUN-AUDIT.json)
- [Standalone package installation verification](INSTALLATION.json)
- [Final backend, reservation and memory configuration check](FINAL-HEALTH.json)
- [Prose repetition audit](PROSE-AUDIT.md)
- [Method, settings and recovery protocol](../../docs/LOCAL-RUN.md)
- [CLI and report archives in release v0.1.0](https://github.com/alphamikle/llm_speed_test/releases/tag/v0.1.0)

## What the checks mean

Execution status and output checks are separate. The checks are authored deterministic sllm code, not an LLM judge. Real SQLite imports, JSON Schema checks, independently calculated totals, executed code tests and real Chromium interactions supply the evidence. Minimum page length, agent step/deadline limits and the Battleship median ceiling of 72 shots in 30 seeded games are benchmark choices. These checks do not certify literary merit or every semantic claim.

The independent repetition diagnostic flagged **25 of 32 screenplays** for review. These flags do not rewrite the original structural results. Screenplays use 50 explicit A4-equivalent page breaks and five-page generation batches; later batches receive bounded continuity text. STE uses constrained prompting and sentence audits, not licensed ASD-STE100 dictionary certification.

## Provenance and retained attempts

The shared mixed schema was clarified after an original prompt left the type of step unspecified. All 16 combinations were replayed, generating 96 new requests; earlier attempts were preserved. Final request summaries use the replacement attempts, rather than combining two different contracts. Execution segments record the source revisions used during development and recovery.

An existing lai watchdog interrupted the backend when a CPU core reached its unchanged 98 C limit. This was not an out-of-memory event. Recovery preserved the hardware guards, used five-second case intervals outside inference/kit timers, and retried infrastructure-error cases. The [thermal-event record](THERMAL-EVENT.json), [shell-policy audit](TOOL_POLICY_AUDIT.json) and [process-cleanup audit](PROCESS-CLEANUP-AUDIT.json) document operational changes. No generated project or response was manually repaired.

Client host: Intel(R) Core(TM) Ultra 9 285K; 24 logical CPUs; 188.08 GiB OS-reported RAM. GPU snapshot: NVIDIA GeForce RTX 5090, 595.99.02, 32607 MiB, 575.00 W. Inference used the direct local endpoint; slots distinguish regular/uncensored variants that share an API model ID.

Raw prompts, responses, SSE logs, Pi events, generated projects, screenshots and earlier attempts remain at `/home/alfa/Documents/LocalAI/artifacts/sllm/full-local-20261116`. They are not included in this compact Git snapshot or the report archive. Authentication fields are redacted from reports.
