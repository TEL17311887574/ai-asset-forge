import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import worker from "../src/worker.js";

const config = await readFile(new URL("../config_default.toml", import.meta.url), "utf8");
const outbound = [];
const upstreamFetch = globalThis.fetch;
const assetBody = {
  "/config_default.toml": config,
  "/prompts/character_turnaround.txt": "角色三视图模板",
  "/prompts/scene_multiview.txt": "场景多视角模板",
};
const env = {
  ASSETS: {
    fetch(request) {
      const path = new URL(request.url).pathname;
      return Promise.resolve(new Response(assetBody[path] ?? "not found", {
        status: Object.hasOwn(assetBody, path) ? 200 : 404,
      }));
    },
  },
};

function request(path, body, contentType) {
  return new Request(`https://example.test${path}`, {
    method: "POST",
    headers: {
      Authorization: "Bearer test-not-real",
      "X-Upstream-Base-URL": "https://upstream.test/v1",
      ...(contentType ? { "Content-Type": contentType } : {}),
    },
    body,
  });
}

test.before(() => {
  globalThis.fetch = async (url, options) => {
    outbound.push({ url, options });
    return new Response(JSON.stringify({ data: [{ b64_json: "aW1hZ2U=" }] }), {
      headers: { "Content-Type": "application/json" },
    });
  };
});
test.after(() => { globalThis.fetch = upstreamFetch; });

test("文生图能读取配置并转发正确参数", async () => {
  const response = await worker.fetch(request("/api/generate", JSON.stringify({
    model: "gpt-image-2.5-flare", prompt: "测试提示词", size: "1024x1024", quality: "medium", n: 1,
  }), "application/json"), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).images[0].dataUrl, "data:image/png;base64,aW1hZ2U=");
  const { url, options } = outbound.at(-1);
  assert.equal(url, "https://upstream.test/v1/images/generations");
  assert.equal(JSON.parse(options.body).model, "gpt-image-2.5-flare");
  assert.equal(typeof options.signal, "object");
});

test("图生图读取配置，并将特殊模式模板拼入提示词", async () => {
  const form = new FormData();
  form.append("image", new File(["image"], "ref.png", { type: "image/png" }));
  form.append("mode", "characterTurnaround");
  form.append("prompt", "我的角色");
  form.append("model", "gpt-image-2");
  const response = await worker.fetch(request("/api/edit", form), env);
  assert.equal(response.status, 200);
  const { url, options } = outbound.at(-1);
  assert.equal(url, "https://upstream.test/v1/images/edits");
  assert.equal(options.body.get("prompt"), "我的角色\n\n角色三视图模板");
  assert.equal(options.body.get("model"), "gpt-image-2");
});

test("无效请求返回可读的 400，而不是内部错误", async () => {
  const response = await worker.fetch(request("/api/generate", JSON.stringify({ prompt: "  " }), "application/json"), env);
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /提示词不能为空/);
});
