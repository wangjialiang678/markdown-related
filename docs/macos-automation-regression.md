# macOS 自动化回归（Minimal Viewer 分支）

Version: `0.3.1`  
Updated: `2026-02-25`

## 范围

本分支的目标是“极简只读”：

- 去掉 PDF 导出
- 去掉编辑、工具栏、侧栏
- 仅保留打开 `.md` 后直接渲染显示

## 自动化回归覆盖

脚本：`scripts/e2e-macos-regression.mjs`

覆盖流程：

1. 启动 app 并传入 markdown 文件路径
2. 校验首个 markdown 内容已渲染
3. 点击 markdown 内部链接（相对路径 `.md`）
4. 校验第二个 markdown 内容已渲染
5. 输出截图与 `result.json`

## 执行命令

```bash
source "$HOME/.cargo/env"
npm run test:e2e:mac
```

## 产物目录

- `artifacts/e2e-macos/<timestamp>/01-first-page.png`
- `artifacts/e2e-macos/<timestamp>/02-second-page.png`
- `artifacts/e2e-macos/<timestamp>/result.json`

## 设计取舍

- 保留 WebDriver 仅用于 debug 回归：`#[cfg(all(debug_assertions, feature = "webdriver"))]`
- release 构建不启用 WebDriver
- 不依赖系统打印对话框与 PDF 引擎，回归更稳定
