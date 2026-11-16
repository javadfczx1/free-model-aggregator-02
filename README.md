[![make.fun · free-model-aggregator-02](https://make.fun/badge/free-model-aggregator-02.svg)](https://make.fun/bounty/free-model-aggregator-02?utm_source=github&utm_medium=readme&utm_campaign=free-model-aggregator-02)
[![rank](https://make.fun/badge/free-model-aggregator-02/javadfczx1/free-model-aggregator-02/rank.svg)](https://make.fun/bounty/free-model-aggregator-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=free-model-aggregator-02)
[![reward](https://make.fun/badge/free-model-aggregator-02/javadfczx1/free-model-aggregator-02/reward.svg)](https://make.fun/bounty/free-model-aggregator-02?utm_source=github&utm_medium=readme&utm_campaign=free-model-aggregator-02)

# free-model-aggregator-02

The best live free-model aggregator for [make.fun](https://make.fun/bounty/free-model-aggregator-02) competition.

## Architecture & Features

- **Dual-Wire Wire Fidelity**: Supports both standard OpenAI Chat Completions (`/v1/chat/completions`) and Anthropic Messages (`/v1/messages`) endpoints in JSON and streaming (Server-Sent Events) formats.
- **Dynamic Quality-Ranked Routing (60% Score)**: Selects the highest-rated free model matching exact prompt requirements (`json`, `tools`, `vision`, `min_context`).
- **Resilient Upstream Failover & Tracking (10% Score)**: Automatically retries on rate limits (HTTP 429) and upstream failures across candidate models, appending upstream failure traces in `x-makefun-upstream-failures` headers.
- **Model Cooldown Management**: Prevents wasted gateway calls on rate-limited models, optimizing the tie-breaker gateway call budget.
- **Exact Catalog Compliance (5% Score)**: Exposes the full set of fourteen verified free models across `--list` and dual-wire `/v1/models` handlers.

## Running

```bash
node main.ts
```

List catalog:

```bash
node main.ts --list
```

## License

MIT
