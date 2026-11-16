# Local matrix protocol

The requested machine exposes four `lai` variants. They share a physical GPU and run sequentially, never as concurrent benchmark clients in the full matrix.

| Slot | Preparation | API model |
|---|---|---|
| flash-next | `lai start qwen` | qwen3.8-flash-next |
| flash-next-uncensored | `lai start qwen --uncensored` | qwen3.8-flash-next |
| deepseek | `lai start deepseek` | deepseek-v4.1-flash |
| deepseek-uncensored | `lai start deepseek --uncensored` | deepseek-v4.1-flash |

All slots use the direct local endpoint `http://127.0.0.1:1111/v1`. The model is prepared before warmup. The shared gateway is not used for benchmark timing. The measured model name is preserved, and the slot name distinguishes variants with the same API ID.

Run configuration: full profile, one repetition, all 12 kits, all four languages, temperature zero, thinking disabled through the endpoint's request fields, maximum output 16,384 tokens per direct call, Pi 1.5.2 with an 8,192-token per-turn budget, 100-turn agent limit and one additional agent repair session at most. Individual Pi shell commands are bounded to 180 seconds; an agent session has a 3,600-second deadline. Prose is generated in five-page batches, each with native/server timing and client TTFT. Generated code and data can receive up to two correction requests; these are included in metrics.

The complete plan is 192 cases, 32 screenplays and 1,600 explicitly paginated screenplay pages, before validation failures. There are 32 coding-agent tasks. Every upstream agent request is recorded as its own inference step. Full results must not be replaced by smoke results.

Development checks completed before the full run:

- All six OS/runtime combinations passed CI: Linux, Windows and macOS on Node 24 and 26.
- The ten-case English API smoke completed without harness errors. Eight outputs passed quality checks; exact JSON arithmetic and one generated library did not. Ambiguous library contract wording was made explicit before the full run.
- Real bundled Pi executed tools against a deterministic mock endpoint with every inference step measured by the proxy.
- A real-model Pi-only SQL smoke completed with a valid SQLite import.
- Browser validation uses actual Chromium, not a simulated DOM.

Raw local output lives under the configured `output_dir`; committed matrix reports will identify the actual run directory, source revision, observed completion counts and failures. Model-created projects, raw prompts and SSE logs remain local to avoid inflating Git history. Authentication fields are redacted from committed reports.

During the initial full agent case, Pi cancelled one upstream request, recovered, and finished with exit code zero. The harness incorrectly treated the recovered request as a session failure. This was fixed with a dedicated integration regression test. The active agent case was interrupted and rerun from a fresh workspace; the first nine completed API cases were retained. Failed/interrupted attempts remain in local artifacts. Execution segments record source revisions and interruption time rather than silently omitting development/recovery overhead.

The Chinese agent subsequently started a test command without a tool deadline. A trusted Pi execution wrapper now supplies the configurable 180-second shell deadline while retaining the exact built-in schema, description and prompt metadata. The interrupted Chinese case was restarted. Completed English/STE agent cases were retained because their longest recorded command was 80.55 seconds, below the new cap; `results/local-20261116/TOOL_POLICY_AUDIT.json` contains the audit. A real-Pi regression compares provider-visible prompts and schemas with the guard enabled and disabled and verifies that execution arguments do not mutate recorded model arguments.

A later resource audit found 40 idle orphan processes from the completed Flash Next Uncensored STE game. Its shell commands had created independent process groups, including GNU `timeout` and browser processes, which survived the original parents. Those owned workspace processes were stopped and their identities retained in the local `process-cleanup-audit.json`. Agent shutdown now supplements portable process-tree cancellation with a Linux workspace scan and identity-checked termination; a regression verifies orphan removal while preserving an unrelated process. Timeout cancellation also reaches inherited output pipes after their process-group leader exits. This cleanup occurs after model execution and does not alter prompts, tool schemas or native inference measurements. The matrix records the source revision at the next resume, and earlier measured cases remain intact.

The cleanup fix was loaded after 117 completed cases. The unfinished DeepSeek STE game was interrupted and restarted from a fresh workspace; its earlier attempt remains in local artifacts. `PROCESS-CLEANUP-AUDIT.json` in the committed results records the old orphan sweep. Separate `PROSE-AUDIT` files diagnose exact/near duplicate pages and internal loops after inference; these diagnostics leave the original structural checks and throughput statistics intact. For example, DeepSeek's STE short screenplay has 33 later near-duplicate pages despite satisfying the original 50-page format check. Structural pass counts must therefore not be interpreted as literary quality scores.

At 132 completed cases, the DeepSeek Chinese mixed workload exposed an underspecified output contract. The prompt named `step` but did not declare its type; the model consistently returned strings `6-1` through `6-6` while the validator expected integers. All six responses otherwise contained the requested fields and at least three tests. The corrected runner appends an explicit, shared JSON Schema and validates against it, recording mixed contract version 2. After the initial matrix finishes, all sixteen mixed cases must be rerun using `--resume --rerun-kits 12`; their existing generated inputs are reused and original attempts remain in their artifact directories. The final matrix must contain contract version 2 for every mixed case. The initial process used its originally loaded code and unchanged locale files; later executions record their new source revision and output-contract version.

DeepSeek Uncensored completed its first four English cases before the existing `lai` watchdog stopped the backend at 22:48:14 UTC on November 16. The recorded reason was CPU core 24 reaching the unchanged 98 C limit; GPU temperature peaked at 72 C and model swap remained zero. The old runner then accumulated 44 infrastructure errors while the endpoint was offline. Original attempts and a compact thermal-event record are retained. The corrected runner stops after a lost endpoint, preserves connection failure codes, resumes infrastructure-error cases automatically, and counts only completed case executions as completed. Recovery uses five-second intervals before cases, outside inference and kit timers and inside suite elapsed time. CPU/GPU settings, model parameters, thermal limits and watchdog protection remain unchanged. All sixteen mixed cases still require the contract-v2 rerun after infrastructure recovery.
