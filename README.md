# Autonomous-UI-Lab

## Run the full product

```sh
./demo.sh                 # SpacetimeDB, worker (real adapters + Figma Make imports), dashboard, prototype
./demo.sh --e2e 6         # also drive the import flow through the dashboard (spends model credits)
./demo.sh --no-prototype  # imports only
```

Needs Node 22+, the SpacetimeDB CLI, Docker (for imported apps), and `BITDEER_*` / `ANTHROPIC_API_KEY` in `.env`.
Services already running are reused; Ctrl+C stops only what the script started. Logs: `.ghostloop/demo-logs/`.
See [`packages/importer/README.md`](packages/importer/README.md) for the import workflow.
