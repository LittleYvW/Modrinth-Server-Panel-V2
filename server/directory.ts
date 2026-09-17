import { readdir, stat } from 'node:fs/promises';
import { isAbsolute, normalize } from 'node:path';
import type { DirectoryListing } from '../shared/types.js';
import { HttpError } from './errors.js';

export function directoryPath(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0') || !isAbsolute(value.trim())) {
    throw new HttpError(400, '请输入服务器上的绝对目录路径。');
  }
  return normalize(value.trim());
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
    return { path, entries };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') throw new HttpError(400, '目录不存在，请检查路径。');
    if (code === 'ENOTDIR') throw new HttpError(400, '该路径不是目录。');
    if (code === 'EACCES' || code === 'EPERM') throw new HttpError(403, '没有读取此目录的权限。');
    throw new HttpError(400, '无法读取此目录，请检查路径和访问权限。');
  }
}
