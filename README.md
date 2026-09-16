# Server Mods

基于 React、TypeScript 和 Vite 的 Minecraft 模组下载界面，按参考图绘制 SVG 圆环、双头扳手与像素装饰。所有图形均在本地，无外部图片或字体依赖。

## 开发

需要 Node.js 22.12+（已在 Node.js 24 环境验证）。

```sh
npm install
npm run dev
```

## 检查与构建

```sh
npm run typecheck
npm run build
npm run preview
```

默认地址为 http://localhost:5173。生产文件输出到 `dist`。

## 功能

- 中文模组列表、整合包和服务器演示面板。
- 下载操作显示演示提示，不请求或下载真实资源。
- 管理设置使用原生模态对话框，支持 Escape、焦点约束及关闭后焦点恢复。
- 深浅主题通过 localStorage 保存，存储不可用时继续在内存中切换。
- 响应式布局、键盘焦点样式及减少动态效果偏好。

模组数据在 `src/data.ts`；组件在 `src/App.tsx`；本地矢量图在 `src/Artwork.tsx`。后续可替换本地数据并将下载回调连接到真实服务。本项目不包含服务器管理或身份验证后端。
