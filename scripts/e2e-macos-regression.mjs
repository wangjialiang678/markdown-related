#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";
const WEBDRIVER_ORIGIN = "http://127.0.0.1:4445";

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitUntil(check, timeoutMs, intervalMs, label) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await check()) {
      return;
    }
    await sleep(intervalMs);
  }
  throw new Error(`Timeout waiting for ${label} (${timeoutMs} ms)`);
}

function extractWebDriverError(value) {
  if (!value || typeof value !== "object") {
    return "unknown webdriver error";
  }
  const parts = [];
  if (typeof value.error === "string") {
    parts.push(value.error);
  }
  if (typeof value.message === "string") {
    parts.push(value.message);
  }
  if (parts.length === 0) {
    return JSON.stringify(value);
  }
  return parts.join(": ");
}

async function webdriverRequest(endpoint, { method = "GET", body } = {}) {
  const response = await fetch(`${WEBDRIVER_ORIGIN}${endpoint}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${extractWebDriverError(payload?.value)}`);
  }
  if (payload?.value?.error) {
    throw new Error(extractWebDriverError(payload.value));
  }
  return payload;
}

function elementIdFromPayload(payload) {
  const value = payload?.value;
  if (value && typeof value === "object" && value[ELEMENT_KEY]) {
    return value[ELEMENT_KEY];
  }
  throw new Error(`Cannot parse element id from payload: ${JSON.stringify(payload)}`);
}

async function createSession() {
  const payload = await webdriverRequest("/session", {
    method: "POST",
    body: {
      capabilities: {
        alwaysMatch: {},
        firstMatch: [{}],
      },
    },
  });

  const sessionId = payload?.value?.sessionId ?? payload?.sessionId;
  if (!sessionId) {
    throw new Error(`Cannot parse session id from payload: ${JSON.stringify(payload)}`);
  }
  return sessionId;
}

async function deleteSession(sessionId) {
  await webdriverRequest(`/session/${sessionId}`, { method: "DELETE" });
}

async function findElement(sessionId, selector) {
  const payload = await webdriverRequest(`/session/${sessionId}/element`, {
    method: "POST",
    body: { using: "css selector", value: selector },
  });
  return elementIdFromPayload(payload);
}

async function clickElement(sessionId, selector) {
  const id = await findElement(sessionId, selector);
  await webdriverRequest(`/session/${sessionId}/element/${id}/click`, { method: "POST", body: {} });
}

async function executeScript(sessionId, script, args = []) {
  const payload = await webdriverRequest(`/session/${sessionId}/execute/sync`, {
    method: "POST",
    body: { script, args },
  });
  return payload?.value;
}

async function saveSessionScreenshot(sessionId, screenshotPath) {
  const payload = await webdriverRequest(`/session/${sessionId}/screenshot`);
  const base64 = String(payload?.value ?? "");
  const data = Buffer.from(base64, "base64");
  await fs.writeFile(screenshotPath, data);
}

function terminateProcess(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once("exit", () => resolve());
    child.kill("SIGTERM");
    setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
    }, 1500);
  });
}

async function bodyTextIncludes(sessionId, marker) {
  const value = await executeScript(
    sessionId,
    "return document.body ? document.body.innerText : '';"
  );
  return String(value || "").includes(marker);
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(scriptDir, "..");
  const binaryPath = path.join(rootDir, "src-tauri", "target", "debug", "tauri-app");

  if (!existsSync(binaryPath)) {
    throw new Error(
      `Cannot find debug binary: ${binaryPath}\nRun "npm run test:e2e:mac" (or "npm run tauri:build:debug:webdriver") first.`
    );
  }

  const outDir = path.join(rootDir, "artifacts", "e2e-macos", nowStamp());
  await fs.mkdir(outDir, { recursive: true });

  const firstMarkdown = path.join(outDir, "e2e_case.md");
  const secondMarkdown = path.join(outDir, "second.md");
  const reportPath = path.join(outDir, "result.json");

  await fs.writeFile(
    firstMarkdown,
    [
      "# Minimal E2E",
      "",
      "This is first page marker.",
      "",
      "[Go second](./second.md)",
      "",
    ].join("\n")
  );

  await fs.writeFile(
    secondMarkdown,
    [
      "# Second Page",
      "",
      "Second page marker.",
      "",
      "[Back](./e2e_case.md)",
      "",
    ].join("\n")
  );

  spawnSync("pkill", ["-f", "/src-tauri/target/debug/tauri-app"], {
    stdio: "ignore",
  });

  const appProcess = spawn(binaryPath, [firstMarkdown], {
    cwd: rootDir,
    env: {
      ...process.env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let sessionId = null;
  try {
    await waitUntil(
      async () => {
        try {
          await webdriverRequest("/status");
          return true;
        } catch {
          return false;
        }
      },
      20000,
      200,
      "webdriver server on 127.0.0.1:4445"
    );

    sessionId = await createSession();

    await waitUntil(
      async () => await bodyTextIncludes(sessionId, "This is first page marker."),
      12000,
      250,
      "first markdown rendered"
    );

    const firstMarkerVisibleBeforeNav = await bodyTextIncludes(sessionId, "This is first page marker.");

    await saveSessionScreenshot(sessionId, path.join(outDir, "01-first-page.png"));

    await clickElement(sessionId, "a[data-markdown-path]");

    await waitUntil(
      async () => await bodyTextIncludes(sessionId, "Second page marker."),
      12000,
      250,
      "second markdown rendered"
    );

    await saveSessionScreenshot(sessionId, path.join(outDir, "02-second-page.png"));

    const report = {
      ok: true,
      generated_at: new Date().toISOString(),
      webdriver_origin: WEBDRIVER_ORIGIN,
      binary_path: binaryPath,
      first_markdown: firstMarkdown,
      second_markdown: secondMarkdown,
      first_marker_visible_before_navigation: firstMarkerVisibleBeforeNav,
      second_marker_visible: await bodyTextIncludes(sessionId, "Second page marker."),
      screenshots: [
        "01-first-page.png",
        "02-second-page.png",
      ].map((name) => path.join(outDir, name)),
    };

    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

    console.log(`E2E regression passed. Artifacts: ${outDir}`);
  } finally {
    if (sessionId) {
      try {
        await deleteSession(sessionId);
      } catch {
        // ignore session cleanup errors
      }
    }
    await terminateProcess(appProcess);
  }
}

main().catch((error) => {
  console.error(`E2E regression failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
