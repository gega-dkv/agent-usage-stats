# Local Log-Scanning Usage/Cost Module

This document ports the local-log scanning usage/cost logic from the CodexBar Swift codebase into a single, runnable TypeScript module. It covers only the scanners that read local log files on disk, not API/web fetchers that query provider billing endpoints.

## Provider sections

### A. Claude project logs scanner

Scans `*.jsonl` files under the Claude projects root, resolved in this order:

1. `CLAUDE_CONFIG_DIR` environment variable (comma-separated; each entry is used as-is if it ends in `projects`, otherwise `…/projects` is appended).
2. `~/.config/claude/projects`
3. `~/.claude/projects`

For every line that has `"type":"assistant"` and a `"usage"` block, the scanner parses the row, reads `timestamp`, `message.model`, and the usage fields `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, and `output_tokens`. Rows are deduplicated within a file by `message.id:requestId` so that streaming chunks collapse to the final cumulative chunk. Vertex AI rows can be filtered in, filtered out, or kept (`claudeLogProviderFilter`). Daily reports aggregate input, cache-read, cache-create, output, and cost per normalized model.

### B. Codex session logs scanner

Scans Codex session `.jsonl` files under `~/.codex/sessions` (or `$CODEX_HOME/sessions`), plus the optional `~/.codex/archived_sessions` root. Files are discovered in three ways:

- Date-partitioned directories: `YYYY/MM/DD/*.jsonl`.
- Flat files at the sessions root whose filename contains a `YYYY-MM-DD` date.
- Recursive legacy scan of the whole sessions tree.

The parser reads `session_meta` to obtain `session_id` and fork metadata. Forked sessions inherit token totals from their parent session at the fork timestamp so that inherited tokens are not double-counted. Usage rows are `event_msg` lines of subtype `token_count`; the scanner tracks both `last_token_usage` deltas and `total_token_usage` totals, preferring totals when they look more reliable, and clamps cached tokens to input tokens. `turn_context` lines update the current model; truncated `turn_context` lines are partially parsed to extract the model. The optional Codex Priority SQLite trace database is consulted to mark individual turns as priority and compute a surcharge.

### C. Pi session logs scanner (Codex & Claude)

Scans `~/.pi/agent/sessions/*.jsonl`. Pi sessions mix Codex and Claude turns, so each file contributes to one of those two providers. The scanner handles:

- `model_change` rows that set the current provider/model context (`openai-codex` maps to codex, `anthropic` maps to claude).
- `message` rows with `role == "assistant"` that carry usage.

Usage is read from many aliases (`input`, `input_tokens`, `prompt_tokens`, `cache_read`, `cache_creation_tokens`, `output`, `completion_tokens`, `total_tokens`, etc.). The resolved provider and normalized model name determine whether Codex or Claude pricing is applied. Daily reports can be built for either provider by summing only the contributions belonging to it.

### D. Grok local session scanner

Walks `~/.grok/sessions/**/signals.json` and aggregates local session statistics. Each `signals.json` contributes:

- `totalTokensBeforeCompaction`
- `contextTokensUsed`

Models are collected from `primaryModelId` and `modelsUsed`, then ranked by frequency. Only sessions whose file mtime is within the lookback window (default 30 days) are included. This scanner does not compute USD cost; it only returns token counts.

---

## `scanner.ts`

```typescript
import fs from "fs";
import path from "path";
import type Database from "better-sqlite3";

// MARK: - Shared types

export type UsageProvider = "claude" | "codex" | "vertexai" | "grok";

export type ClaudeLogProviderFilter = "all" | "vertexAIOnly" | "excludeVertexAI";

export interface ModelBreakdown {
    modelName: string;
    totalTokens: number;
    costUSD: number | null;
}

export interface DailyEntry {
    date: string; // YYYY-MM-DD
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalTokens: number;
    costUSD: number | null;
    modelsUsed: string[];
    modelBreakdowns: ModelBreakdown[];
}

export interface DailySummary {
    totalInputTokens: number;
    totalOutputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    totalTokens: number;
    totalCostUSD: number | null;
}

export interface DailyReport {
    data: DailyEntry[];
    summary: DailySummary | null;
}

export interface TokenSnapshot {
    sessionTokens: number;
    last30DaysTokens: number;
    last30DaysCostUSD: number | null;
}

export interface ScanOptions {
    home?: string;
    claudeLogProviderFilter?: ClaudeLogProviderFilter;
    codexSessionsRoot?: string;
    codexTraceDatabaseURL?: string;
    piSessionsRoot?: string;
    grokSessionsRoot?: string;
    lookbackDays?: number;
}

// MARK: - JSONL streaming reader

// Mirrors CostUsageJsonl.scan: reads a file from an offset, calls onLine for each
// newline-delimited chunk, and returns the total number of bytes consumed.
// Truncated lines keep up to prefixBytes in `bytes` and set `wasTruncated: true`.
export interface JsonlLine {
    bytes: Buffer;
    wasTruncated: boolean;
}

export function scanJsonl(
    filePath: string,
    offset: number,
    maxLineBytes: number,
    prefixBytes: number,
    onLine: (line: JsonlLine) => void,
): number {
    const fd = fs.openSync(filePath, "r");
    try {
        const startOffset = Math.max(0, offset);
        if (startOffset > 0) {
            fs.readSync(fd, Buffer.alloc(0), { position: startOffset });
        }

        let current = Buffer.alloc(0);
        let lineBytes = 0;
        let truncated = false;
        let bytesRead = 0;
        const chunkSize = 256 * 1024;
        const chunk = Buffer.alloc(chunkSize);

        function appendSegment(segment: Buffer) {
            if (segment.length === 0) return;
            lineBytes += segment.length;
            if (current.length < prefixBytes) {
                const appendCount = Math.min(prefixBytes - current.length, segment.length);
                current = Buffer.concat([current, segment.subarray(0, appendCount)]);
            }
            if (lineBytes > maxLineBytes || lineBytes > prefixBytes) {
                truncated = true;
            }
        }

        function flushLine() {
            if (lineBytes === 0) return;
            onLine({ bytes: current, wasTruncated: truncated });
            current = Buffer.alloc(0);
            lineBytes = 0;
            truncated = false;
        }

        // eslint-disable-next-line no-constant-condition
        while (true) {
            const n = fs.readSync(fd, chunk, 0, chunkSize, startOffset + bytesRead);
            if (n === 0) {
                flushLine();
                break;
            }
            bytesRead += n;
            const slice = chunk.subarray(0, n);
            let segmentStart = 0;
            for (let i = 0; i < slice.length; i++) {
                if (slice[i] === 0x0a) {
                    appendSegment(slice.subarray(segmentStart, i));
                    flushLine();
                    segmentStart = i + 1;
                }
            }
            if (segmentStart < slice.length) {
                appendSegment(slice.subarray(segmentStart));
            }
        }

        return startOffset + bytesRead;
    } finally {
        fs.closeSync(fd);
    }
}

// MARK: - Day-key helpers

function pad2(n: number): string {
    return n.toString().padStart(2, "0");
}

export function dayKey(date: Date): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function dayKeyFromTimestamp(text: string): string | null {
    // Fast path for ISO-8601-like timestamps, converted to the local calendar day.
    // Mirrors CostUsageScanner+Timestamp.dayKeyFromTimestamp.
    const bytes = Buffer.from(text, "utf8");
    if (bytes.length < 20) return null;
    if (bytes[4] !== 0x2d || bytes[7] !== 0x2d) return null;

    const year = parseInt(text.slice(0, 4), 10);
    const month = parseInt(text.slice(5, 7), 10);
    const day = parseInt(text.slice(8, 10), 10);
    if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) return null;

    let hour = 0;
    let minute = 0;
    let second = 0;
    if (bytes[10] === 0x54) {
        if (bytes.length < 19) return null;
        if (bytes[13] !== 0x3a || bytes[16] !== 0x3a) return null;
        hour = parseInt(text.slice(11, 13), 10);
        minute = parseInt(text.slice(14, 16), 10);
        second = parseInt(text.slice(17, 19), 10);
    }

    let tzSign = 0;
    let tzIndex: number | null = null;
    for (let idx = bytes.length - 1; idx >= 11; idx--) {
        const b = bytes[idx];
        if (b === 0x5a) {
            tzSign = 0;
            tzIndex = idx;
            break;
        }
        if (b === 0x2b) {
            tzSign = 1;
            tzIndex = idx;
            break;
        }
        if (b === 0x2d) {
            tzSign = -1;
            tzIndex = idx;
            break;
        }
    }
    if (tzIndex === null) return null;

    let offsetSeconds = 0;
    if (tzSign !== 0) {
        const offsetStart = tzIndex + 1;
        const hours = parseInt(text.slice(offsetStart, offsetStart + 2), 10);
        if (Number.isNaN(hours)) return null;
        let minutes = 0;
        if (bytes.length > offsetStart + 2) {
            if (bytes[offsetStart + 2] === 0x3a) {
                minutes = parseInt(text.slice(offsetStart + 3, offsetStart + 5), 10);
            } else if (bytes.length >= offsetStart + 4) {
                minutes = parseInt(text.slice(offsetStart + 2, offsetStart + 4), 10);
            }
        }
        offsetSeconds = tzSign * (hours * 3600 + minutes * 60);
    }

    const utc = Date.UTC(year, month - 1, day, hour, minute, second) - offsetSeconds * 1000;
    return dayKey(new Date(utc));
}

export function dayKeyFromParsedISO(text: string): string | null {
    const d = parseISO8601(text);
    return d ? dayKey(d) : null;
}

export interface DayRange {
    sinceKey: string;
    untilKey: string;
    scanSinceKey: string;
    scanUntilKey: string;
}

export function makeDayRange(since: Date, until: Date): DayRange {
    const sinceKey = dayKey(since);
    const untilKey = dayKey(until);
    const scanSince = new Date(since);
    scanSince.setDate(scanSince.getDate() - 1);
    const scanUntil = new Date(until);
    scanUntil.setDate(scanUntil.getDate() + 1);
    return {
        sinceKey,
        untilKey,
        scanSinceKey: dayKey(scanSince),
        scanUntilKey: dayKey(scanUntil),
    };
}

export function isInRange(dayKey: string, since: string, until: string): boolean {
    return dayKey >= since && dayKey <= until;
}

function parseISO8601(text: string): Date | null {
    // Handles both fractional and plain ISO-8601.
    const d1 = new Date(text);
    if (!Number.isNaN(d1.getTime())) return d1;
    return null;
}

function toInt(value: unknown): number {
    if (typeof value === "number") return Math.round(value);
    if (typeof value === "string") {
        const n = Number(value);
        return Number.isFinite(n) ? Math.round(n) : 0;
    }
    if (value && typeof value === "object" && "valueOf" in value) {
        const n = Number((value as { valueOf(): number }).valueOf());
        return Number.isFinite(n) ? Math.round(n) : 0;
    }
    return 0;
}

function toBool(value: unknown): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") return value.toLowerCase() === "true" || value === "1";
    return false;
}

// MARK: - Pricing tables

// Copied from CostUsagePricing.swift.
interface CodexPricing {
    inputCostPerToken: number;
    outputCostPerToken: number;
    cacheReadInputCostPerToken: number | null;
    thresholdTokens: number | null;
    inputCostPerTokenAboveThreshold: number | null;
    outputCostPerTokenAboveThreshold: number | null;
    cacheReadInputCostPerTokenAboveThreshold: number | null;
    priorityInputCostPerToken: number | null;
    priorityOutputCostPerToken: number | null;
    priorityCacheReadInputCostPerToken: number | null;
}

interface ClaudePricing {
    inputCostPerToken: number;
    outputCostPerToken: number;
    cacheCreationInputCostPerToken: number;
    cacheReadInputCostPerToken: number;
    thresholdTokens: number | null;
    inputCostPerTokenAboveThreshold: number | null;
    outputCostPerTokenAboveThreshold: number | null;
    cacheCreationInputCostPerTokenAboveThreshold: number | null;
    cacheReadInputCostPerTokenAboveThreshold: number | null;
}

const codexPriorityInputTokenLimit = 272_000;

const codexPricing: Record<string, CodexPricing> = {
    "gpt-5": { inputCostPerToken: 1.25e-6, outputCostPerToken: 1e-5, cacheReadInputCostPerToken: 1.25e-7, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null, priorityInputCostPerToken: null, priorityOutputCostPerToken: null, priorityCacheReadInputCostPerToken: null },
    "gpt-5-codex": { inputCostPerToken: 1.25e-6, outputCostPerToken: 1e-5, cacheReadInputCostPerToken: 1.25e-7, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null, priorityInputCostPerToken: null, priorityOutputCostPerToken: null, priorityCacheReadInputCostPerToken: null },
    "gpt-5-mini": { inputCostPerToken: 2.5e-7, outputCostPerToken: 2e-6, cacheReadInputCostPerToken: 2.5e-8, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null, priorityInputCostPerToken: null, priorityOutputCostPerToken: null, priorityCacheReadInputCostPerToken: null },
    "gpt-5-nano": { inputCostPerToken: 5e-8, outputCostPerToken: 4e-7, cacheReadInputCostPerToken: 5e-9, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null, priorityInputCostPerToken: null, priorityOutputCostPerToken: null, priorityCacheReadInputCostPerToken: null },
    "gpt-5-pro": { inputCostPerToken: 1.5e-5, outputCostPerToken: 1.2e-4, cacheReadInputCostPerToken: null, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null, priorityInputCostPerToken: null, priorityOutputCostPerToken: null, priorityCacheReadInputCostPerToken: null },
    "gpt-5.1": { inputCostPerToken: 1.25e-6, outputCostPerToken: 1e-5, cacheReadInputCostPerToken: 1.25e-7, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null, priorityInputCostPerToken: null, priorityOutputCostPerToken: null, priorityCacheReadInputCostPerToken: null },
    "gpt-5.1-codex": { inputCostPerToken: 1.25e-6, outputCostPerToken: 1e-5, cacheReadInputCostPerToken: 1.25e-7, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null, priorityInputCostPerToken: null, priorityOutputCostPerToken: null, priorityCacheReadInputCostPerToken: null },
    "gpt-5.1-codex-max": { inputCostPerToken: 1.25e-6, outputCostPerToken: 1e-5, cacheReadInputCostPerToken: 1.25e-7, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null, priorityInputCostPerToken: null, priorityOutputCostPerToken: null, priorityCacheReadInputCostPerToken: null },
    "gpt-5.1-codex-mini": { inputCostPerToken: 2.5e-7, outputCostPerToken: 2e-6, cacheReadInputCostPerToken: 2.5e-8, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null, priorityInputCostPerToken: null, priorityOutputCostPerToken: null, priorityCacheReadInputCostPerToken: null },
    "gpt-5.2": { inputCostPerToken: 1.75e-6, outputCostPerToken: 1.4e-5, cacheReadInputCostPerToken: 1.75e-7, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null, priorityInputCostPerToken: null, priorityOutputCostPerToken: null, priorityCacheReadInputCostPerToken: null },
    "gpt-5.2-codex": { inputCostPerToken: 1.75e-6, outputCostPerToken: 1.4e-5, cacheReadInputCostPerToken: 1.75e-7, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null, priorityInputCostPerToken: null, priorityOutputCostPerToken: null, priorityCacheReadInputCostPerToken: null },
    "gpt-5.2-pro": { inputCostPerToken: 2.1e-5, outputCostPerToken: 1.68e-4, cacheReadInputCostPerToken: null, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null, priorityInputCostPerToken: null, priorityOutputCostPerToken: null, priorityCacheReadInputCostPerToken: null },
    "gpt-5.3-codex": { inputCostPerToken: 1.75e-6, outputCostPerToken: 1.4e-5, cacheReadInputCostPerToken: 1.75e-7, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null, priorityInputCostPerToken: null, priorityOutputCostPerToken: null, priorityCacheReadInputCostPerToken: null },
    "gpt-5.3-codex-spark": { inputCostPerToken: 0, outputCostPerToken: 0, cacheReadInputCostPerToken: 0, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null, priorityInputCostPerToken: null, priorityOutputCostPerToken: null, priorityCacheReadInputCostPerToken: null },
    "gpt-5.4": { inputCostPerToken: 2.5e-6, outputCostPerToken: 1.5e-5, cacheReadInputCostPerToken: 2.5e-7, thresholdTokens: 272_000, inputCostPerTokenAboveThreshold: 5e-6, outputCostPerTokenAboveThreshold: 2.25e-5, cacheReadInputCostPerTokenAboveThreshold: 5e-7, priorityInputCostPerToken: 5e-6, priorityOutputCostPerToken: 3e-5, priorityCacheReadInputCostPerToken: 5e-7 },
    "gpt-5.4-mini": { inputCostPerToken: 7.5e-7, outputCostPerToken: 4.5e-6, cacheReadInputCostPerToken: 7.5e-8, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null, priorityInputCostPerToken: 1.5e-6, priorityOutputCostPerToken: 9e-6, priorityCacheReadInputCostPerToken: 1.5e-7 },
    "gpt-5.4-nano": { inputCostPerToken: 2e-7, outputCostPerToken: 1.25e-6, cacheReadInputCostPerToken: 2e-8, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null, priorityInputCostPerToken: null, priorityOutputCostPerToken: null, priorityCacheReadInputCostPerToken: null },
    "gpt-5.4-pro": { inputCostPerToken: 3e-5, outputCostPerToken: 1.8e-4, cacheReadInputCostPerToken: null, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null, priorityInputCostPerToken: null, priorityOutputCostPerToken: null, priorityCacheReadInputCostPerToken: null },
    "gpt-5.5": { inputCostPerToken: 5e-6, outputCostPerToken: 3e-5, cacheReadInputCostPerToken: 5e-7, thresholdTokens: 272_000, inputCostPerTokenAboveThreshold: 1e-5, outputCostPerTokenAboveThreshold: 4.5e-5, cacheReadInputCostPerTokenAboveThreshold: 1e-6, priorityInputCostPerToken: 1.25e-5, priorityOutputCostPerToken: 7.5e-5, priorityCacheReadInputCostPerToken: 1.25e-6 },
    "gpt-5.5-pro": { inputCostPerToken: 3e-5, outputCostPerToken: 1.8e-4, cacheReadInputCostPerToken: null, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null, priorityInputCostPerToken: null, priorityOutputCostPerToken: null, priorityCacheReadInputCostPerToken: null },
};

const claudePricing: Record<string, ClaudePricing> = {
    "claude-haiku-4-5-20251001": { inputCostPerToken: 1e-6, outputCostPerToken: 5e-6, cacheCreationInputCostPerToken: 1.25e-6, cacheReadInputCostPerToken: 1e-7, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheCreationInputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null },
    "claude-haiku-4-5": { inputCostPerToken: 1e-6, outputCostPerToken: 5e-6, cacheCreationInputCostPerToken: 1.25e-6, cacheReadInputCostPerToken: 1e-7, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheCreationInputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null },
    "claude-opus-4-5-20251101": { inputCostPerToken: 5e-6, outputCostPerToken: 2.5e-5, cacheCreationInputCostPerToken: 6.25e-6, cacheReadInputCostPerToken: 5e-7, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheCreationInputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null },
    "claude-opus-4-5": { inputCostPerToken: 5e-6, outputCostPerToken: 2.5e-5, cacheCreationInputCostPerToken: 6.25e-6, cacheReadInputCostPerToken: 5e-7, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheCreationInputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null },
    "claude-opus-4-6-20260205": { inputCostPerToken: 5e-6, outputCostPerToken: 2.5e-5, cacheCreationInputCostPerToken: 6.25e-6, cacheReadInputCostPerToken: 5e-7, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheCreationInputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null },
    "claude-opus-4-6": { inputCostPerToken: 5e-6, outputCostPerToken: 2.5e-5, cacheCreationInputCostPerToken: 6.25e-6, cacheReadInputCostPerToken: 5e-7, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheCreationInputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null },
    "claude-opus-4-7": { inputCostPerToken: 5e-6, outputCostPerToken: 2.5e-5, cacheCreationInputCostPerToken: 6.25e-6, cacheReadInputCostPerToken: 5e-7, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheCreationInputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null },
    "claude-sonnet-4-5": { inputCostPerToken: 3e-6, outputCostPerToken: 1.5e-5, cacheCreationInputCostPerToken: 3.75e-6, cacheReadInputCostPerToken: 3e-7, thresholdTokens: 200_000, inputCostPerTokenAboveThreshold: 6e-6, outputCostPerTokenAboveThreshold: 2.25e-5, cacheCreationInputCostPerTokenAboveThreshold: 7.5e-6, cacheReadInputCostPerTokenAboveThreshold: 6e-7 },
    "claude-sonnet-4-6": { inputCostPerToken: 3e-6, outputCostPerToken: 1.5e-5, cacheCreationInputCostPerToken: 3.75e-6, cacheReadInputCostPerToken: 3e-7, thresholdTokens: 200_000, inputCostPerTokenAboveThreshold: 6e-6, outputCostPerTokenAboveThreshold: 2.25e-5, cacheCreationInputCostPerTokenAboveThreshold: 7.5e-6, cacheReadInputCostPerTokenAboveThreshold: 6e-7 },
    "claude-sonnet-4-5-20250929": { inputCostPerToken: 3e-6, outputCostPerToken: 1.5e-5, cacheCreationInputCostPerToken: 3.75e-6, cacheReadInputCostPerToken: 3e-7, thresholdTokens: 200_000, inputCostPerTokenAboveThreshold: 6e-6, outputCostPerTokenAboveThreshold: 2.25e-5, cacheCreationInputCostPerTokenAboveThreshold: 7.5e-6, cacheReadInputCostPerTokenAboveThreshold: 6e-7 },
    "claude-opus-4-20250514": { inputCostPerToken: 1.5e-5, outputCostPerToken: 7.5e-5, cacheCreationInputCostPerToken: 1.875e-5, cacheReadInputCostPerToken: 1.5e-6, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheCreationInputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null },
    "claude-opus-4-1": { inputCostPerToken: 1.5e-5, outputCostPerToken: 7.5e-5, cacheCreationInputCostPerToken: 1.875e-5, cacheReadInputCostPerToken: 1.5e-6, thresholdTokens: null, inputCostPerTokenAboveThreshold: null, outputCostPerTokenAboveThreshold: null, cacheCreationInputCostPerTokenAboveThreshold: null, cacheReadInputCostPerTokenAboveThreshold: null },
    "claude-sonnet-4-20250514": { inputCostPerToken: 3e-6, outputCostPerToken: 1.5e-5, cacheCreationInputCostPerToken: 3.75e-6, cacheReadInputCostPerToken: 3e-7, thresholdTokens: 200_000, inputCostPerTokenAboveThreshold: 6e-6, outputCostPerTokenAboveThreshold: 2.25e-5, cacheCreationInputCostPerTokenAboveThreshold: 7.5e-6, cacheReadInputCostPerTokenAboveThreshold: 6e-7 },
};

// MARK: - Model normalization

// Mirrors CostUsagePricing.normalizeCodexModel.
export function normalizeCodexModel(raw: string): string {
    let trimmed = raw.trim();
    if (trimmed.startsWith("openai/")) {
        trimmed = trimmed.slice("openai/".length);
    }
    if (codexPricing[trimmed]) return trimmed;
    const datedSuffix = trimmed.match(/-\d{4}-\d{2}-\d{2}$/);
    if (datedSuffix) {
        const base = trimmed.slice(0, -datedSuffix[0].length);
        if (codexPricing[base]) return base;
    }
    return trimmed;
}

// Mirrors CostUsagePricing.normalizeClaudeModel.
export function normalizeClaudeModel(raw: string): string {
    let trimmed = raw.trim();
    if (trimmed.startsWith("anthropic.")) {
        trimmed = trimmed.slice("anthropic.".length);
    }
    const lastDot = trimmed.lastIndexOf(".");
    if (lastDot !== -1 && trimmed.includes("claude-")) {
        const tail = trimmed.slice(lastDot + 1);
        if (tail.startsWith("claude-")) trimmed = tail;
    }
    trimmed = trimmed.replace(/-v\d+:\d+$/, "");
    const baseRange = trimmed.match(/-\d{8}$/);
    if (baseRange) {
        const base = trimmed.slice(0, -baseRange[0].length);
        if (claudePricing[base]) return base;
    }
    return trimmed;
}

// MARK: - Cost calculation

function tieredCost(tokens: number, base: number, above: number | null, threshold: number | null): number {
    if (!threshold || above === null) return tokens * base;
    const below = Math.min(tokens, threshold);
    const over = Math.max(tokens - threshold, 0);
    return below * base + over * above;
}

function codexCostWithPricing(
    pricing: CodexPricing,
    inputTokens: number,
    cachedInputTokens: number,
    outputTokens: number,
): number {
    const cached = Math.min(Math.max(0, cachedInputTokens), Math.max(0, inputTokens));
    const nonCached = Math.max(0, inputTokens - cached);
    const cachedRate = pricing.cacheReadInputCostPerToken ?? pricing.inputCostPerToken;
    const usesLongContext = pricing.thresholdTokens !== null && inputTokens > pricing.thresholdTokens;
    const inputRate = usesLongContext
        ? pricing.inputCostPerTokenAboveThreshold ?? pricing.inputCostPerToken
        : pricing.inputCostPerToken;
    const cachedInputRate = usesLongContext
        ? pricing.cacheReadInputCostPerTokenAboveThreshold ?? cachedRate
        : cachedRate;
    const outputRate = usesLongContext
        ? pricing.outputCostPerTokenAboveThreshold ?? pricing.outputCostPerToken
        : pricing.outputCostPerToken;
    return nonCached * inputRate + cached * cachedInputRate + Math.max(0, outputTokens) * outputRate;
}

// Mirrors CostUsagePricing.codexCostUSD.
export function costCodex(
    model: string,
    inputTokens: number,
    cachedInputTokens: number,
    outputTokens: number,
): number | null {
    const key = normalizeCodexModel(model);
    const pricing = codexPricing[key];
    if (!pricing) return null;
    return codexCostWithPricing(pricing, inputTokens, cachedInputTokens, outputTokens);
}

// Mirrors CostUsagePricing.codexPriorityCostUSD.
export function costCodexPriority(
    model: string,
    inputTokens: number,
    cachedInputTokens: number,
    outputTokens: number,
): number | null {
    const key = normalizeCodexModel(model);
    const pricing = codexPricing[key];
    if (!pricing) return null;
    if (
        pricing.priorityInputCostPerToken === null ||
        pricing.priorityOutputCostPerToken === null ||
        inputTokens > codexPriorityInputTokenLimit
    ) {
        return null;
    }
    return codexCostWithPricing(
        {
            ...pricing,
            inputCostPerToken: pricing.priorityInputCostPerToken,
            outputCostPerToken: pricing.priorityOutputCostPerToken,
            cacheReadInputCostPerToken: pricing.priorityCacheReadInputCostPerToken ?? pricing.cacheReadInputCostPerToken,
        },
        inputTokens,
        cachedInputTokens,
        outputTokens,
    );
}

// Mirrors CostUsagePricing.claudeCostUSD.
export function costClaude(
    model: string,
    inputTokens: number,
    cacheReadInputTokens: number,
    cacheCreationInputTokens: number,
    outputTokens: number,
): number | null {
    const key = normalizeClaudeModel(model);
    const pricing = claudePricing[key];
    if (!pricing) return null;
    return (
        tieredCost(Math.max(0, inputTokens), pricing.inputCostPerToken, pricing.inputCostPerTokenAboveThreshold, pricing.thresholdTokens) +
        tieredCost(Math.max(0, cacheReadInputTokens), pricing.cacheReadInputCostPerToken, pricing.cacheReadInputCostPerTokenAboveThreshold, pricing.thresholdTokens) +
        tieredCost(Math.max(0, cacheCreationInputTokens), pricing.cacheCreationInputCostPerToken, pricing.cacheCreationInputCostPerTokenAboveThreshold, pricing.thresholdTokens) +
        tieredCost(Math.max(0, outputTokens), pricing.outputCostPerToken, pricing.outputCostPerTokenAboveThreshold, pricing.thresholdTokens)
    );
}

// MARK: - Claude scanner

// Matches CostUsageScanner+Claude.parseClaudeFile.
export function scanClaudeProjectLogs(options: ScanOptions = {}): DailyReport {
    const home = options.home ?? process.env.HOME ?? "/tmp";
    const roots = claudeProjectsRoots(home, options);
    const filter = options.claudeLogProviderFilter ?? "all";
    const range = makeDayRange(daysAgo(30), new Date());

    const rowsByCanonicalKey = new Map<string, ClaudeRow>();
    const unkeyedRows: ClaudeRow[] = [];

    for (const root of roots) {
        for (const filePath of enumerateJsonl(root)) {
            parseClaudeFile(filePath, range, filter, rowsByCanonicalKey, unkeyedRows);
        }
    }

    const rows = [
        ...Array.from(rowsByCanonicalKey.values()).sort((a, b) => canonicalKey(a).localeCompare(canonicalKey(b))),
        ...unkeyedRows,
    ];

    const days = new Map<string, Map<string, number[]>>();
    for (const row of rows) {
        if (!isInRange(row.dayKey, range.scanSinceKey, range.scanUntilKey)) continue;
        const model = normalizeClaudeModel(row.model);
        const packed = days.get(row.dayKey)?.get(model) ?? [0, 0, 0, 0, 0, 0, 0];
        packed[0] += row.input;
        packed[1] += row.cacheRead;
        packed[2] += row.cacheCreate;
        packed[3] += row.output;
        packed[4] += row.costNanos;
        packed[5] += 1;
        packed[6] += row.costPriced ? 1 : 0;
        if (!days.has(row.dayKey)) days.set(row.dayKey, new Map());
        days.get(row.dayKey)!.set(model, packed);
    }

    return buildClaudeReport(days, range);
}

interface ClaudeRow {
    dayKey: string;
    model: string;
    input: number;
    cacheRead: number;
    cacheCreate: number;
    output: number;
    costNanos: number;
    costPriced: boolean;
    messageId?: string;
    requestId?: string;
}

function canonicalKey(row: ClaudeRow): string {
    return `${row.messageId ?? ""}:${row.requestId ?? ""}`;
}

function claudeProjectsRoots(home: string, options: ScanOptions): string[] {
    if (options.claudeLogProviderFilter) {
        // Only roots; no override API in this port.
    }
    const env = process.env.CLAUDE_CONFIG_DIR?.trim();
    if (env) {
        return env.split(",").map((p) => {
            const raw = p.trim();
            if (path.basename(raw) === "projects") return raw;
            return path.join(raw, "projects");
        });
    }
    return [path.join(home, ".config/claude/projects"), path.join(home, ".claude/projects")];
}

function parseClaudeFile(
    filePath: string,
    range: DayRange,
    filter: ClaudeLogProviderFilter,
    keyedRows: Map<string, ClaudeRow>,
    unkeyedRows: ClaudeRow[],
): void {
    const maxLineBytes = 512 * 1024;
    const prefixBytes = maxLineBytes;
    const costScale = 1_000_000_000;

    scanJsonl(filePath, 0, maxLineBytes, prefixBytes, (line) => {
        if (line.bytes.length === 0 || line.wasTruncated) return;
        const text = line.bytes.toString("utf8");
        if (!text.includes('"type":"assistant"') || !text.includes('"usage"')) return;

        let obj: Record<string, unknown>;
        try {
            obj = JSON.parse(text);
        } catch {
            return;
        }
        if (obj.type !== "assistant") return;
        if (!matchesClaudeProviderFilter(obj, filter)) return;

        const tsText = obj.timestamp as string | undefined;
        if (!tsText) return;
        const dayKey = dayKeyFromTimestamp(tsText) ?? dayKeyFromParsedISO(tsText);
        if (!dayKey) return;

        const message = (obj.message ?? {}) as Record<string, unknown>;
        const model = message.model as string | undefined;
        if (!model) return;
        const usage = (message.usage ?? {}) as Record<string, unknown>;
        const input = Math.max(0, toInt(usage.input_tokens));
        const cacheCreate = Math.max(0, toInt(usage.cache_creation_input_tokens));
        const cacheRead = Math.max(0, toInt(usage.cache_read_input_tokens));
        const output = Math.max(0, toInt(usage.output_tokens));
        if (input === 0 && cacheCreate === 0 && cacheRead === 0 && output === 0) return;

        const cost = costClaude(model, input, cacheRead, cacheCreate, output);
        const costNanos = cost === null ? 0 : Math.round(cost * costScale);
        const row: ClaudeRow = {
            dayKey,
            model: normalizeClaudeModel(model),
            input,
            cacheRead,
            cacheCreate,
            output,
            costNanos,
            costPriced: cost !== null,
            messageId: message.id as string | undefined,
            requestId: obj.requestId as string | undefined,
        };

        if (row.messageId && row.requestId) {
            keyedRows.set(`${row.messageId}:${row.requestId}`, row);
        } else {
            unkeyedRows.push(row);
        }
    });
}

function matchesClaudeProviderFilter(obj: Record<string, unknown>, filter: ClaudeLogProviderFilter): boolean {
    switch (filter) {
        case "all":
            return true;
        case "vertexAIOnly":
            return isVertexAIUsageEntry(obj);
        case "excludeVertexAI":
            return !isVertexAIUsageEntry(obj);
    }
}

function isVertexAIUsageEntry(obj: Record<string, unknown>): boolean {
    const message = (obj.message ?? {}) as Record<string, unknown>;
    const messageId = message.id as string | undefined;
    if (messageId && messageId.includes("_vrtx_")) return true;
    const requestId = obj.requestId as string | undefined;
    if (requestId && requestId.includes("_vrtx_")) return true;
    const model = message.model as string | undefined;
    if (model && model.startsWith("claude-") && model.includes("@")) return true;
    const candidates: Record<string, unknown>[] = [obj];
    for (const key of ["metadata", "request", "context", "client"]) {
        const nested = obj[key] as Record<string, unknown> | undefined;
        if (nested) candidates.push(nested);
    }
    if (typeof message === "object" && message !== null) {
        for (const key of ["metadata", "request"]) {
            const nested = message[key] as Record<string, unknown> | undefined;
            if (nested) candidates.push(nested);
        }
    }
    return candidates.some(containsVertexAIMetadata);
}

const vertexProviderKeys = new Set([
    "provider", "platform", "backend", "api_provider", "apiprovider",
    "api_type", "apitype", "source", "vendor", "client",
]);

function containsVertexAIMetadata(dict: Record<string, unknown>): boolean {
    for (const [key, value] of Object.entries(dict)) {
        const lowerKey = key.toLowerCase();
        if (lowerKey.includes("vertex") || lowerKey.includes("gcp")) return true;
        if (vertexProviderKeys.has(lowerKey) && typeof value === "string" && value.toLowerCase().includes("vertex")) {
            return true;
        }
        if (Array.isArray(value)) {
            if (value.some((v) => typeof v === "object" && v !== null && containsVertexAIMetadata(v as Record<string, unknown>))) return true;
        } else if (typeof value === "object" && value !== null) {
            if (containsVertexAIMetadata(value as Record<string, unknown>)) return true;
        }
    }
    return false;
}

function buildClaudeReport(days: Map<string, Map<string, number[]>>, range: DayRange): DailyReport {
    const entries: DailyEntry[] = [];
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheCreate = 0;
    let totalTokens = 0;
    let totalCost = 0;
    let costSeen = false;
    const costScale = 1_000_000_000;

    const dayKeys = Array.from(days.keys()).filter((k) => isInRange(k, range.sinceKey, range.untilKey)).sort();
    for (const day of dayKeys) {
        const models = days.get(day)!;
        let dayInput = 0;
        let dayOutput = 0;
        let dayCacheRead = 0;
        let dayCacheCreate = 0;
        let dayCost = 0;
        let dayCostSeen = false;
        const breakdown: ModelBreakdown[] = [];
        const modelNames = Array.from(models.keys()).sort();

        for (const model of modelNames) {
            const packed = models.get(model)!;
            const input = packed[0];
            const cacheRead = packed[1];
            const cacheCreate = packed[2];
            const output = packed[3];
            const cachedCost = packed[4];
            const sampleCount = packed[5];
            const pricedSampleCount = packed[6];
            const hasCompleteCachedCost = sampleCount > 0 && pricedSampleCount === sampleCount;
            const totalForModel = input + cacheRead + cacheCreate + output;
            const currentCost = costClaude(model, input, cacheRead, cacheCreate, output);
            const cost = hasCompleteCachedCost ? cachedCost / costScale : currentCost;
            breakdown.push({ modelName: model, totalTokens: totalForModel, costUSD: cost ?? null });
            dayInput += input;
            dayCacheRead += cacheRead;
            dayCacheCreate += cacheCreate;
            dayOutput += output;
            if (cost !== null) {
                dayCost += cost;
                dayCostSeen = true;
            }
        }

        const dayTotal = dayInput + dayCacheRead + dayCacheCreate + dayOutput;
        entries.push({
            date: day,
            inputTokens: dayInput,
            outputTokens: dayOutput,
            cacheReadTokens: dayCacheRead,
            cacheCreationTokens: dayCacheCreate,
            totalTokens: dayTotal,
            costUSD: dayCostSeen ? dayCost : null,
            modelsUsed: modelNames,
            modelBreakdowns: sortedBreakdowns(breakdown),
        });
        totalInput += dayInput;
        totalOutput += dayOutput;
        totalCacheRead += dayCacheRead;
        totalCacheCreate += dayCacheCreate;
        totalTokens += dayTotal;
        if (dayCostSeen) {
            totalCost += dayCost;
            costSeen = true;
        }
    }

    return {
        data: entries,
        summary: entries.length
            ? {
                  totalInputTokens: totalInput,
                  totalOutputTokens: totalOutput,
                  cacheReadTokens: totalCacheRead,
                  cacheCreationTokens: totalCacheCreate,
                  totalTokens,
                  totalCostUSD: costSeen ? totalCost : null,
              }
            : null,
    };
}

// MARK: - Codex scanner

interface CodexTotals {
    input: number;
    cached: number;
    output: number;
}

function zeroTotals(): CodexTotals {
    return { input: 0, cached: 0, output: 0 };
}

function addTotals(a: CodexTotals, b: CodexTotals): CodexTotals {
    return { input: a.input + b.input, cached: a.cached + b.cached, output: a.output + b.output };
}

function totalDelta(from: CodexTotals | null, to: CodexTotals): CodexTotals {
    const baseline = from ?? zeroTotals();
    return {
        input: Math.max(0, to.input - baseline.input),
        cached: Math.max(0, to.cached - baseline.cached),
        output: Math.max(0, to.output - baseline.output),
    };
}

function totalsEqual(a: CodexTotals | null, b: CodexTotals | null): boolean {
    return (a?.input ?? 0) === (b?.input ?? 0) && (a?.cached ?? 0) === (b?.cached ?? 0) && (a?.output ?? 0) === (b?.output ?? 0);
}

function totalsAtLeast(a: CodexTotals, b: CodexTotals): boolean {
    return a.input >= b.input && a.cached >= b.cached && a.output >= b.output;
}

function totalsAtMost(a: CodexTotals, b: CodexTotals): boolean {
    return a.input <= b.input && a.cached <= b.cached && a.output <= b.output;
}

function shouldPreferTotalDelta(
    rawBaseline: CodexTotals | null,
    currentTotal: CodexTotals,
    totalDelta: CodexTotals,
    lastDelta: CodexTotals,
    sawDivergentTotals: boolean,
): boolean {
    if (sawDivergentTotals || rawBaseline === null) return false;
    return totalsAtLeast(currentTotal, rawBaseline) && totalsAtMost(totalDelta, lastDelta);
}

export function scanCodexSessions(options: ScanOptions = {}): DailyReport {
    const home = options.home ?? process.env.HOME ?? "/tmp";
    const root = options.codexSessionsRoot ?? path.join(home, ".codex", "sessions");
    const archivedRoot = path.join(path.dirname(root), "archived_sessions");
    const range = makeDayRange(daysAgo(30), new Date());

    const files = new Set<string>();
    for (const r of [root, archivedRoot]) {
        for (const f of listCodexSessionFiles(r, range.scanSinceKey, range.scanUntilKey)) files.add(f);
    }

    const days = new Map<string, Map<string, number[]>>();
    for (const filePath of files) {
        const parsed = parseCodexFile(filePath, range);
        for (const row of parsed.rows) {
            if (!isInRange(row.day, range.scanSinceKey, range.scanUntilKey)) continue;
            const model = normalizeCodexModel(row.model);
            const packed = days.get(row.day)?.get(model) ?? [0, 0, 0];
            packed[0] += row.input;
            packed[1] += row.cached;
            packed[2] += row.output;
            if (!days.has(row.day)) days.set(row.day, new Map());
            days.get(row.day)!.set(model, packed);
        }
    }

    return buildCodexReport(days, range);
}

interface CodexUsageRow {
    day: string;
    model: string;
    input: number;
    cached: number;
    output: number;
}

interface CodexParseResult {
    rows: CodexUsageRow[];
}

function parseCodexFile(filePath: string, range: DayRange): CodexParseResult {
    let currentModel: string | null = null;
    let previousTotals: CodexTotals | null = null;
    let rawTotalsBaseline: CodexTotals | null = null;
    let sawDivergentTotals = false;
    const rows: CodexUsageRow[] = [];

    function add(dayKey: string, model: string, input: number, cached: number, output: number) {
        if (!isInRange(dayKey, range.scanSinceKey, range.scanUntilKey)) return;
        // no-op aggregation here; rows are aggregated afterwards.
        rows.push({ day: dayKey, model: normalizeCodexModel(model), input, cached, output });
    }

    const maxLineBytes = 256 * 1024;
    const prefixBytes = maxLineBytes;

    scanJsonl(filePath, 0, maxLineBytes, prefixBytes, (line) => {
        if (line.bytes.length === 0) return;
        if (line.wasTruncated) {
            const model = extractCodexTurnContextModel(line.bytes);
            if (model) currentModel = model;
            return;
        }

        const text = line.bytes.toString("utf8");
        const hasEvent = text.includes('"type":"event_msg"');
        const hasTurnContext = text.includes('"type":"turn_context"');
        const hasSessionMeta = text.includes('"type":"session_meta"');
        if (!hasEvent && !hasTurnContext && !hasSessionMeta) return;
        if (hasEvent && !text.includes('"token_count"') && !text.includes('"task_started"')) return;

        let obj: Record<string, unknown>;
        try {
            obj = JSON.parse(text);
        } catch {
            return;
        }
        const type = obj.type as string | undefined;
        if (!type) return;

        if (type === "session_meta") return;

        const tsText = obj.timestamp as string | undefined;
        if (!tsText) return;
        const dayKey = dayKeyFromTimestamp(tsText) ?? dayKeyFromParsedISO(tsText);
        if (!dayKey) return;

        if (type === "turn_context") {
            const payload = (obj.payload ?? {}) as Record<string, unknown>;
            if (typeof payload.model === "string") {
                currentModel = payload.model;
            } else {
                const info = (payload.info ?? {}) as Record<string, unknown>;
                if (typeof info.model === "string") currentModel = info.model;
            }
            return;
        }

        if (type !== "event_msg") return;
        const payload = (obj.payload ?? {}) as Record<string, unknown>;
        if (payload.type === "task_started") return;
        if (payload.type !== "token_count") return;

        const info = (payload.info ?? {}) as Record<string, unknown>;
        const modelFromInfo =
            (info.model as string | undefined) ??
            (info.model_name as string | undefined) ??
            (payload.model as string | undefined) ??
            (obj.model as string | undefined);
        const model = currentModel ?? modelFromInfo ?? "gpt-5";

        const total = info.total_token_usage as Record<string, unknown> | undefined;
        const last = info.last_token_usage as Record<string, unknown> | undefined;

        let deltaInput = 0;
        let deltaCached = 0;
        let deltaOutput = 0;

        if (last) {
            const rawDelta: CodexTotals = {
                input: Math.max(0, toInt(last.input_tokens)),
                cached: Math.max(0, toInt(last.cached_input_tokens ?? last.cache_read_input_tokens)),
                output: Math.max(0, toInt(last.output_tokens)),
            };
            deltaInput = rawDelta.input;
            deltaCached = rawDelta.cached;
            deltaOutput = rawDelta.output;
            const prev = previousTotals ?? zeroTotals();
            if (total) {
                const rawTotals: CodexTotals = {
                    input: toInt(total.input_tokens),
                    cached: toInt(total.cached_input_tokens ?? total.cache_read_input_tokens),
                    output: toInt(total.output_tokens),
                };
                const totalDelta = totalDeltaFrom(rawTotalsBaseline, rawTotals);
                if (shouldPreferTotalDelta(rawTotalsBaseline, rawTotals, totalDelta, rawDelta, sawDivergentTotals)) {
                    deltaInput = totalDelta.input;
                    deltaCached = totalDelta.cached;
                    deltaOutput = totalDelta.output;
                }
                const countedTotals = addTotals(prev, { input: deltaInput, cached: deltaCached, output: deltaOutput });
                previousTotals = countedTotals;
                rawTotalsBaseline = rawTotals;
                if (!totalsEqual(rawTotals, countedTotals)) sawDivergentTotals = true;
            } else {
                const countedTotals = addTotals(prev, { input: deltaInput, cached: deltaCached, output: deltaOutput });
                previousTotals = countedTotals;
                rawTotalsBaseline = countedTotals;
            }
        } else if (total) {
            const rawTotals: CodexTotals = {
                input: toInt(total.input_tokens),
                cached: toInt(total.cached_input_tokens ?? total.cache_read_input_tokens),
                output: toInt(total.output_tokens),
            };
            const delta = totalDeltaFrom(rawTotalsBaseline, rawTotals);
            deltaInput = delta.input;
            deltaCached = delta.cached;
            deltaOutput = delta.output;
            const prev = previousTotals ?? zeroTotals();
            previousTotals = addTotals(prev, delta);
            rawTotalsBaseline = rawTotals;
            if (!totalsEqual(rawTotals, previousTotals)) sawDivergentTotals = true;
        } else {
            return;
        }

        if (deltaInput === 0 && deltaCached === 0 && deltaOutput === 0) return;
        const cachedClamp = Math.min(deltaCached, deltaInput);
        add(dayKey, model, deltaInput, cachedClamp, deltaOutput);
    });

    return { rows };
}

function totalDeltaFrom(from: CodexTotals | null, to: CodexTotals): CodexTotals {
    return totalDelta(from, to);
}

function listCodexSessionFiles(root: string, scanSinceKey: string, scanUntilKey: string): string[] {
    const out: string[] = [];
    if (!fs.existsSync(root)) return out;

    // Date-partitioned layout: YYYY/MM/DD/*.jsonl
    const sinceDate = parseDayKey(scanSinceKey) ?? new Date();
    const untilDate = parseDayKey(scanUntilKey) ?? sinceDate;
    const cursor = new Date(sinceDate);
    while (cursor <= untilDate) {
        const y = cursor.getFullYear().toString();
        const m = pad2(cursor.getMonth() + 1);
        const d = pad2(cursor.getDate());
        const dayDir = path.join(root, y, m, d);
        if (fs.existsSync(dayDir)) {
            for (const entry of fs.readdirSync(dayDir)) {
                if (entry.toLowerCase().endsWith(".jsonl")) {
                    out.push(path.join(dayDir, entry));
                }
            }
        }
        cursor.setDate(cursor.getDate() + 1);
    }

    // Flat files at root whose filename contains YYYY-MM-DD.
    for (const entry of fs.readdirSync(root)) {
        const full = path.join(root, entry);
        if (!fs.statSync(full).isFile()) continue;
        if (!entry.toLowerCase().endsWith(".jsonl")) continue;
        const dk = dayKeyFromFilename(entry);
        if (dk && !isInRange(dk, scanSinceKey, scanUntilKey)) continue;
        out.push(full);
    }

    // Recursive legacy scan, skipping date-partition ancestors.
    function recurse(dir: string) {
        for (const entry of fs.readdirSync(dir)) {
            const full = path.join(dir, entry);
            const stat = fs.statSync(full);
            if (stat.isDirectory()) {
                const rel = path.relative(root, full);
                const parts = rel.split(path.sep);
                if (parts.length === 1 && /^\d{4}$/.test(parts[0]!)) continue; // skip partition ancestor
                recurse(full);
            } else if (entry.toLowerCase().endsWith(".jsonl")) {
                out.push(full);
            }
        }
    }
    recurse(root);

    return Array.from(new Set(out));
}

function dayKeyFromFilename(filename: string): string | null {
    const m = filename.match(/(\d{4}-\d{2}-\d{2})/);
    return m?.[1] ?? null;
}

function parseDayKey(key: string): Date | null {
    const [y, m, d] = key.split("-").map(Number);
    if (!y || !m || !d) return null;
    const date = new Date(y, m - 1, d);
    if (Number.isNaN(date.getTime())) return null;
    return date;
}

function buildCodexReport(days: Map<string, Map<string, number[]>>, range: DayRange): DailyReport {
    const entries: DailyEntry[] = [];
    let totalInput = 0;
    let totalOutput = 0;
    let totalCached = 0;
    let totalTokens = 0;
    let totalCost = 0;
    let costSeen = false;

    const dayKeys = Array.from(days.keys()).filter((k) => isInRange(k, range.sinceKey, range.untilKey)).sort();
    for (const day of dayKeys) {
        const models = days.get(day)!;
        let dayInput = 0;
        let dayOutput = 0;
        let dayCached = 0;
        let dayCost = 0;
        let dayCostSeen = false;
        const breakdown: ModelBreakdown[] = [];
        const modelNames = Array.from(models.keys()).sort();

        for (const model of modelNames) {
            const packed = models.get(model)!;
            const input = packed[0];
            const cached = packed[1];
            const output = packed[2];
            const modelTotal = input + cached + output;
            const cost = costCodex(model, input, cached, output);
            breakdown.push({ modelName: model, totalTokens: modelTotal, costUSD: cost ?? null });
            dayInput += input;
            dayCached += cached;
            dayOutput += output;
            if (cost !== null) {
                dayCost += cost;
                dayCostSeen = true;
            }
        }

        const dayTotal = dayInput + dayCached + dayOutput;
        entries.push({
            date: day,
            inputTokens: dayInput,
            outputTokens: dayOutput,
            cacheReadTokens: dayCached,
            cacheCreationTokens: 0,
            totalTokens: dayTotal,
            costUSD: dayCostSeen ? dayCost : null,
            modelsUsed: modelNames,
            modelBreakdowns: sortedBreakdowns(breakdown),
        });
        totalInput += dayInput;
        totalOutput += dayOutput;
        totalCached += dayCached;
        totalTokens += dayTotal;
        if (dayCostSeen) {
            totalCost += dayCost;
            costSeen = true;
        }
    }

    return {
        data: entries,
        summary: entries.length
            ? {
                  totalInputTokens: totalInput,
                  totalOutputTokens: totalOutput,
                  cacheReadTokens: totalCached,
                  cacheCreationTokens: 0,
                  totalTokens,
                  totalCostUSD: costSeen ? totalCost : null,
              }
            : null,
    };
}

// Partial JSON parser for truncated turn_context lines.
// Mirrors CostUsageScanner+CodexTruncatedPrefix.extractCodexTurnContextModel.
function extractCodexTurnContextModel(bytes: Buffer): string | null {
    let text: string | null = null;
    for (let drop = 0; drop <= Math.min(4, bytes.length); drop++) {
        const candidate = bytes.subarray(0, bytes.length - drop).toString("utf8");
        if (candidate !== "") {
            text = candidate;
            break;
        }
    }
    if (!text) return null;
    if (extractJSONStringField("type", text) !== "turn_context") return null;
    const payloadText = extractJSONObjectField("payload", text);
    if (!payloadText) return null;
    const payloadModel = extractJSONStringField("model", payloadText) ?? extractJSONStringField("model_name", payloadText);
    if (payloadModel) return payloadModel;
    const infoText = extractJSONObjectField("info", payloadText);
    if (!infoText) return null;
    return extractJSONStringField("model", infoText) ?? extractJSONStringField("model_name", infoText);
}

function extractJSONStringField(field: string, text: string): string | null {
    const idx = locateJSONField(field, text);
    if (idx === null) return null;
    return parseJSONString(text, idx);
}

function extractJSONObjectField(field: string, text: string): string | null {
    const idx = locateJSONField(field, text);
    if (idx === null || idx >= text.length || text[idx] !== "{") return null;
    return text.slice(idx);
}

function locateJSONField(field: string, text: string): number | null {
    let depth = 0;
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (ch === "{") {
            depth++;
            i++;
        } else if (ch === "}") {
            depth--;
            i++;
        } else if (ch === '"') {
            let key = "";
            i++;
            while (i < text.length) {
                const c = text[i];
                if (c === "\\" && i + 1 < text.length) {
                    key += text[i + 1];
                    i += 2;
                } else if (c === '"') {
                    i++;
                    break;
                } else {
                    key += c;
                    i++;
                }
            }
            if (depth === 1 && key === field) {
                while (i < text.length && /\s/.test(text[i])) i++;
                if (i < text.length && text[i] === ":") {
                    i++;
                    while (i < text.length && /\s/.test(text[i])) i++;
                    return i;
                }
            }
        } else {
            i++;
        }
    }
    return null;
}

function parseJSONString(text: string, startIndex: number): string | null {
    if (startIndex >= text.length || text[startIndex] !== '"') return null;
    let i = startIndex + 1;
    let value = "";
    while (i < text.length) {
        const ch = text[i];
        if (ch === "\\" && i + 1 < text.length) {
            value += text[i + 1];
            i += 2;
        } else if (ch === '"') {
            return value;
        } else {
            value += ch;
            i++;
        }
    }
    return null;
}

// MARK: - Codex priority trace scanner

// Mirrors CostUsageScanner+CodexPriority. Reads ~/.codex/logs_2.sqlite, looks for
// websocket request/response rows, and returns a map of turnID -> priority metadata.
export interface CodexPriorityTurnMetadata {
    threadID: string | null;
    turnID: string;
    model: string | null;
    timestamp: string | null;
}

export function loadCodexPriorityTurns(
    options: ScanOptions = {},
): Record<string, CodexPriorityTurnMetadata> | null {
    const home = options.home ?? process.env.HOME ?? "/tmp";
    const dbPath = options.codexTraceDatabaseURL ?? path.join(home, ".codex", "logs_2.sqlite");
    if (!fs.existsSync(dbPath)) return null;

    let db: Database.Database;
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const BetterSQLite3 = require("better-sqlite3");
        db = new BetterSQLite3(dbPath, { readonly: true });
    } catch {
        return null;
    }

    try {
        const stmt = db.prepare(
            `select ts, feedback_log_body from logs where feedback_log_body like '%websocket request:%' or feedback_log_body like '%response.completed%'`,
        );
        const turns: Record<string, CodexPriorityTurnMetadata> = {};
        const completedModelsByTurnID: Record<string, string> = {};

        for (const row of stmt.iterate() as Iterable<{ ts: string | number; feedback_log_body: string }>) {
            const timestamp = String(row.ts);
            const body = row.feedback_log_body;
            const completed = parseCodexCompletedTraceRow(body);
            if (completed) {
                completedModelsByTurnID[completed.turnID] = completed.model;
                if (turns[completed.turnID]) {
                    turns[completed.turnID]!.model = completed.model;
                }
                continue;
            }
            const parsed = parseCodexPriorityTraceRow(timestamp, body);
            if (!parsed) continue;
            if (completedModelsByTurnID[parsed.turnID]) {
                parsed.model = completedModelsByTurnID[parsed.turnID]!;
            }
            turns[parsed.turnID] = parsed;
        }
        return turns;
    } finally {
        db.close();
    }
}

function parseCodexPriorityTraceRow(timestamp: string | null, body: string): CodexPriorityTurnMetadata | null {
    const marker = "websocket request:";
    const markerIndex = body.indexOf(marker);
    if (markerIndex === -1) return null;
    const prefix = body.slice(0, markerIndex);
    const jsonText = body.slice(markerIndex + marker.length).trim();
    let request: Record<string, unknown>;
    try {
        request = JSON.parse(jsonText);
    } catch {
        return null;
    }
    if (request.type !== "response.create" || request.service_tier !== "priority") return null;

    const turnID =
        extractKeyValue("turn.id", prefix) ??
        extractKeyValue("turn_id", prefix) ??
        (request.turn_id as string | undefined);
    if (!turnID) return null;

    return {
        threadID: extractKeyValue("thread_id", prefix),
        turnID,
        model: (request.model as string | undefined) ?? null,
        timestamp,
    };
}

function parseCodexCompletedTraceRow(body: string): { turnID: string; model: string } | null {
    const marker = "websocket event:";
    const markerIndex = body.indexOf(marker);
    if (markerIndex === -1) return null;
    const prefix = body.slice(0, markerIndex);
    const jsonText = body.slice(markerIndex + marker.length).trim();
    let event: Record<string, unknown>;
    try {
        event = JSON.parse(jsonText);
    } catch {
        return null;
    }
    if (event.type !== "response.completed") return null;
    const response = (event.response ?? {}) as Record<string, unknown>;
    const model = response.model as string | undefined;
    if (!model) return null;
    const turnID = extractKeyValue("turn.id", prefix) ?? extractKeyValue("turn_id", prefix);
    if (!turnID) return null;
    return { turnID, model };
}

function extractKeyValue(name: string, text: string): string | null {
    const idx = text.indexOf(`${name}=`);
    if (idx === -1) return null;
    const tail = text.slice(idx + name.length + 1);
    const value = tail.split(/[\s,\]\)]/)[0];
    return value.length ? value : null;
}

// MARK: - Pi session scanner

// Mirrors PiSessionCostScanner.
export function scanPiSessions(provider: "claude" | "codex", options: ScanOptions = {}): DailyReport {
    const home = options.home ?? process.env.HOME ?? "/tmp";
    const root = options.piSessionsRoot ?? path.join(home, ".pi", "agent", "sessions");
    const range = makeDayRange(daysAgo(30), new Date());

    const daysByProvider: Record<string, Record<string, Record<string, PiPackedUsage>>> = {
        claude: {},
        codex: {},
    };

    for (const filePath of enumeratePiSessionFiles(root, range.scanSinceKey)) {
        const parsed = parsePiSessionFile(filePath, range);
        for (const [providerKey, providerDays] of Object.entries(parsed.contributions)) {
            for (const [dayKey, dayModels] of Object.entries(providerDays)) {
                for (const [modelName, packed] of Object.entries(dayModels)) {
                    const existing = daysByProvider[providerKey]![dayKey]?.[modelName] ?? emptyPiPackedUsage();
                    const merged = addPiPacked(existing, packed);
                    if (!daysByProvider[providerKey]![dayKey]) daysByProvider[providerKey]![dayKey] = {};
                    daysByProvider[providerKey]![dayKey]![modelName] = merged;
                }
            }
        }
    }

    return buildPiReport(provider, daysByProvider[provider] ?? {}, range);
}

interface PiPackedUsage {
    inputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    outputTokens: number;
    totalTokens: number;
    costNanos: number;
    costSampleCount: number;
    usageSampleCount: number;
}

function emptyPiPackedUsage(): PiPackedUsage {
    return {
        inputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        costNanos: 0,
        costSampleCount: 0,
        usageSampleCount: 0,
    };
}

function isPiPackedZero(u: PiPackedUsage): boolean {
    return (
        u.inputTokens === 0 &&
        u.cacheReadTokens === 0 &&
        u.cacheWriteTokens === 0 &&
        u.outputTokens === 0 &&
        u.totalTokens === 0
    );
}

function addPiPacked(a: PiPackedUsage, b: PiPackedUsage): PiPackedUsage {
    return {
        inputTokens: a.inputTokens + b.inputTokens,
        cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
        cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
        outputTokens: a.outputTokens + b.outputTokens,
        totalTokens: a.totalTokens + b.totalTokens,
        costNanos: a.costNanos + b.costNanos,
        costSampleCount: a.costSampleCount + b.costSampleCount,
        usageSampleCount: a.usageSampleCount + b.usageSampleCount,
    };
}

interface PiModelContext {
    provider: "claude" | "codex";
    modelName: string;
}

interface PiParseResult {
    contributions: Record<string, Record<string, Record<string, PiPackedUsage>>>;
}

function enumeratePiSessionFiles(root: string, scanSinceKey: string): string[] {
    if (!fs.existsSync(root)) return [];
    const out: string[] = [];
    const sinceDate = parseDayKey(scanSinceKey) ?? new Date(0);

    function recurse(dir: string) {
        for (const entry of fs.readdirSync(dir)) {
            const full = path.join(dir, entry);
            const stat = fs.statSync(full);
            if (stat.isDirectory()) {
                recurse(full);
            } else if (entry.toLowerCase().endsWith(".jsonl")) {
                const startedAt = parsePiSessionFilename(entry);
                const modifiedAt = stat.mtime;
                const include =
                    (startedAt && localMidnight(startedAt) >= localMidnight(sinceDate)) ||
                    localMidnight(modifiedAt) >= localMidnight(sinceDate);
                if (include) out.push(full);
            }
        }
    }
    recurse(root);
    return out.sort();
}

function parsePiSessionFilename(filename: string): Date | null {
    const m = filename.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z_/);
    if (!m) return null;
    const iso = `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
}

function localMidnight(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function parsePiSessionFile(filePath: string, range: DayRange): PiParseResult {
    let currentContext: PiModelContext | null = null;
    const contributions: Record<string, Record<string, Record<string, PiPackedUsage>>> = {};
    const costScale = 1_000_000_000;

    function add(provider: "claude" | "codex", dayKey: string, modelName: string, usage: PiPackedUsage) {
        if (isPiPackedZero(usage)) return;
        if (!isInRange(dayKey, range.scanSinceKey, range.scanUntilKey)) return;
        if (!contributions[provider]) contributions[provider] = {};
        if (!contributions[provider]![dayKey]) contributions[provider]![dayKey] = {};
        const existing = contributions[provider]![dayKey]![modelName] ?? emptyPiPackedUsage();
        contributions[provider]![dayKey]![modelName] = addPiPacked(existing, usage);
    }

    scanJsonl(filePath, 0, 16 * 1024 * 1024, 16 * 1024 * 1024, (line) => {
        if (line.bytes.length === 0 || line.wasTruncated) return;
        let obj: Record<string, unknown>;
        try {
            obj = JSON.parse(line.bytes.toString("utf8"));
        } catch {
            return;
        }
        const type = obj.type as string | undefined;
        if (!type) return;

        if (type === "model_change") {
            currentContext = piModelContext(obj);
            return;
        }

        if (type !== "message") return;
        const message = (obj.message ?? {}) as Record<string, unknown>;
        if (message.role !== "assistant") return;

        const identity = resolvePiAssistantIdentity(obj, message, currentContext);
        if (!identity) return;
        const date = piTimestampDate(obj, message);
        if (!date) return;
        const dk = dayKey(date);
        const usage = extractPiUsage(identity.provider, identity.modelName, message);
        add(identity.provider, dk, identity.modelName, usage);
    });

    return { contributions };
}

function piModelContext(object: Record<string, unknown>): PiModelContext | null {
    const providerText = object.provider as string | undefined;
    const provider = mapPiProvider(providerText);
    if (!provider) return null;
    const rawModel = String(object.modelId ?? "").trim();
    const modelName = normalizePiModel(rawModel, provider);
    if (!modelName) return null;
    return { provider, modelName };
}

function resolvePiAssistantIdentity(
    entry: Record<string, unknown>,
    message: Record<string, unknown>,
    fallback: PiModelContext | null,
): PiModelContext | null {
    const explicitProviderText = extractPiProviderText(entry, message);
    const explicitProvider = explicitProviderText ? mapPiProvider(explicitProviderText) : null;
    const explicitModelText = extractPiModelText(entry, message);

    if (explicitProviderText && !explicitProvider) return null;

    if (explicitProvider && explicitModelText) {
        const modelName = normalizePiModel(explicitModelText, explicitProvider);
        if (modelName) return { provider: explicitProvider, modelName };
    }

    if (explicitProvider && fallback && fallback.provider === explicitProvider) {
        return { provider: explicitProvider, modelName: fallback.modelName };
    }

    if (!explicitProviderText && explicitModelText && fallback) {
        const modelName = normalizePiModel(explicitModelText, fallback.provider);
        if (modelName) return { provider: fallback.provider, modelName };
    }

    if (!explicitProviderText && fallback) {
        return fallback;
    }

    return null;
}

function extractPiProviderText(entry: Record<string, unknown>, message: Record<string, unknown>): string | null {
    for (const src of [message.provider, entry.provider]) {
        const s = String(src ?? "").trim();
        if (s.length) return s;
    }
    return null;
}

function extractPiModelText(entry: Record<string, unknown>, message: Record<string, unknown>): string | null {
    for (const value of [message.model, entry.model, message.modelId, entry.modelId]) {
        const s = String(value ?? "").trim();
        if (s.length) return s;
    }
    return null;
}

function normalizePiModel(raw: string, provider: "claude" | "codex"): string | null {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return provider === "codex" ? normalizeCodexModel(trimmed) : normalizeClaudeModel(trimmed);
}

function mapPiProvider(provider: string | undefined): "claude" | "codex" | null {
    switch (provider?.toLowerCase()) {
        case "openai-codex":
            return "codex";
        case "anthropic":
            return "claude";
        default:
            return null;
    }
}

function piTimestampDate(entry: Record<string, unknown>, message: Record<string, unknown>): Date | null {
    return parsePiTimestampValue(message.timestamp) ?? parsePiTimestampValue(entry.timestamp);
}

function parsePiTimestampValue(value: unknown): Date | null {
    if (typeof value === "number") {
        return value > 1_000_000_000_000 ? new Date(value / 1000) : new Date(value * 1000);
    }
    if (typeof value === "string") {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) {
            return numeric > 1_000_000_000_000 ? new Date(numeric / 1000) : new Date(numeric * 1000);
        }
        return parseISO8601(value);
    }
    return null;
}

function extractPiUsage(provider: "claude" | "codex", modelName: string, message: Record<string, unknown>): PiPackedUsage {
    const usage = (message.usage ?? {}) as Record<string, unknown>;
    const input = readPiNonNegativeInt(
        usage.input ?? usage.inputTokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.prompt_tokens,
    );
    const cacheRead = readPiNonNegativeInt(
        usage.cacheRead ??
            usage.cacheReadTokens ??
            usage.cache_read ??
            usage.cache_read_tokens ??
            usage.cacheReadInputTokens ??
            usage.cache_read_input_tokens,
    );
    const cacheWrite = readPiNonNegativeInt(
        usage.cacheWrite ??
            usage.cacheWriteTokens ??
            usage.cache_write ??
            usage.cache_write_tokens ??
            usage.cacheCreationTokens ??
            usage.cache_creation_tokens ??
            usage.cacheCreationInputTokens ??
            usage.cache_creation_input_tokens,
    );
    const output = readPiNonNegativeInt(
        usage.output ?? usage.outputTokens ?? usage.output_tokens ?? usage.completionTokens ?? usage.completion_tokens,
    );
    const directTotal = readPiNonNegativeInt(
        usage.totalTokens ?? usage.total_tokens ?? usage.tokenCount ?? usage.token_count ?? usage.tokens,
    );
    const derivedTotal = input + cacheRead + cacheWrite + output;
    const totalTokens = Math.max(directTotal, derivedTotal);

    const rawUsage: PiPackedUsage = {
        inputTokens: input,
        cacheReadTokens: cacheRead,
        cacheWriteTokens: cacheWrite,
        outputTokens: output,
        totalTokens,
        costNanos: 0,
        costSampleCount: 0,
        usageSampleCount: 1,
    };

    const costUSD =
        provider === "codex"
            ? costCodex(modelName, input + cacheRead + cacheWrite, cacheRead, output)
            : costClaude(modelName, input, cacheRead, cacheWrite, output);
    const costNanos = costUSD === null ? 0 : Math.round(costUSD * 1_000_000_000);

    return {
        ...rawUsage,
        costNanos,
        costSampleCount: costUSD === null ? 0 : 1,
    };
}

function readPiNonNegativeInt(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return Math.round(value);
    if (typeof value === "string") {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0) return Math.round(n);
    }
    return 0;
}

function buildPiReport(
    provider: "claude" | "codex",
    providerDays: Record<string, Record<string, PiPackedUsage>>,
    range: DayRange,
): DailyReport {
    const dayKeys = Object.keys(providerDays)
        .filter((k) => isInRange(k, range.sinceKey, range.untilKey))
        .sort();
    if (dayKeys.length === 0) return { data: [], summary: null };

    const entries: DailyEntry[] = [];
    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let totalTokens = 0;
    let totalCostNanos = 0;
    let totalCostSamples = 0;
    const costScale = 1_000_000_000;

    for (const dayKey of dayKeys) {
        const models = providerDays[dayKey]!;
        const modelNames = Object.keys(models).sort();
        let dayInput = 0;
        let dayOutput = 0;
        let dayCacheRead = 0;
        let dayCacheWrite = 0;
        let dayTotalTokens = 0;
        let dayCostNanos = 0;
        let dayCostSamples = 0;
        const breakdown: ModelBreakdown[] = [];

        for (const modelName of modelNames) {
            const packed = models[modelName]!;
            const modelTotal = Math.max(
                packed.totalTokens,
                packed.inputTokens + packed.cacheReadTokens + packed.cacheWriteTokens + packed.outputTokens,
            );
            const currentCost =
                provider === "codex"
                    ? costCodex(modelName, packed.inputTokens + packed.cacheReadTokens + packed.cacheWriteTokens, packed.cacheReadTokens, packed.outputTokens)
                    : costClaude(modelName, packed.inputTokens, packed.cacheReadTokens, packed.cacheWriteTokens, packed.outputTokens);
            const hasCompleteCachedCost = packed.usageSampleCount > 0 && packed.costSampleCount === packed.usageSampleCount;
            const costNanos = hasCompleteCachedCost ? packed.costNanos : currentCost === null ? null : Math.round(currentCost * costScale);
            breakdown.push({
                modelName,
                totalTokens: modelTotal,
                costUSD: costNanos === null ? null : costNanos / costScale,
            });
            dayInput += packed.inputTokens;
            dayOutput += packed.outputTokens;
            dayCacheRead += packed.cacheReadTokens;
            dayCacheWrite += packed.cacheWriteTokens;
            dayTotalTokens += modelTotal;
            if (costNanos !== null) {
                dayCostNanos += costNanos;
                dayCostSamples += 1;
            }
        }

        entries.push({
            date: dayKey,
            inputTokens: dayInput,
            outputTokens: dayOutput,
            cacheReadTokens: dayCacheRead,
            cacheCreationTokens: dayCacheWrite,
            totalTokens: dayTotalTokens,
            costUSD: dayCostSamples > 0 ? dayCostNanos / costScale : null,
            modelsUsed: modelNames,
            modelBreakdowns: sortedBreakdowns(breakdown),
        });
        totalInput += dayInput;
        totalOutput += dayOutput;
        totalCacheRead += dayCacheRead;
        totalCacheWrite += dayCacheWrite;
        totalTokens += dayTotalTokens;
        totalCostNanos += dayCostNanos;
        totalCostSamples += dayCostSamples;
    }

    return {
        data: entries,
        summary: {
            totalInputTokens: totalInput,
            totalOutputTokens: totalOutput,
            cacheReadTokens: totalCacheRead,
            cacheCreationTokens: totalCacheWrite,
            totalTokens,
            totalCostUSD: totalCostSamples > 0 ? totalCostNanos / costScale : null,
        },
    };
}

// MARK: - Grok local session scanner

// Mirrors GrokLocalSessionScanner.summarize.
export interface GrokSummary {
    sessionCount: number;
    totalTokens: number;
    lastSessionAt: Date | null;
    primaryModel: string | null;
    models: string[];
}

export function scanGrokLocalSessions(options: ScanOptions = {}): GrokSummary {
    const home = options.home ?? process.env.HOME ?? "/tmp";
    const root = options.grokSessionsRoot ?? path.join(home, ".grok", "sessions");
    const lookbackDays = options.lookbackDays ?? 30;
    const now = new Date();
    const lookbackCutoff = new Date(now);
    lookbackCutoff.setDate(lookbackCutoff.getDate() - lookbackDays);

    let sessionCount = 0;
    let totalTokens = 0;
    let lastSessionAt: Date | null = null;
    const modelCounts = new Map<string, number>();

    function recurse(dir: string) {
        if (!fs.existsSync(dir)) return;
        for (const entry of fs.readdirSync(dir)) {
            const full = path.join(dir, entry);
            const stat = fs.statSync(full);
            if (stat.isDirectory()) {
                recurse(full);
            } else if (entry === "signals.json") {
                if (stat.mtime < lookbackCutoff) continue;
                let json: Record<string, unknown>;
                try {
                    json = JSON.parse(fs.readFileSync(full, "utf8")) as Record<string, unknown>;
                } catch {
                    continue;
                }
                sessionCount++;
                const beforeCompaction = toInt(json.totalTokensBeforeCompaction);
                const contextUsed = toInt(json.contextTokensUsed);
                totalTokens += beforeCompaction + contextUsed;
                if (!lastSessionAt || stat.mtime > lastSessionAt) lastSessionAt = stat.mtime;

                const primary = String(json.primaryModelId ?? "").trim();
                if (primary) modelCounts.set(primary, (modelCounts.get(primary) ?? 0) + 1);
                const modelsUsed = json.modelsUsed;
                if (Array.isArray(modelsUsed)) {
                    for (const m of modelsUsed) {
                        const trimmed = String(m ?? "").trim();
                        if (trimmed) modelCounts.set(trimmed, (modelCounts.get(trimmed) ?? 0) + 1);
                    }
                }
            }
        }
    }
    recurse(root);

    const sortedModels = Array.from(modelCounts.entries())
        .sort((a, b) => b[1] - a[1])
        .map(([name]) => name);

    return {
        sessionCount,
        totalTokens,
        lastSessionAt,
        primaryModel: sortedModels[0] ?? null,
        models: sortedModels,
    };
}

// MARK: - Top-level loader

// Mirrors the shape returned by the app's token snapshot probes.
export function loadTokenSnapshot(provider: UsageProvider, options: ScanOptions = {}): TokenSnapshot {
    const range = makeDayRange(daysAgo(30), new Date());

    switch (provider) {
        case "claude":
        case "vertexai": {
            const filter = provider === "vertexai" ? "vertexAIOnly" : options.claudeLogProviderFilter ?? "excludeVertexAI";
            const report = scanClaudeProjectLogs({ ...options, claudeLogProviderFilter: filter });
            return snapshotFromReport(report, range);
        }
        case "codex": {
            const report = scanCodexSessions(options);
            return snapshotFromReport(report, range);
        }
        case "grok": {
            const summary = scanGrokLocalSessions(options);
            return {
                sessionTokens: summary.totalTokens,
                last30DaysTokens: summary.totalTokens,
                last30DaysCostUSD: null,
            };
        }
    }
}

function snapshotFromReport(report: DailyReport, range: DayRange): TokenSnapshot {
    let sessionTokens = 0;
    let last30DaysTokens = 0;
    let last30DaysCostUSD: number | null = null;

    for (const entry of report.data) {
        if (isInRange(entry.date, range.sinceKey, range.untilKey)) {
            sessionTokens += entry.totalTokens;
            last30DaysTokens += entry.totalTokens;
            if (entry.costUSD !== null) {
                last30DaysCostUSD = (last30DaysCostUSD ?? 0) + entry.costUSD;
            }
        }
    }

    return { sessionTokens, last30DaysTokens, last30DaysCostUSD };
}

// MARK: - Utilities

function enumerateJsonl(root: string): string[] {
    const out: string[] = [];
    if (!fs.existsSync(root)) return out;
    function recurse(dir: string) {
        for (const entry of fs.readdirSync(dir)) {
            const full = path.join(dir, entry);
            const stat = fs.statSync(full);
            if (stat.isDirectory()) {
                recurse(full);
            } else if (entry.toLowerCase().endsWith(".jsonl")) {
                out.push(full);
            }
        }
    }
    recurse(root);
    return out;
}

function sortedBreakdowns(breakdowns: ModelBreakdown[]): ModelBreakdown[] {
    return breakdowns.sort((a, b) => {
        const aCost = a.costUSD ?? -1;
        const bCost = b.costUSD ?? -1;
        if (aCost !== bCost) return bCost - aCost;
        const aTokens = a.totalTokens;
        const bTokens = b.totalTokens;
        if (aTokens !== bTokens) return bTokens - aTokens;
        return b.modelName.localeCompare(a.modelName);
    });
}

function daysAgo(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - n);
    d.setHours(0, 0, 0, 0);
    return d;
}
```
