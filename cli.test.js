'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const http = require('node:http');
const { once } = require('node:events');
const test = require('node:test');
const { formatLinks, getApiBase, launchBrowser, runCli, validateHttpUrl } = require('./cli');

function run(argv, dependencies = {}) {
  let output = '';
  let errors = '';
  const streams = {
    stdout: { write: (text) => { output += text; } },
    stderr: { write: (text) => { errors += text; } },
  };
  return runCli(argv, { ...streams, ...dependencies }).then(
    (code) => ({ code, output, errors }),
    (error) => ({ error: error.message, output, errors }),
  );
}

test('help and no arguments print usage', async () => {
  for (const args of [[], ['help']]) {
    const result = await run(args);
    assert.equal(result.code, 0);
    assert.match(result.output, /snip add <url>/);
    assert.equal(result.errors, '');
  }
});

test('validates HTTP(S) input and API base', () => {
  assert.equal(validateHttpUrl('https://example.com/path'), 'https://example.com/path');
  assert.equal(validateHttpUrl('http://example.com'), 'http://example.com/');
  assert.throws(() => validateHttpUrl('ftp://example.com'), /HTTP\(S\)/);
  assert.throws(() => validateHttpUrl('not a URL'), /HTTP\(S\)/);
  assert.equal(getApiBase('https://api.example.com///'), 'https://api.example.com');
  assert.throws(() => getApiBase('file:///tmp/api'), /HTTP\(S\)/);
});

test('formats an aligned links table and the empty state', () => {
  assert.equal(formatLinks([]), 'No links yet.');
  const table = formatLinks([
    { code: 'abc123', hits: 2, url: 'https://example.com' },
    { code: 'x9', hits: 0, url: 'https://example.org/a-longer-path' },
  ]);
  assert.match(table, /CODE\s+HITS\s+URL/);
  assert.match(table, /abc123\s+2\s+https:\/\/example.com/);
  assert.match(table, /x9\s+0\s+https:\/\/example.org\/a-longer-path/);
});

test('add validates arguments before requesting and prints shortUrl', async () => {
  let called = false;
  const invalid = await run(['add', 'javascript:alert(1)'], {
    fetchImpl: async () => { called = true; },
  });
  assert.match(invalid.error, /HTTP\(S\)/);
  assert.equal(called, false);

  let posted;
  const result = await run(['add', 'https://example.com'], {
    fetchImpl: async (url, options) => {
      assert.equal(url, 'http://localhost:3000/api/links');
      posted = JSON.parse(options.body);
      return new Response(JSON.stringify({
        code: 'abc123', url: posted.url, shortUrl: 'http://localhost:3000/abc123',
        hits: 0, createdAt: new Date().toISOString(),
      }), { status: 201, headers: { 'content-type': 'application/json' } });
    },
  });
  assert.deepEqual(posted, { url: 'https://example.com/' });
  assert.equal(result.output, 'http://localhost:3000/abc123\n');
});

test('list renders links and the empty state', async () => {
  const links = [{ code: 'abc123', hits: 4, url: 'https://example.com' }];
  const result = await run(['ls'], {
    fetchImpl: async () => new Response(JSON.stringify(links)),
  });
  assert.match(result.output, /abc123\s+4\s+https:\/\/example.com/);

  const empty = await run(['ls'], {
    fetchImpl: async () => new Response('[]'),
  });
  assert.equal(empty.output, 'No links yet.\n');
});

test('open requests a manual redirect and launches its HTTP(S) target', async () => {
  let opened;
  const result = await run(['open', 'abc123'], {
    fetchImpl: async (url, options) => {
      assert.equal(url, 'http://localhost:3000/abc123');
      assert.equal(options.redirect, 'manual');
      return new Response(null, {
        status: 302,
        headers: { location: 'https://example.com/path' },
      });
    },
    openBrowser: async (url) => { opened = url; },
  });
  assert.equal(opened, 'https://example.com/path');
  assert.match(result.output, /Opened https:\/\/example.com\/path/);

  const badTarget = await run(['open', 'abc123'], {
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'javascript:alert(1)' } }),
    openBrowser: async () => assert.fail('unsafe target must not launch'),
  });
  assert.match(badTarget.error, /non-HTTP\(S\)/);
});

test('reports unknown codes, API failures, and unreachable backends', async () => {
  const missing = await run(['open', 'absent'], {
    fetchImpl: async () => new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
  });
  assert.match(missing.error, /Unknown short code/);

  const apiError = await run(['ls'], {
    fetchImpl: async () => new Response(JSON.stringify({ error: 'Unavailable' }), { status: 503 }),
  });
  assert.match(apiError.error, /Unavailable/);

  const unreachable = await run(['ls'], {
    fetchImpl: async () => { throw new TypeError('fetch failed'); },
  });
  assert.match(unreachable.error, /Could not reach Snip API/);
});

test('argument errors and unknown commands fail', async () => {
  assert.match((await run(['add'])).error, /Usage: snip add/);
  assert.match((await run(['ls', 'extra'])).error, /Usage: snip ls/);
  assert.match((await run(['open'])).error, /Usage: snip open/);
  assert.match((await run(['unknown'])).error, /Unknown command/);
});

test('launches browser through the platform command', async () => {
  const calls = [];
  const spawnMock = (command, args, options) => {
    calls.push({ command, args, options });
    const child = new EventEmitter();
    child.unref = () => {};
    process.nextTick(() => child.emit('spawn'));
    return child;
  };
  await launchBrowser('https://example.com/', 'win32', spawnMock);
  await launchBrowser('https://example.com/', 'darwin', spawnMock);
  await launchBrowser('https://example.com/', 'linux', spawnMock);
  assert.equal(calls[0].command, 'cmd.exe');
  assert.match(calls[0].args[3], /^start/);
  assert.deepEqual([calls[1].command, calls[2].command], ['open', 'xdg-open']);
});

test('CLI process exits 1 cleanly for a dead backend', async () => {
  const server = http.createServer((request, response) => {
    response.writeHead(500).end();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));

  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, [require.resolve('./cli'), 'ls'], {
    env: { ...process.env, SNIP_API: `http://127.0.0.1:${address.port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8').on('data', (text) => { stdout += text; });
  child.stderr.setEncoding('utf8').on('data', (text) => { stderr += text; });
  const [code] = await once(child, 'close');
  assert.equal(code, 1);
  assert.equal(stdout, '');
  assert.match(stderr, /Could not reach Snip API/);
});
