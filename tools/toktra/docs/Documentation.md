# Toktra Documentation

Toktra 是 `yao-open-tools` 中的 Chrome MV3 英译中阅读扩展，用于英文网页、长文章、技术文档和 PDF 的辅助阅读。

## 入口文档

- [README](../README.md)：功能说明、安装加载方式、API 配置、PDF 翻译和开发验证。
- [Architecture](Architecture.md)：网页实时翻译的五层管线，包括 Segmenter、Scheduler、Provider、Render 和 Rule/AI Strategy。
- [ProductBrief](ProductBrief.md)：产品目标、用户场景和主要能力。
- [PrivacyPolicy](PrivacyPolicy.md)：浏览器页面、API Key、缓存和外部 API 调用的隐私边界。
- [ChromeWebStoreSubmission](ChromeWebStoreSubmission.md)：Chrome Web Store 提交流程和发布材料。

## 关键能力

- 网页翻译：按完整段落或完整句子识别文本模块，支持动态页面增量补译。
- 渐进式加载：优先翻译当前屏和后两屏，滚动后继续加载，降低 API token 消耗。
- 模式控制：支持手动模式、仅当前网站自动翻译、所有网站自动翻译。
- 划词翻译：默认保留选中文本翻译能力。
- PDF 翻译：自带 `pdf-viewer.html`，支持网页 PDF 和本地 `file://` PDF。
- PDF 视觉保留：译文页保留原 PDF 图层，遮罩原文文本区域后叠加中文译文。
- 本地缓存：译文按 provider、model、prompt、目标语言和文本 hash 分命名空间缓存。

## 本地开发

```bash
cd tools/toktra
npm install
npm test
npm run lint
```

## 加载扩展

```text
1. 打开 chrome://extensions/
2. 开启“开发者模式”
3. 点击“加载已解压的扩展程序”
4. 选择 tools/toktra/extension/
```

本地 PDF 需要在扩展详情中开启“允许访问文件网址 / Allow access to file URLs”。
