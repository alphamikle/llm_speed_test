# Measurement contract

All elapsed times use a monotonic clock. Wall-clock timestamps identify runs only.

- **TTFT**: request dispatch to the first nonempty model delta, including reasoning or tool arguments. Status notifications, empty role deltas and HTTP headers do not count. First visible answer latency is reported separately.
- **PP**: native uncached prompt tokens divided by native prompt-processing time. Cached tokens and the server's actual prompt count are preserved. A server that does not report this timing gets a null native PP value, never an invented measurement.
- **PP estimate**: uncached prompt tokens divided by client TTFT. This includes scheduling, network latency and first-token computation. It is labeled separately and must not be compared directly with native PP.
- **TG**: native generated-token count divided by native decode time when supplied. Otherwise the report includes a separately labeled client estimate based on provider output-token usage and observed streaming duration. SSE chunks are not tokens.
- **Statistics**: arithmetic mean, median, minimum, maximum, sample count, weighted throughput and percentiles. Nulls are excluded and missing counts are shown. Native and estimated throughput are separate columns.
- **Agent steps**: each upstream LLM request is a step, including repair, retry and compaction requests. Tool execution durations, tool names, arguments, exit states, token usage, stop reasons and the Pi event log are retained separately. Tool latency is not model decode time.
- **Kit wall time** includes request time, continuation/repair work, agent tools and validators. Suite wall time also includes model startup and orchestration. Both accumulated active duration and end-to-end elapsed duration are reported for resumed runs.

The full workload is large. A single full matrix is 48 cases for each model, before repetitions and continuations. A smoke run is explicitly labeled and is never presented as a full result. Model quality failures are results; transport/parser failures are harness errors and can be retried. All attempts remain in the audit trail.

Token counts are provider-reported. No universal tokenizer exists: missing token usage remains unknown. Local cache reset is not assumed; cached-token counts and reuse are reported. A warmup request is measured separately and excluded from case summaries.
