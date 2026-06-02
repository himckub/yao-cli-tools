import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

function boolEnv(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function splitPaths(value) {
  return String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => path.resolve(item));
}

export function loadConfig(env = process.env) {
  const dataDir = path.resolve(env.TOKHTML_DATA_DIR || path.join(rootDir, 'data'));
  return {
    name: 'tokhtml',
    rootDir,
    host: env.HOST || '127.0.0.1',
    port: Number(env.PORT || 8080),
    dataDir,
    uploadsDir: path.join(dataDir, 'uploads'),
    generatedDir: path.join(dataDir, 'generated'),
    trashDir: path.join(dataDir, 'trash'),
    versionsDir: path.join(dataDir, 'versions'),
    publicDir: path.join(rootDir, 'public'),
    watchDirs: splitPaths(env.TOKHTML_WATCH_DIRS || path.join(rootDir, 'html-inbox')),
    allowSourceWrite: boolEnv(env.TOKHTML_ALLOW_SOURCE_WRITE, false),
  };
}
