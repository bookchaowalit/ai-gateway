#!/usr/bin/env node
// Runs the TypeScript MCP server through tsx (a devDependency: run `npm install` once).
import { register } from 'tsx/esm/api';

register();
const { main } = await import('./ai-gateway-mcp.ts');
await main();
