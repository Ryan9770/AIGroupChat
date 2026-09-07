import { readFile } from 'node:fs/promises';

const [scenario, fixture] = process.argv.slice(2);
let prompt = '';
for await (const chunk of process.stdin) prompt += chunk;
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);

if (scenario === 'fixture') {
  process.stdout.write(await readFile(fixture, 'utf8'));
} else if (scenario === 'stdin') {
  emit({ type: 'item.completed', item: { id: 'echo', type: 'agent_message', text: prompt } });
  emit({ type: 'turn.completed' });
} else if (scenario === 'late-exit') {
  emit({ type: 'turn.completed' });
  process.exitCode = 7;
} else if (scenario === 'late-timeout') {
  emit({ type: 'turn.completed' });
  setInterval(() => {}, 1000);
} else if (scenario === 'no-terminal') {
  emit({ type: 'turn.started' });
} else if (scenario === 'close-output') {
  emit({ type: 'turn.completed' });
  process.stdout.end();
  setTimeout(() => { process.exitCode = 0; }, 100);
} else {
  process.stderr.write('Unknown fake-agent scenario\n');
  process.exitCode = 2;
}
