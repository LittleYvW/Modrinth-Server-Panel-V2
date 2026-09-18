import { randomBytes } from 'node:crypto';
import { readdir, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, normalize } from 'node:path';
import type { DirectoryListing } from '../shared/types.js';
import { errorCode, HttpError, isPermissionError } from './errors.js';

export function directoryPath(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || !isAbsolute(value.trim())) {
    throw new HttpError(400, '请输入服务器上的绝对目录路径。');
  }
  return normalize(value.trim());
}
// Permission bits and Windows ACLs both lie to access(); creating and removing a scratch file is the honest test.
// The name never ends in .jar, so the mod scanner ignores it even if it is seen mid-probe.
export async function probeWritable(path: string) {
  const probe = join(path, `.server-mods-write-check-${randomBytes(6).toString('hex')}`);
  try { await writeFile(probe, '', { flag: 'wx' }); }
  catch { return false; }
  await rm(probe, { force: true }).catch(() => undefined);
  return true;
}
export async function readDirectory(value: unknown): Promise<DirectoryListing> {
  const path = directoryPath(value);
  try {
    if (!(await stat(path)).isDirectory()) throw new HttpError(400, '该路径不是目录。');
    const files = await readdir(path, { withFileTypes: true });
    const entries: DirectoryListing['entries'] = files.map(file => ({
      name: file.name,
      type: file.isDirectory() ? 'directory' : file.isSymbolicLink() ? 'link' : file.isFile() ? 'file' : 'other',
    }));
    entries.sort((a, b) => Number(b.type === 'directory') - Number(a.type === 'directory') || a.name.localeCompare(b.name));
    // The panel moves files into and out of client-only, so both levels need write access.
    const client = entries.some(entry => entry.name === 'client-only' && entry.type === 'directory');
    const writable = await probeWritable(path) && (!client || await probeWritable(join(path, 'client-only')));
    return { path, entries, writable };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const code = errorCode(error);
    if (code === 'ENOENT') throw new HttpError(400, '目录不存在，请检查路径。');
    if (code === 'ENOTDIR') throw new HttpError(400, '该路径不是目录。');
    if (isPermissionError(error)) throw new HttpError(403, '没有读取此目录的权限。');
    throw new HttpError(400, '无法读取此目录，请检查路径和访问权限。');
  }
}
