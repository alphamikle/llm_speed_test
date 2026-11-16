# Local matrix protocol

The requested machine exposes four `lai` variants. They share a physical GPU and run sequentially, never as concurrent benchmark clients in the full matrix.

| Slot | Preparation | API model |
|---|---|---|
| flash-next | `lai start qwen` | qwen3.8-flash-next |
| flash-next-uncensored | `lai start qwen --uncensored` | qwen3.8-flash-next |
| deepseek | `lai start deepseek` | deepseek-v4.1-flash |
| deepseek-uncensored | `lai start deepseek --uncensored` | deepseek-v4.1-flash |

All slots use the direct local endpoint `http://127.0.0.1:1111/v1`. The model is prepared before warmup. The shared gateway is not used for benchmark timing. The measured model name is preserved, and the slot name distinguishes variants with the same API ID.

Run configuration: full profile, one repetition, all 12 kits, all four languages, temperature zero, thinking disabled through the endpoint's request fields, maximum output 16,384 tokens per direct call, Pi 1.5.2 with an 8,192-token per-turn budget, 100-turn agent limit and one additional agent repair session at most. Prose is generated in five-page batches, each with native/server timing and client TTFT. Generated code and data can receive up to two correction requests; these are included in metrics.

The complete plan is 192 cases, 32 screenplays and 1,600 explicitly paginated screenplay pages, before validation failures. There are 32 coding-agent tasks. Every upstream agent request is recorded as its own inference step. Full results must not be replaced by smoke results.

Development checks completed before the full run:

- All six OS/runtime combinations passed CI: Linux, Windows and macOS on Node 24 and 26.
- The ten-case English API smoke completed without harness errors. Eight outputs passed quality checks; exact JSON arithmetic and one generated library did not. Ambiguous library contract wording was made explicit before the full run.
- Real bundled Pi executed tools against a deterministic mock endpoint with every inference step measured by the proxy.
- A real-model Pi-only SQL smoke completed with a valid SQLite import.
- Browser validation uses actual Chromium, not a simulated DOM.

Raw local output lives under the configured `output_dir`; committed matrix reports will identify the actual run directory, source revision, observed completion counts and failures. Model-created projects, raw prompts and SSE logs remain local to avoid inflating Git history. Authentication fields are redacted from committed reports.
