import { spawn } from 'node:child_process';

const processes = [
  spawn('pnpm', ['--filter', '@giaokhoa/application', 'watch'], {
    stdio: 'inherit',
  }),
  spawn('pnpm', ['--filter', '@giaokhoa/database', 'watch'], {
    stdio: 'inherit',
  }),
  spawn(
    'pnpm',
    [
      'exec',
      'nest',
      'start',
      '--watch',
      '--exec',
      'node --watch-path=../../packages/application/dist --watch-path=../../packages/database/dist',
    ],
    {
      cwd: new URL('..', import.meta.url),
      stdio: 'inherit',
    },
  ),
];

let stopping = false;

function stopAll(signal = 'SIGTERM') {
  for (const child of processes) {
    if (child.exitCode === null && child.signalCode === null) child.kill(signal);
  }
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    stopping = true;
    stopAll(signal);
  });
}

for (const child of processes) {
  child.once('exit', (code) => {
    if (stopping) return;
    stopping = true;
    process.exitCode = code ?? 1;
    stopAll();
  });
}
