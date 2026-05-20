# Chrome Web Store Submission

Last updated: 2026-05-15

## Upload Package

- Package: `dist/toktra-0.3.7-chrome-web-store.zip`
- Version: `0.3.7`
- Extension directory: `extension/`
- Store icon: `extension/icons/icon128.png`

## Listing Assets

- Screenshot: `store-assets/screenshot-main-1280x800.png`
- Small promo tile: `store-assets/promo-small-440x280.png`
- Source HTML for regenerating assets: `store-assets/screenshot-main.html`, `store-assets/promo-small.html`

## Store Listing Copy

Name:

```text
toktra
```

Short description:

```text
Translate English webpages and PDFs into Simplified Chinese with inline, progressive rendering.
```

Full description:

```text
toktra is a Chrome translation extension for readers who want fast English-to-Chinese inline translation without replacing the original page.

It translates English webpages, selected text, and PDFs into Simplified Chinese, then renders the translation below the original content. The translation queue prioritizes the current viewport and the next two screens, so visible content appears first while lower content waits until the user scrolls.

Key features:
- Inline English-to-Chinese translation for webpages.
- PDF translation through toktra's built-in PDF viewer, including local file:// PDFs when Chrome file URL access is enabled.
- Manual mode, current-site auto mode, and global auto mode.
- Selection translation popup for highlighted English text.
- Local translation cache for faster repeat visits.
- Optional AI webpage-structure analysis that sends only a lightweight page outline to the user-configured API.
- User-configured OpenAI-compatible API endpoint, API key, and model.

toktra keeps the original HTML visible and adds translations as separate inline blocks. It does not sell data, display ads, or include analytics tracking.
```

Recommended category: `Productivity`

Primary language: `Chinese (Simplified)` or `English`, depending on the store listing locale you choose.

## Permission Justifications

`storage`

```text
Stores user settings, the encrypted-by-browser local API key value, translation cache, domain rules, and cached webpage-structure strategies.
```

`activeTab`

```text
Lets the user manually translate the currently active page after clicking the extension.
```

`scripting`

```text
Injects the content script into the current tab when the user manually starts translation on a page that was not already initialized.
```

`tabs`

```text
Reads the active tab URL and opens the toktra PDF translation viewer for PDF pages.
```

`<all_urls>`

```text
Allows toktra to translate webpages on domains where the user enables current-site or global automatic translation.
```

`file:///*`

```text
Allows toktra to read and translate local PDF files only after the user enables Chrome's "Allow access to file URLs" setting for the extension.
```

## Privacy / Data Use Answers

Single purpose:

```text
toktra translates English webpages, selected text, and PDFs into Simplified Chinese using a user-configured OpenAI-compatible API, then renders the translation inline below the original content.
```

Remote code:

```text
toktra does not load or execute remote code. PDF parsing is handled by bundled pdf.js files included in the extension package. Network requests are only made to the translation API endpoint configured by the user.
```

User data handled:

```text
Website content: English text segments selected for translation may be sent to the user-configured API.
Web history: Page URL/domain may be used locally for per-domain auto-translation settings, cache keys, and structure strategies.
Authentication information: The user-provided API key is stored in chrome.storage.local and is sent only as the Authorization header to the configured API endpoint.
```

Data sharing:

```text
toktra sends text only to the API endpoint configured by the user for the purpose of translation and optional structure analysis. toktra does not sell data, does not use data for advertising, and does not include analytics tracking.
```

Privacy policy URL:

```text
Publish docs/PrivacyPolicy.md to a public HTTPS URL before final submission, then paste that URL in the Chrome Web Store dashboard.
```

## Release Checklist

- [x] Manifest V3.
- [x] Version bumped to `0.3.7`.
- [x] 16, 32, 48, and 128 px PNG icons registered in manifest.
- [x] Extension lint passes.
- [x] Unit tests pass.
- [x] Store package ZIP generated with `manifest.json` at archive root.
- [ ] Privacy policy is hosted at a public HTTPS URL.
- [ ] Chrome Web Store developer account is registered and paid.
- [ ] Screenshots and promo image are uploaded in the Developer Dashboard.
- [ ] Data usage and permission justifications are filled in by the account owner.
- [ ] Account owner submits for review.

## Official References

- Chrome Web Store publish guide: https://developer.chrome.com/docs/webstore/publish
- Store image requirements: https://developer.chrome.com/docs/webstore/images
- Privacy practices form: https://developer.chrome.com/docs/webstore/cws-dashboard-privacy
- User data policy FAQ: https://developer.chrome.com/docs/webstore/program-policies/user-data-faq
