import fs from 'node:fs/promises';
import { ENV_KEY_PATTERN } from './validators';

/**
 * Parse a dotenv-style file.
 *
 * Supported:
 *   KEY=value
 *   export KEY=value
 *   KEY="value with spaces"   (\n, \", \\ escapes are honoured)
 *   KEY='literal value'
 *   KEY=value # trailing comment (unquoted values only)
 *   # comment lines and blank lines
 */
export function parseEnvFile(content: string, sourceName: string = '.env'): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.replace(/^﻿/, '').split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;

    const match = /^(?:export\s+)?([^=\s]+)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      throw new Error(`${sourceName}:${index + 1}: expected KEY=value`);
    }

    const [, key, rawValue] = match;
    if (!ENV_KEY_PATTERN.test(key)) {
      throw new Error(`${sourceName}:${index + 1}: invalid variable name "${key}"`);
    }

    result[key] = parseValue(rawValue, `${sourceName}:${index + 1}`);
  });

  return result;
}

function parseValue(raw: string, location: string): string {
  if (raw.startsWith('"')) {
    const end = findClosingQuote(raw);
    if (end === -1) throw new Error(`${location}: unterminated double-quoted value`);
    return raw
      .slice(1, end)
      .replace(/\\(.)/g, (_, ch: string) => (ch === 'n' ? '\n' : ch === 'r' ? '\r' : ch));
  }

  if (raw.startsWith("'")) {
    const end = raw.indexOf("'", 1);
    if (end === -1) throw new Error(`${location}: unterminated single-quoted value`);
    return raw.slice(1, end);
  }

  // Unquoted: strip an inline comment that is preceded by whitespace.
  const commentIndex = raw.search(/\s#/);
  return (commentIndex === -1 ? raw : raw.slice(0, commentIndex)).trim();
}

function findClosingQuote(raw: string): number {
  for (let i = 1; i < raw.length; i++) {
    if (raw[i] === '\\') {
      i++;
      continue;
    }
    if (raw[i] === '"') return i;
  }
  return -1;
}

export async function loadEnvFile(filePath: string): Promise<Record<string, string>> {
  let content: string;
  try {
    content = await fs.readFile(filePath, 'utf-8');
  } catch {
    throw new Error(`env_file not found: ${filePath}`);
  }
  return parseEnvFile(content, filePath);
}
