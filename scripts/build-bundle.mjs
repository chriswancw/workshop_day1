import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const frontend = join(root, 'frontend');
const bundle = join(root, 'bundle');
const output = join(frontend, 'dist', 'snip-frontend', 'browser');
const push = process.argv.includes('--push');

function run(command, args, cwd = root, options = {}) {
  const windowsScript = process.platform === 'win32' && (command === 'npm' || command === 'npx');
  const executable = windowsScript ? process.env.ComSpec ?? 'cmd.exe' : command;
  const executableArgs = windowsScript
    ? ['/d', '/s', '/c', `${command}.cmd ${args.join(' ')}`]
    : args;
  const result = spawnSync(executable, executableArgs, {
    cwd,
    stdio: options.stdio ?? 'inherit',
    encoding: options.encoding,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
  return result.stdout ?? '';
}

function git(args, cwd = root, options) {
  return run('git', args, cwd, options);
}

function hasStagedChanges(cwd) {
  const result = spawnSync('git', ['diff', '--cached', '--quiet'], {
    cwd,
    stdio: 'ignore',
  });
  if (result.error) throw result.error;
  if (result.status === 1) return true;
  if (result.status !== 0) throw new Error(`git diff --cached failed in ${cwd}`);
  return false;
}

function assertClean(cwd, label) {
  const status = git(['status', '--porcelain', '--untracked-files=all'], cwd, {
    stdio: 'pipe',
    encoding: 'utf8',
  }).trim();
  if (status) throw new Error(`${label} has uncommitted changes:\n${status}`);
}

function configureBundleGitIdentity() {
  for (const key of ['user.name', 'user.email']) {
    const bundleValue = git(['config', key], bundle, { stdio: 'pipe', encoding: 'utf8' }).trim();
    if (!bundleValue) {
      const mainValue = git(['config', key], root, { stdio: 'pipe', encoding: 'utf8' }).trim();
      if (!mainValue) throw new Error(`Git ${key} is not configured`);
      git(['config', key, mainValue], bundle);
    }
  }
}

try {
  git(['submodule', 'update', '--init', '--remote', 'backend', 'frontend', 'cli']);
  assertClean(bundle, 'bundle submodule');
  configureBundleGitIdentity();

  run('npm', ['install'], frontend);
  run('npx', ['ng', 'build'], frontend);
  const indexHtml = join(output, 'index.html');
  await readFile(indexHtml);

  await rm(join(bundle, 'public'), { recursive: true, force: true });
  await mkdir(join(bundle, 'public'), { recursive: true });
  await cp(output, join(bundle, 'public'), { recursive: true });
  await cp(join(root, 'backend', 'server.js'), join(bundle, 'server.js'));
  await cp(join(root, 'cli', 'cli.js'), join(bundle, 'cli.js'));
  await writeFile(join(bundle, '.env'), 'PUBLIC_DIR=./public\n');
  await writeFile(
    join(bundle, 'package.json'),
    `${JSON.stringify({ name: 'snip-bundle', private: true, scripts: { start: 'bun server.js' } }, null, 2)}\n`,
  );
  await writeFile(
    join(bundle, 'Dockerfile'),
    [
      'FROM oven/bun:1-alpine',
      'WORKDIR /app',
      'COPY . .',
      'ENV PORT=3000',
      'EXPOSE 3000',
      'CMD ["bun", "server.js"]',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(bundle, '.dockerignore'),
    ['.git', 'node_modules', 'npm-debug.log*', '.DS_Store', ''].join('\n'),
  );
  await writeFile(
    join(bundle, 'railway.json'),
    `${JSON.stringify({ build: { builder: 'DOCKERFILE' } }, null, 2)}\n`,
  );

  git(['add', '-A'], bundle);
  let changed = false;
  if (hasStagedChanges(bundle)) {
    git(
      [
        'commit',
        '-m',
        'Build generated Snip release bundle',
        '-m',
        'Co-authored-by: OpenBot <335604065+openbotgit[bot]@users.noreply.github.com>',
      ],
      bundle,
    );
    changed = true;
  }
  if (push) git(['push', 'origin', 'HEAD:bundle'], bundle);

  git(['add', '--', 'backend', 'frontend', 'cli', 'bundle']);
  if (hasStagedChanges(root)) {
    git([
      'commit',
      '-m',
      'Bump component and bundle submodules',
      '-m',
      'Co-authored-by: OpenBot <335604065+openbotgit[bot]@users.noreply.github.com>',
    ]);
    changed = true;
  }
  if (push) git(['push', 'origin', 'main']);

  if (!changed) console.log('Bundle and submodule pointers unchanged.');
  else console.log('Bundle generation complete.');
  if (!push) console.log('Not pushed; rerun with --push to publish bundle and main.');
} catch (error) {
  console.error(`Bundle build failed: ${error.message}`);
  process.exitCode = 1;
}
