export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;
// Windows reports denied access as EPERM as often as EACCES; a read-only mount is the same problem to an administrator.
export const isPermissionError = (error: unknown) => ['EACCES', 'EPERM', 'EROFS'].includes(errorCode(error) ?? '');

export function dataWriteProblem(error: unknown, what: string) {
  if (isPermissionError(error)) return `无法保存${what}：没有写入数据目录的权限，请检查 DATA_DIR 与运行用户的权限。`;
  if (errorCode(error) === 'ENOSPC') return `无法保存${what}：磁盘空间不足。`;
  return `无法保存${what}，请检查数据目录状态。`;
}
