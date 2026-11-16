# sllm

A cross-platform CLI for reproducible LLM inference and coding-agent benchmarks.

**12 workloads × 4 languages × any number of model slots.** Native PP/TG, honest client estimates, TTFT, every agent inference step, tool durations, quality checks, resumable execution and a searchable HTML/CSV matrix.

## Install

Install Node.js 24.10 or newer on Linux, Windows or macOS, plus Git for the source installation command below:

```sh
npm install -g --allow-scripts=sllm git+https://github.com/alphamikle/llm_speed_test.git
sllm --help
sllm doctor --offline
```

Pi 1.5.2 is an automatically installed runtime dependency. The installation also downloads Playwright Chromium for actual browser tests and creates the user YAML config. There is no separate global Pi installation. An existing Pi or a different JSON-event CLI can be selected in YAML. For an air-gapped install, set `SLLM_SKIP_BROWSER_INSTALL=1` and provision Chromium with `npx playwright@1.65.1 install chromium` before running browser workloads. Linux servers may need the OS libraries listed by `npx playwright@1.65.1 install-deps chromium`. The version must match the pinned Playwright dependency so its browser revision is available.

The package can also be built and installed from a checkout with `npm ci && npm install -g .`. CI tests installation and behavior on Linux, Windows and macOS. A registry publication is not required for Git installation.

## Configure slots

```sh
sllm init
sllm config path
sllm slot add server --base-url http://localhost:8000/v1 --model my-model
sllm --slot server doctor
```

Configuration locations:

| Platform | File |
|---|---|
| Linux | `$XDG_CONFIG_HOME/sllm/config.yaml`, or `~/.config/sllm/config.yaml` |
| macOS | `~/Library/Application Support/sllm/config.yaml` |
| Windows | `%APPDATA%\sllm\config.yaml` |

`SLLM_CONFIG` or `--config` overrides the location. A `default` slot is created automatically. Additional slots are unlimited. Prefer `api_key_env` instead of storing secrets. Reports redact authentication fields.

Slot names contain 1-80 ASCII letters, digits, periods, hyphens or underscores and start with a letter or digit. Names are unique ignoring case, cannot contain `..` or end with a period, and exclude [reserved Windows device names](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file). These rules keep result directories portable across the supported systems.

```yaml
version: 1
defaults:
  slot: default
  profile: full
  repetitions: 1
  languages: [en, ste, zh, ru]
  output_dir: ./benchmark-results
  max_output_tokens: 16384
  timeout_seconds: 1800
  retries: 2
  repair_attempts: 2
  agent_timeout_seconds: 3600
  agent_max_steps: 100
agent:
  provider: pi
  tool_timeout_seconds: 180
  thinking: off
  context_window: 131072
  max_tokens: 8192
  compat:
    supportsStore: false
    supportsDeveloperRole: false
    supportsReasoningEffort: false
    supportsUsageInStreaming: true
slots:
  default:
    base_url: http://localhost:8000/v1
    model: my-model
    api_key_env: MY_API_KEY
    request: {}
  another-model:
    base_url: https://example.org/v1
    model: another-model
    api_key_env: ANOTHER_API_KEY
```

`slot.request` passes provider-specific sampling/reasoning fields to the API and the metering proxy used by Pi. It cannot override the benchmark's model, messages or streaming mode. Set `stream_options: false` for servers that reject streaming usage. Missing usage or native timings remain explicitly unavailable. `startup: {command: lai, args: [start, deepseek, --uncensored], timeout_seconds: 900}` can prepare a local model before its slot. Commands use argument arrays, not a shell string.

For reasoning-model endpoints that reject `max_tokens`, set the slot's `output_token_field: max_completion_tokens`. Set `request: {temperature: null}` to omit unsupported sampling parameters. Pi's own provider compatibility fields can be set in `agent.compat`. Endpoint-specific requirements are configuration, not silently guessed measurements.

## Run

```sh
# Small SQL installation/transport check, explicitly labeled smoke
sllm --slot server run --profile smoke --languages en --kits 05 --output ./smoke

# The complete 48-case workload for each model
sllm run --slots default,another-model --languages en,ste,zh,ru --output ./matrix

# Continue with exactly the same settings and prompts
sllm run --slots default,another-model --languages en,ste,zh,ru --output ./matrix --resume

# Include dependency workloads automatically
sllm --slot server run --kits 03,07,09 --languages en

# Route non-agent workloads through Pi as well
sllm --slot server run --via pi --profile smoke --languages en

sllm report ./matrix
sllm audit-prose ./matrix
```

The full matrix is intentionally expensive. Each of the two screenplays contains 50 explicitly paginated A4-equivalent pages with a minimum text length, generated in bounded page batches. Each batch has its own measured prefill and decode. Later batches receive up to the last 14,000 characters of prior output as continuity context. These requests are measured separately from the short initial prompt. The HTML screenplay artifact uses real A4 print page breaks. The detailed counterpart repeats a coherent historical/scientific dossier, including twelve secondary characters.

The smoke profile reduces direct prose/data volumes. Agent kits still request complete projects and can take substantial time; use `--kits 05` for a quick transport check. For a single long-decode screenplay request, choose `--page-batch 50` and an output budget large enough for the endpoint. The default five-page batches support smaller output limits without silently treating an incomplete screenplay as a full result.

## Workloads

| Kit | Input and output | Independent evaluation |
|---|---|---|
| 01 | Short-premise science-fiction screenplay, 50 pages | Page sequence, text length, language audit |
| 02 | Detailed Civil War / alien invasion love story, 50 pages | Page sequence, text length, continuity dossier preserved |
| 03 | Summarize actual output from 01 | JSON structure, chronology and causal-link counts |
| 04 | Summarize actual output from 02 | Same structured evaluation |
| 05 | SQLite population with at least 5,000 related rows | Real import, constraints, foreign keys, integrity and counts |
| 06 | 256-item related logistics JSON | JSON Schema, exact count, unique IDs, references and capacity |
| 07 | Large deterministic JSON corpus plus output from 06 | Exact independently calculated counts and totals |
| 08 | Event-processing JavaScript library | Executed external behavior tests, CSV and numeric boundaries |
| 09 | Large code corpus plus output from 08 | Seeded defect detection |
| 10 | Pi builds and tests browser Battleship with SVG assets | Project tests, 30 external AI games, actual desktop/mobile Chromium interaction and screenshots |
| 11 | Pi repairs a flawed inventory HTTP service | Project tests and external transactional/API contracts |
| 12 | Six sequential mixed prose/JSON/code tasks | Step schemas, history continuity and test-plan requirements |

The SQL workload counts rows after an actual import. Recursive CTEs are permitted, so 5,000 related rows do not require 5,000 literal INSERT statements. Code and agent workloads evaluate generated deliverables by executing them, rather than comparing output length alone.

Each kit has English (`en`), Simplified Technical English (`ste`), Simplified Chinese (`zh`) and Russian (`ru`) prompts. Programming interfaces stay English. Localized text exists only as benchmark data; all source code, comments, CLI messages and development documentation are English. STE is targeted through explicit instructions and audited sentence lengths; this is **not** a licensed ASD-STE100 dictionary compliance certificate. Semantic literary quality and the truth of arbitrary film claims are not certified by structural validators.

## Agent measurement

Pi runs with its own isolated configuration and workspace. A localhost streaming proxy measures each upstream inference request, including tool-driven turns. `agent-events.jsonl` retains Pi's events; request SSE logs and final usage remain available even when Pi discards provider-specific timing extensions. Tool execution time is separate from inference time. Bundled Pi shell commands have a 180-second execution deadline, configurable with `agent.tool_timeout_seconds` (0 disables it). The guard retains Pi's original tool schema and prompt metadata and does not rewrite the model's recorded arguments. Custom CLIs control their own tool deadlines. A step limit, total deadline and cancellation protect against endless agent loops. Workspaces execute generated code; use a disposable machine/container for untrusted remote models. The provided isolation is configuration isolation, not an OS sandbox.

Cancellation terminates subprocess trees. On Linux, each completed agent session also scans its dedicated workspace for orphaned background servers, browsers and test commands, records their process identities in `process-cleanup.json`, and stops them. This additional `/proc` sweep is Linux-specific; other platforms use process-tree cancellation. It is resource cleanup, not a security boundary.

For a Pi-native provider without an OpenAI-compatible endpoint, set `agent.native_provider`, `agent.native_model`, and the required credentials in `agent.env`. Such requests use Pi event timings and usage; native server PP is unavailable. An external event-producing CLI can be supplied through `agent.command` and `agent.args`; it must emit the documented Pi JSON event protocol. See [metrics](docs/METRICS.md).

## Results and errors

`report.html` is a standalone searchable/sortable matrix. `matrix.csv` aggregates repetitions; `cases.csv` retains each case; `steps.csv` contains every inference request; `report.json` is machine-readable. `run.json` checkpoints every case. Individual directories retain prompts, outputs, validation, raw SSE, agent events, generated projects, screenshots and failed attempts. Direct API credentials stay in the parent metering proxy. Explicitly configured Pi-native credentials follow Pi's environment/authentication behavior.

Every PP/TG/TTFT summary has mean, median, min, max, sample count and missing count; percentile and weighted rates are also available. One-sample statistics are valid but not an uncertainty estimate. Increase `--repetitions` for repeatability studies. Cached-token usage is reported, and cache eviction is never assumed. Full-run duration includes startup, tools, validators and orchestration.

`audit-prose` adds an independent post-run repetition diagnostic (`PROSE-AUDIT.json` and `.md`). It detects near-duplicate pages and extensive internal loops, including counters that change while the scene repeats. It never rewrites original structural validation or measured timings. A flag requests human review. Literary merit and plot continuity require separate review. Original output files must remain available for this audit.

Exit codes: `0` complete and quality checks passed; `1` configuration/runtime failure; `2` harness/request errors; `3` model output failed quality checks; `130` interrupted. A quality failure is a measured model result, not permission to silently replace its output. Retries and repair requests are retained and included in timing totals. Resume rejects changed workload identities and prevents two processes from writing the same run.

## Develop

```sh
npm ci
npm test
npm run check
```

Tests use deterministic mock servers for fragmented Unicode SSE, missing timings, stream failures, retries, proxy telemetry, configuration errors, data validation, run resumption and CLI behavior. Real model runs are stored separately and clearly labeled.

Pi integration follows its [official JSON event protocol](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/json.md) and [custom model configuration](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/models-configuration.md).
