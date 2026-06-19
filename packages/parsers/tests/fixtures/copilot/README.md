# Copilot OpenTelemetry parser fixtures (synthetic)

| File | Purpose | Expected behavior |
|------|---------|-------------------|
| `valid.jsonl` | chat + inference spans | sessions grouped by session.id, exact tokens |
| `missing-fields.jsonl` | non-usage spans only | empty sessions + OTEL setup warning |
| `corrupt.jsonl` | invalid line | warnings + valid spans |

Enable export with:
`COPILOT_OTEL_ENABLED=true`, `COPILOT_OTEL_EXPORTER_TYPE=file`, `COPILOT_OTEL_FILE_EXPORTER_PATH=~/.copilot/otel/usage.jsonl`
