#!/usr/bin/env bun
// Entry point for the agent-inbox CLI. Commands are added in phase 1 (spec §8).
console.log(JSON.stringify({ api_version: 1, ok: false, error: { code: "NOT_IMPLEMENTED", message: "agent-inbox is under construction", retryable: false } }));
process.exit(1);
