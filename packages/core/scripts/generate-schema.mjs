import { writeFileSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { ReportSchema } from '../dist/schema/report.js';

const schema = z.toJSONSchema(ReportSchema);
const targetPath = fileURLToPath(new URL('../schema/report.schema.json', import.meta.url));

writeFileSync(targetPath, `${JSON.stringify(schema, null, 2)}\n`);
writeSync(process.stdout.fd, `Generated JSON schema to ${targetPath}\n`);
