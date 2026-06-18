// Server-only DB access using dynamic import to avoid bundling issues
import 'server-only';

let cached: any = null;
let cachedCore: any = null;

export async function getDb() {
  if (cached) return cached;
  const { initializeDatabase } = await import('@agent-usage/db');
  const { loadConfig } = await import('@agent-usage/core');
  const config = loadConfig();
  cached = initializeDatabase(config.dbPath);
  return cached;
}

export async function getCore() {
  if (cachedCore) return cachedCore;
  cachedCore = await import('@agent-usage/core');
  return cachedCore;
}
