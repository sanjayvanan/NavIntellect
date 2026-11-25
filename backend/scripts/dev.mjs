// `npm run dev`: runs the API and the ingestor together (tsx watch), with prefixed output.
// Ctrl+C stops both. `predev` has already started Postgres/Redis and applied migrations.
import { spawn } from 'node:child_process';

const procs = [
  { name: 'api', color: 36, script: 'src/bin/api.ts' },
  { name: 'ingest', color: 35, script: 'src/bin/ingestor.ts' },
];

const children = procs.map(({ name, color, script }) => {
  const child = spawn(process.execPath, ['--import', 'tsx', '--watch', script], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '1' },
  });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) out.write(tag + l + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    process.stdout.write(`${tag}exited with code ${code}\n`);
    if (name === 'api') shutdown(code ?? 1); // API is essential; the ingestor may idle without a key
  });
  return child;
});

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null) c.kill('SIGTERM');
  setTimeout(() => process.exit(code), 1500).unref();
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
