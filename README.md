# 剪贴板管理器

基于 uTools 的剪贴板历史管理插件，支持文本、图片、文件、代码片段记录，提供收藏分类、历史搜索、右侧预览和吸附侧栏交互。

## 功能

- 剪贴板历史记录：文本、图片、文件、代码片段。
- 格式筛选：全部、文本、图片、文件、代码、收藏。
- 收藏分类：默认 `常用`，支持自定义新增、重命名、删除和移动收藏。
- 双击复制：双击历史记录写入系统剪贴板。
- 吸附侧栏：主窗口右上角按钮可打开/关闭侧栏，侧栏靠屏幕边缘收起为窄条，悬浮展开。
- uTools 超级面板入口：支持选中文本、图片、文件保存到历史。

## 开发

```bash
npm install
npm run dev
```

在 uTools 开发者工具中导入：

```text
public/plugin.json
```

开发模式下插件主窗口会加载 Vite 服务：

```text
http://localhost:5173
```

## 构建

```bash
npm run build
```

构建产物输出到 `dist/`。发布或本地生产测试时，在 uTools 开发者工具中导入：

```text
dist/plugin.json
```

## 校验

```bash
npm run lint
npm run build
```

## 目录

```text
src/                    React 界面
public/plugin.json      uTools 插件清单
public/preload/         uTools preload 服务
public/sidebar.html     侧栏窗口入口
```

## 备注

`dist/`、`node_modules/`、`docs/`、`prototypes/`、本地日志和环境文件不会提交到 Git。发布前请重新执行 `npm run build` 生成最新产物。
