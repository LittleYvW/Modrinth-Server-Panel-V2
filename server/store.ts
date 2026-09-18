import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { loaders, type DisplaySettings, type PanelConfig } from '../shared/types.js';
import { dataWriteProblem, HttpError } from './errors.js';

const deriveKey = promisify(scrypt);
export type PasswordHash = { salt: string; hash: string };
// `display` arrived after version 1 shipped, so older files simply lack it.
type State = { version: 1; config: PanelConfig | null; display?: DisplaySettings };

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
  let state: State = { version: 1, config: null };
  try {
    // Older files also hold an administrator hash; the password now comes from the environment, so it is dropped on the next write.
    const { admin: _legacy, ...saved } = JSON.parse(await readFile(filename, 'utf8')) as State & { admin?: unknown };
    if (saved.version !== 1 || !('config' in saved)
      || (saved.config && (typeof saved.config.modsDirectory !== 'string'
        || typeof saved.config.minecraftVersion !== 'string' || !loaders.includes(saved.config.loader)
        || !(saved.config.loaderVersion === null || typeof saved.config.loaderVersion === 'string')))
      || (saved.display !== undefined && (typeof saved.display?.showServerMods !== 'boolean' || typeof saved.display?.showClientMods !== 'boolean'))) {
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
        } catch (error) {
          console.error('Panel state could not be saved:', (error as NodeJS.ErrnoException).code ?? 'unknown error');
          throw new HttpError(500, dataWriteProblem(error, '面板配置'));
        } finally {
          await rm(temporary, { force: true }).catch(() => undefined);
        }
      });
      queue = operation.catch(() => undefined);
      return operation;
    },
  };
}
