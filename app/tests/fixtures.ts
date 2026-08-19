import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HIER = dirname(fileURLToPath(import.meta.url));
export const FIXTURE_DIR = join(HIER, '..', '..', 'fixtures', 'gpg');

export interface FixtureMeta {
  readonly erzeugtMit: string;
  readonly passphrase: string;
  readonly rsa: { readonly fingerprint: string; readonly userId: string };
  readonly ecc: { readonly fingerprint: string; readonly userId: string };
  readonly klartext: string;
}

export function lies(datei: string): string {
  return readFileSync(join(FIXTURE_DIR, datei), 'utf8');
}

export const meta = JSON.parse(lies('meta.json')) as FixtureMeta;
export const KLARTEXT = lies('plaintext.txt');
