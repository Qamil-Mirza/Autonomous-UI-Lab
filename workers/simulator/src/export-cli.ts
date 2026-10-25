import { resolve } from 'node:path';
import { exportReplay } from './replay';
const [source, destination] = process.argv.slice(2);
if (!source || !destination) throw new Error('Usage: replay:export <source-run-directory> <new-output-directory>');
const result = await exportReplay(resolve(source), resolve(destination));
console.log(`${result.manifest.provenance}: ${result.run.outcome}; ${result.run.events.length} events exported to ${resolve(destination)}`);
