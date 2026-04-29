import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ReportSchema } from '../src/schema/report.js';

const schema = zodToJsonSchema(ReportSchema, {
  name: 'Sentiness Report',
  $refStrategy: 'none',
});

const output = JSON.stringify(schema, null, 2);
const targetPath = resolve(process.cwd(), 'packages/core/schema/report.schema.json');

writeFileSync(targetPath, `${output}\n`);
console.log(`Generated JSON schema to ${targetPath}`);
