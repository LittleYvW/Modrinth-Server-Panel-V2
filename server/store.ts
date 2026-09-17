import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { loaders, type PanelConfig } from '../shared/types.js';
import { HttpError } from './errors.js';

const deriveKey = promisify(scrypt);
export type PasswordHash = { salt: string; hash: string };
type State = { version: 1; admin: PasswordHash | null; config: PanelConfig | null };

export function validatePassword(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 256) {
    throw new HttpError(400, '密码须为 8–256 个字符。');
  }
}
export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = randomBytes(16).toString('hex');
  const key = await deriveKey(password, salt, 64) as Buffer;
  return { salt, hash: key.toString('hex') };
}
export async function verifyPassword(password: unknown, saved: PasswordHash) {
  if (typeof password !== 'string' || password.length > 256) return false;
  const key = await deriveKey(password, saved.salt, 64) as Buffer;
  return timingSafeEqual(key, Buffer.from(saved.hash, 'hex'));
}

// One process owns the data directory; all mutations share this queue.
export async function createStore(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = join(directory, 'panel.json');
  let state: State = { version: 1, admin: null, config: null };
  try {
    const saved = JSON.parse(await readFile(filename, 'utf8')) as State;
    if (saved.version !== 1 || !('admin' in saved) || !('config' in saved)
      || (saved.admin && (!/^[a-f0-9]{32}$/.test(saved.admin.salt) || !/^[a-f0-9]{128}$/.test(saved.admin.hash)))
      || (saved.config && (!saved.admin || typeof saved.config.modsDirectory !== 'string'
        || typeof saved.config.minecraftVersion !== 'string' || !loaders.includes(saved.config.loader)
        || !(saved.config.loaderVersion === null || typeof saved.config.loaderVersion === 'string')))) {
      throw new Error('配置文件格式不正确，请恢复有效备份。');
    }
    state = saved;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  let queue: Promise<unknown> = Promise.resolve();
  return {
    read: () => state,
    update(change: (previous: State) => Promise<State> | State) {
      const operation = queue.then(async () => {
        const next = await change(state);
        const temporary = `${filename}.${randomBytes(8).toString('hex')}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600, flag: 'wx' });
          await rename(temporary, filename);
          state = next;
        } finally {
          await rm(temporary, { force: true });
        }
      });
      queue = operation.catch(() => undefined);
      return operation;
    },
  };
}
