import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const backgroundSource = readFileSync(new URL("../extension/background.js", import.meta.url), "utf8");

function loadBackground(overrides = {}) {
  const listeners = [];
  const store = structuredClone(overrides.store || {});
  const calls = [];
  const chrome = {
    runtime: {
      onMessage: {
        addListener(listener) {
          listeners.push(listener);
        }
      }
    },
    storage: {
      sync: {
        get(defaults) {
          return Promise.resolve({ ...defaults, ...(store.sync || {}) });
        },
        set(value) {
          store.sync = { ...(store.sync || {}), ...value };
          return Promise.resolve();
        }
      },
      local: {
        get(keys) {
          if (Array.isArray(keys)) {
            return Promise.resolve(Object.fromEntries(keys.map((key) => [key, store.local?.[key]])));
          }
          return Promise.resolve({ ...(store.local || {}) });
        },
        set(value) {
          store.local = { ...(store.local || {}), ...value };
          return Promise.resolve();
        }
      }
    }
  };

  const context = {
    chrome,
    fetch: async (url, init) => {
      calls.push({ url, init });
      const content =
        typeof overrides.fetchContent === "function"
          ? overrides.fetchContent({ url, init, calls })
          : overrides.fetchContent || JSON.stringify(["你好世界", "第二段"]);
      return {
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content
              }
            }
          ]
        })
      };
    },
    console
  };
  Function("globalThis", `${backgroundSource}\nreturn globalThis.ToktraBackground;`)(context);
  return { api: context.ToktraBackground, listeners, calls, store };
}

test("translateTexts calls an OpenAI-compatible endpoint and preserves response order", async () => {
  const { api, calls } = loadBackground({
    store: {
      sync: {
        toktraSettings: {
          enabled: true,
          apiBaseUrl: "https://api.example.com/v1",
          apiKey: "test-key",
          model: "gpt-test",
          temperature: 0.1
        }
      }
    }
  });

  const result = await api.translateTexts(["Hello world", "Second paragraph"]);

  assert.deepEqual(result.translations, ["你好世界", "第二段"]);
  assert.equal(calls[0].url, "https://api.example.com/v1/chat/completions");
  assert.equal(calls[0].init.headers.authorization, "Bearer test-key");
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, "gpt-test");
  assert.match(body.messages.at(-1).content, /Hello world/);
});

test("translateTexts adds precision guidance when AI precision mode is enabled", async () => {
  const { api, calls } = loadBackground({
    fetchContent: JSON.stringify(["精准译文"]),
    store: {
      sync: {
        toktraSettings: {
          enabled: true,
          apiBaseUrl: "https://api.example.com/v1",
          apiKey: "test-key",
          model: "gpt-test",
          preciseTranslation: true
        }
      }
    }
  });

  await api.translateTexts(["Use domain context when translating this sentence."]);

  const body = JSON.parse(calls[0].init.body);
  assert.match(body.messages[0].content, /context-aware/i);
});

test("translateTexts retries transient malformed API responses before returning translations", async () => {
  let attempts = 0;
  const { api, calls } = loadBackground({
    fetchContent: () => {
      attempts += 1;
      return attempts < 3 ? "not json yet" : JSON.stringify(["稳定译文"]);
    },
    store: {
      sync: {
        toktraSettings: {
          enabled: true,
          apiBaseUrl: "https://api.example.com/v1",
          apiKey: "test-key",
          model: "gpt-test"
        }
      }
    }
  });

  const result = await api.translateTexts(
    ["A paragraph that should survive transient API failures."],
    undefined,
    { maxRetries: 3, retryDelayMs: 0 }
  );

  assert.equal(result.ok, true);
  assert.deepEqual(result.translations, ["稳定译文"]);
  assert.equal(calls.length, 3);
});

test("translateTexts returns a controlled failure after retry attempts are exhausted", async () => {
  const { api, calls } = loadBackground({
    fetchContent: "not json",
    store: {
      sync: {
        toktraSettings: {
          enabled: true,
          apiBaseUrl: "https://api.example.com/v1",
          apiKey: "test-key",
          model: "gpt-test"
        }
      }
    }
  });

  const result = await api.translateTexts(
    ["A paragraph that should not leave an empty translation block."],
    undefined,
    { maxRetries: 2, retryDelayMs: 0 }
  );

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "bad_response");
  assert.equal(calls.length, 3);
});

test("translateTexts returns a setup error before calling the network when API key is missing", async () => {
  const { api, calls } = loadBackground({
    store: {
      sync: {
        toktraSettings: {
          enabled: true,
          apiBaseUrl: "https://api.example.com/v1",
          model: "gpt-test"
        }
      }
    }
  });

  const result = await api.translateTexts(["Hello world"]);

  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "missing_api_key");
  assert.equal(calls.length, 0);
});

test("getSettings migrates the legacy default text length to capture short UI modules", async () => {
  const { api } = loadBackground({
    store: {
      sync: {
        toktraSettings: {
          minTextLength: 16
        }
      }
    }
  });

  const settings = await api.getSettings();

  assert.equal(settings.minTextLength, 4);
  assert.equal(settings.settingsVersion, 2);
});

test("getSettings preserves an explicit current-version text length", async () => {
  const { api } = loadBackground({
    store: {
      sync: {
        toktraSettings: {
          settingsVersion: 2,
          minTextLength: 16
        }
      }
    }
  });

  const settings = await api.getSettings();

  assert.equal(settings.minTextLength, 16);
});

test("translateTexts stores translations locally and reuses the cache on the next call", async () => {
  const { api, calls } = loadBackground({
    store: {
      sync: {
        toktraSettings: {
          enabled: true,
          apiBaseUrl: "https://api.example.com/v1",
          apiKey: "test-key",
          model: "gpt-test"
        }
      }
    }
  });

  assert.deepEqual((await api.translateTexts(["Hello world", "Second paragraph"])).translations, ["你好世界", "第二段"]);
  assert.deepEqual((await api.translateTexts(["Hello world", "Second paragraph"])).translations, ["你好世界", "第二段"]);
  assert.equal(calls.length, 1);
});

test("translateSegments returns id-keyed results while preserving translation order", async () => {
  const { api, calls } = loadBackground({
    fetchContent: ({ init }) => {
      const body = JSON.parse(init.body);
      const texts = JSON.parse(body.messages.at(-1).content);
      return JSON.stringify(texts.map((text) => `译文：${text}`));
    },
    store: {
      sync: {
        toktraSettings: {
          enabled: true,
          apiBaseUrl: "https://api.example.com/v1",
          apiKey: "test-key",
          model: "gpt-test"
        }
      }
    }
  });

  const result = await api.translateSegments([
    { id: "a", text: "First segment", hash: "h1", kind: "heading" },
    { id: "b", text: "Second segment", hash: "h2", kind: "paragraph" }
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.translations, ["译文：First segment", "译文：Second segment"]);
  assert.deepEqual(result.results, [
    { id: "a", text: "译文：First segment", cacheHit: false },
    { id: "b", text: "译文：Second segment", cacheHit: false }
  ]);
  assert.equal(calls.length, 1);
});

test("translation cache is namespaced by provider, model, prompt, and target language", async () => {
  const { api, calls } = loadBackground({
    fetchContent: ({ calls }) => JSON.stringify([`译文 ${calls.length}`]),
    store: {
      sync: {
        toktraSettings: {
          enabled: true,
          apiBaseUrl: "https://api.example.com/v1",
          apiKey: "test-key",
          model: "gpt-a",
          targetLanguage: "zh-CN",
          promptVersion: "v1"
        }
      }
    }
  });

  assert.deepEqual((await api.translateTexts(["Same source"])).translations, ["译文 1"]);
  assert.deepEqual(
    (
      await api.translateTexts(["Same source"], {
        enabled: true,
        apiBaseUrl: "https://api.example.com/v1",
        apiKey: "test-key",
        model: "gpt-b",
        targetLanguage: "zh-CN",
        promptVersion: "v1",
        systemPrompt: api.DEFAULT_SETTINGS.systemPrompt
      })
    ).translations,
    ["译文 2"]
  );
  assert.deepEqual(
    (
      await api.translateTexts(["Same source"], {
        enabled: true,
        apiBaseUrl: "https://api.example.com/v1",
        apiKey: "test-key",
        model: "gpt-b",
        targetLanguage: "ja",
        promptVersion: "v1",
        systemPrompt: api.DEFAULT_SETTINGS.systemPrompt
      })
    ).translations,
    ["译文 3"]
  );
  assert.equal(calls.length, 3);
});

test("translateTexts merges cache writes from parallel translation batches", async () => {
  const { api, store } = loadBackground({
    fetchContent: ({ init }) => {
      const body = JSON.parse(init.body);
      const texts = JSON.parse(body.messages.at(-1).content);
      return JSON.stringify(texts.map((text) => `中文：${text}`));
    },
    store: {
      sync: {
        toktraSettings: {
          enabled: true,
          apiBaseUrl: "https://api.example.com/v1",
          apiKey: "test-key",
          model: "gpt-test"
        }
      }
    }
  });

  await Promise.all([api.translateTexts(["First paragraph"]), api.translateTexts(["Second paragraph"])]);

  assert.equal(Object.keys(store.local.toktraCache || {}).length, 2);
});

test("translateTexts can force a fresh API translation instead of using cached text", async () => {
  const { api, calls } = loadBackground({
    store: {
      sync: {
        toktraSettings: {
          enabled: true,
          apiBaseUrl: "https://api.example.com/v1",
          apiKey: "test-key",
          model: "gpt-test"
        }
      }
    }
  });

  await api.translateTexts(["Hello world", "Second paragraph"]);
  await api.translateTexts(["Hello world", "Second paragraph"], undefined, { forceRefresh: true });

  assert.equal(calls.length, 2);
});

test("analyzeDomainStructure stores an AI strategy for the current domain", async () => {
  const { api, calls } = loadBackground({
    fetchContent: JSON.stringify({
      contentSelectors: [".article-shell"],
      excludeSelectors: [".promo", ".comments"],
      minTextLength: 18
    }),
    store: {
      sync: {
        toktraSettings: {
          enabled: true,
          apiBaseUrl: "https://api.example.com/v1",
          apiKey: "test-key",
          model: "gpt-test"
        }
      }
    }
  });

  const result = await api.analyzeDomainStructure("example.com", {
    url: "https://example.com/post",
    title: "Example article",
    nodes: [{ selector: ".article-shell", tag: "section", textLength: 240 }],
    textSamples: ["This article contains enough text to translate."]
  });
  const cached = await api.getDomainStrategy("example.com");

  assert.equal(result.ok, true);
  assert.deepEqual(result.strategy.contentSelectors, [".article-shell"]);
  assert.deepEqual(result.strategy.excludeSelectors, [".promo", ".comments"]);
  assert.equal(result.strategy.minTextLength, 18);
  assert.deepEqual(cached.contentSelectors, [".article-shell"]);
  assert.equal(calls.length, 1);
  assert.match(JSON.parse(calls[0].init.body).messages.at(-1).content, /Example article/);
});
