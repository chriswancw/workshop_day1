#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');

const DEFAULT_API_BASE = 'http://localhost:3000';
const USAGE = `Usage:
  snip add <url>    Create a short link
  snip ls           List links and hit counts
  snip open <code>  Open a short link in the default browser
  snip help         Show this help

Set SNIP_API to change the backend URL (default: ${DEFAULT_API_BASE}).`;

function getApiBase(value = process.env.SNIP_API || DEFAULT_API_BASE) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('SNIP_API must be a valid HTTP(S) URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('SNIP_API must be a valid HTTP(S) URL.');
  }
  return url.href.replace(/\/+$/, '');
}

function validateHttpUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('URL must be a valid HTTP(S) URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('URL must be a valid HTTP(S) URL.');
  }
  return url.href;
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('The backend returned an invalid JSON response.');
  }
}

async function requestJson(path, options, { apiBase, fetchImpl }) {
  let response;
  try {
    response = await fetchImpl(`${apiBase}${path}`, {
      ...options,
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    const reason = error && error.name === 'TimeoutError'
      ? 'request timed out'
      : error && error.message
        ? error.message
        : 'network error';
    throw new Error(`Could not reach Snip API at ${apiBase}: ${reason}.`);
  }

  const body = await readJson(response);
  if (!response.ok) {
    const detail = body && typeof body.error === 'string'
      ? body.error
      : `HTTP ${response.status}`;
    throw new Error(`Snip API error: ${detail}`);
  }
  return { response, body };
}

function formatLinks(links) {
  if (links.length === 0) return 'No links yet.';

  const rows = links.map((link) => [
    String(link.code),
    String(link.hits),
    String(link.url),
  ]);
  const widths = [0, 0, 0];
  for (const row of [['CODE', 'HITS', 'URL'], ...rows]) {
    row.forEach((value, index) => {
      widths[index] = Math.max(widths[index], value.length);
    });
  }
  const formatRow = (row) => row
    .map((value, index) => value.padEnd(widths[index]))
    .join('  ')
    .trimEnd();
  return [formatRow(['CODE', 'HITS', 'URL']), ...rows.map(formatRow)].join('\n');
}

function launchBrowser(url, platform = process.platform, spawnImpl = spawn) {
  let command;
  let args;
  let options = { detached: true, stdio: 'ignore', windowsHide: true };

  if (platform === 'win32') {
    command = 'cmd.exe';
    args = ['/d', '/s', '/c', `start "" "${url}"`];
    options.windowsVerbatimArguments = true;
  } else if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(command, args, options);
    } catch (error) {
      reject(new Error(`Could not launch the default browser: ${error.message}`));
      return;
    }
    child.once('error', (error) => {
      reject(new Error(`Could not launch the default browser: ${error.message}`));
    });
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function runCli(argv, dependencies = {}) {
  const stdout = dependencies.stdout || process.stdout;
  const stderr = dependencies.stderr || process.stderr;
  const fetchImpl = dependencies.fetchImpl || globalThis.fetch;
  const openBrowser = dependencies.openBrowser || launchBrowser;
  const apiBase = getApiBase(dependencies.apiBase || process.env.SNIP_API || DEFAULT_API_BASE);
  const [command, ...args] = argv;

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    stdout.write(`${USAGE}\n`);
    return 0;
  }

  if (command === 'add') {
    if (args.length !== 1) throw new Error('Usage: snip add <url>');
    const url = validateHttpUrl(args[0]);
    const { response, body } = await requestJson('/api/links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    }, { apiBase, fetchImpl });
    if (response.status !== 201 || !body || typeof body.shortUrl !== 'string') {
      throw new Error('The backend returned an invalid create-link response.');
    }
    stdout.write(`${body.shortUrl}\n`);
    return 0;
  }

  if (command === 'ls') {
    if (args.length !== 0) throw new Error('Usage: snip ls');
    const { body } = await requestJson('/api/links', {}, { apiBase, fetchImpl });
    if (!Array.isArray(body)) throw new Error('The backend returned an invalid links list.');
    stdout.write(`${formatLinks(body)}\n`);
    return 0;
  }

  if (command === 'open') {
    if (args.length !== 1 || !args[0]) throw new Error('Usage: snip open <code>');
    const code = encodeURIComponent(args[0]);
    let response;
    try {
      response = await fetchImpl(`${apiBase}/${code}`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(10000),
      });
    } catch (error) {
      const reason = error && error.name === 'TimeoutError'
        ? 'request timed out'
        : error && error.message
          ? error.message
          : 'network error';
      throw new Error(`Could not reach Snip API at ${apiBase}: ${reason}.`);
    }
    if (response.status === 404) throw new Error(`Unknown short code: ${args[0]}`);
    const location = response.headers.get('location');
    if (response.status !== 302 || !location) {
      throw new Error(`Snip API error: expected a 302 redirect, received HTTP ${response.status}.`);
    }

    let target;
    try {
      target = new URL(location, `${apiBase}/`);
    } catch {
      throw new Error('The backend returned an invalid redirect target.');
    }
    if (target.protocol !== 'http:' && target.protocol !== 'https:') {
      throw new Error('The backend returned a non-HTTP(S) redirect target.');
    }
    await openBrowser(target.href);
    stdout.write(`Opened ${target.href}\n`);
    return 0;
  }

  throw new Error(`Unknown command: ${command}\n${USAGE}`);
}

if (require.main === module) {
  runCli(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stderr.write(`Error: ${error.message}\n`);
      process.exitCode = 1;
    },
  );
}

module.exports = {
  formatLinks,
  getApiBase,
  launchBrowser,
  runCli,
  validateHttpUrl,
};
