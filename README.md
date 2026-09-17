# Server Mods

基于 React、TypeScript、Vite 和 Express 的 Minecraft 模组面板。前台展示整合包；后台提供仅密码的管理员注册、登录与游戏环境配置。背景图形均为本地 SVG，无外部图片或字体依赖。

## 开发

需要 Node.js 22.12+（已在 Node.js 24 环境验证）。

```sh
npm install
npm run dev
```

开发命令同时启动 Vite（默认 `http://localhost:5173`）和 API（默认 `http://127.0.0.1:3001`），Vite 将 `/api` 代理到后端。

## 检查、测试与生产运行

```sh
npm run typecheck
npm test
npm run build
npm start
```

生产运行默认地址为 `http://127.0.0.1:3001`，由同一个服务提供前端和 API。前端输出到 `dist`，后端输出到 `dist-server`。`npm run preview` 同样启动完整生产服务，需要先构建。

可选环境变量：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 服务监听地址；需要局域网访问时设为 `0.0.0.0` |
| `PORT` | `3001` | API／生产服务端口；修改开发端口时同步调整 Vite 代理 |
| `DATA_DIR` | `.panel-data` | 认证和配置数据目录，相对于启动工作目录；须在静态文件目录之外 |
| `PUBLIC_ORIGIN` | 当前请求的协议与 Host | 反向代理后的完整外部来源，例如 `https://mods.example.com`；不含路径 |

反向代理部署时，将前端和 `/api` 一起代理到服务，并设置 `PUBLIC_ORIGIN` 为用户访问的来源。HTTPS 来源启用 Secure Cookie。开发时不必设置该变量；若设置，必须与 Vite 页面来源一致。

每个数据目录只运行一个后端进程。运行用户需要读取模组目录和写入数据目录的权限。数据文件采用串行、原子替换，密码仅保存随机盐和 scrypt 哈希；数据目录不通过 HTTP 公开，也不提交 Git。损坏的数据文件会导致启动失败，不会自动清空密码或配置。

本机若 npm 启动脚本指向失效的全局安装，可直接调用有效的 npm CLI：

```powershell
& 'C:\Program Files\nodejs\node.exe' 'C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js' run dev
```

## 功能

- 点击前台“管理”：没有密码时显示“管理员注册”，设置并确认至少 8 位密码；以后仅输入密码登录，不使用用户名。首次启动后先完成注册，再开放面板访问。
- 注册／登录后进入 `#/admin`。未完成配置时依次设置模组目录、Minecraft 和加载器；已完成时直接进入空的模组管理器。
- 目录使用服务器机器上的绝对路径。输入框右侧“检查”真实列出当前层级的文件与子目录，成功后变为“确认”。空目录有效，修改路径须重新检查，保存时再次验证可读取。
- 支持 Fabric、Forge、NeoForge、Quilt。版本可从官方在线列表选择或手动输入，加载器版本留空表示不指定。Minecraft 默认只列正式版，可开启快照。版本请求有 8 秒超时、1 小时缓存；网络错误时可以重试或手动输入。
- 两步引导整体保存；中途退出，下次重新开始。已保存的游戏与加载器版本同步到前台标题，目录始终只对已登录管理员可见。
- 后台右上角提供设置、退出和主题切换。设置可修改目录与版本、切换主题、修改密码。密码修改需要验证当前密码，并使全部会话失效。
- 会话使用 HttpOnly、SameSite Cookie，最长 24 小时，服务重启后重新登录。认证请求每个客户端地址每 15 分钟最多 10 次；写操作校验来源。
- 对话框支持 Escape、键盘焦点约束与关闭后的焦点恢复；提供窄屏布局与减少动态效果支持。主题通过 localStorage 按浏览器保存，存储不可用时仍可在内存切换。

后台模组管理内容按当前阶段要求留空。前台模组列表仍使用演示数据，下载按钮仍显示演示提示，不会下载真实资源。

## 接口与代码

共享类型位于 `shared/types.ts`；前端组件位于 `src`；后端位于 `server`。

| 接口 | 说明 |
| --- | --- |
| `GET /api/auth/status` | 注册、登录和引导完成状态 |
| `POST /api/auth/register` | 首次创建密码，正文 `{ password }` |
| `POST /api/auth/login` | 登录，正文 `{ password }` |
| `POST /api/auth/logout` | 注销当前会话，正文 `{}` |
| `PUT /api/auth/password` | 改密，正文 `{ currentPassword, newPassword }` |
| `POST /api/admin/directory/check` | 检查目录，正文 `{ path }` |
| `GET /api/admin/config` | 获取完整配置，尚未完成时返回 `null` |
| `PUT /api/admin/config` | 保存 `modsDirectory`、`minecraftVersion`、`loader` 和可空 `loaderVersion` |
| `GET /api/admin/versions/minecraft` | Minecraft 正式版与快照 |
| `GET /api/admin/versions/loaders?loader=fabric&minecraft=1.20.1` | 对应加载器版本 |
| `GET /api/public/config` | 仅公开游戏与加载器信息，未配置时为 `null` |

除状态、注册、登录、公开配置外均需有效会话。写操作须带 `Origin` 和 `Content-Type: application/json`。首次或变更目录时，保存之前须完成目录检查。

自动化测试使用隔离的临时数据目录和模拟版本源，不依赖外网或现有管理员密码；覆盖认证、会话、目录权限、配置持久化、版本适配和表单交互。
