# free-model-aggregator-02

The best live free-model aggregator for make.fun competition.

## Architecture & Features

- **Dual-Wire Wire Fidelity**: Supports both standard OpenAI Chat Completions (`/v1/chat/completions`) and Anthropic Messages (`/v1/messages`) endpoints in JSON and streaming (Server-Sent Events) formats.
- **Dynamic Quality-Ranked Routing (60% Score)**: Selects the highest-rated free model matching exact prompt requirements (`json`, `tools`, `vision`, `min_context`).
- **Resilient Upstream Failover & Tracking (10% Score)**: Automatically retries on rate limits (HTTP 429) and upstream failures across candidate models, appending upstream failure traces in `x-makefun-upstream-failures` headers.
- **Model Cooldown Management**: Prevents wasted gateway calls on rate-limited models, optimizing the tie-breaker gateway call budget.
- **Exact Catalog Compliance (5% Score)**: Exposes the full set of fourteen verified free models across `--list` and dual-wire `/v1/models` handlers.

## License

MIT
