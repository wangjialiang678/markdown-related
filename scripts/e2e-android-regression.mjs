#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ID = "com.michael.markdownviewer";
const MAIN_ACTIVITY = `${PACKAGE_ID}/.MainActivity`;
const DEFAULT_APK_PATH =
  "src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk";
const DEFAULT_AVD = "Medium_Phone_API_36.1";
const BOOT_TIMEOUT_MS = 240_000;

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function runAndCapture(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutBuffers = [];
    const stderrBuffers = [];
    child.stdout.on("data", (chunk) => {
      stdoutBuffers.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBuffers.push(chunk);
    });

    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      const stdoutBuffer = Buffer.concat(stdoutBuffers);
      const stderrBuffer = Buffer.concat(stderrBuffers);
      const stdout = options.rawStdout ? stdoutBuffer : stdoutBuffer.toString("utf8");
      const stderr = stderrBuffer.toString("utf8");
      if (code === 0 || options.allowFailure) {
        resolve({ code: code ?? 0, stdout, stderr });
      } else {
        reject(
          new Error(
            `Command failed: ${command} ${args.join(" ")}\nexit=${code}\nstdout:\n${stdout}\nstderr:\n${stderr}`
          )
        );
      }
    });
  });
}

function ensureBinary(name, fallback = null) {
  const found = spawnSync("which", [name], { encoding: "utf8" });
  if (found.status === 0) {
    return found.stdout.trim();
  }
  if (fallback && existsSync(fallback)) {
    return fallback;
  }
  throw new Error(`Cannot find required binary: ${name}`);
}

async function listDevices(adbPath) {
  const { stdout } = await runAndCapture(adbPath, ["devices"]);
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("List of devices"))
    .map((line) => line.split(/\s+/))
    .filter((parts) => parts.length >= 2 && parts[1] === "device")
    .map((parts) => parts[0]);
}

function pickDevice(devices) {
  const emulator = devices.find((id) => id.startsWith("emulator-"));
  return emulator ?? devices[0] ?? null;
}

async function waitForBoot(adbPath, serial, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const { stdout } = await runAndCapture(adbPath, ["-s", serial, "shell", "getprop", "sys.boot_completed"]);
      if (stdout.trim() === "1") {
        return;
      }
    } catch {
      // device not ready yet
    }
    await sleep(1500);
  }
  throw new Error(`Timeout waiting for Android boot completion on ${serial}`);
}

async function maybeStartEmulator(adbPath, emulatorPath, avdName) {
  const devices = await listDevices(adbPath);
  const existing = pickDevice(devices);
  if (existing) {
    return { serial: existing, startedByScript: false };
  }

  const launch = spawn(
    emulatorPath,
    [
      "-avd",
      avdName,
      "-no-window",
      "-no-audio",
      "-no-boot-anim",
      "-gpu",
      "swiftshader_indirect",
    ],
    {
      stdio: "ignore",
      detached: true,
      env: process.env,
    }
  );
  launch.unref();

  const start = Date.now();
  while (Date.now() - start < BOOT_TIMEOUT_MS) {
    const nextDevices = await listDevices(adbPath);
    const serial = pickDevice(nextDevices);
    if (serial) {
      await waitForBoot(adbPath, serial, BOOT_TIMEOUT_MS);
      return { serial, startedByScript: true };
    }
    await sleep(1500);
  }

  throw new Error(`Cannot start emulator "${avdName}" within ${BOOT_TIMEOUT_MS} ms`);
}

async function adb(adbPath, serial, args, options = {}) {
  const fullArgs = serial ? ["-s", serial, ...args] : args;
  return runAndCapture(adbPath, fullArgs, options);
}

async function main() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const rootDir = path.resolve(scriptDir, "..");
  const apkPath = path.resolve(rootDir, DEFAULT_APK_PATH);
  const outDir = path.join(rootDir, "artifacts", "e2e-android", nowStamp());
  await fs.mkdir(outDir, { recursive: true });

  if (!existsSync(apkPath)) {
    throw new Error(`Cannot find debug APK: ${apkPath}\nRun "npm run android:build:apk:debug" first.`);
  }

  const adbPath = ensureBinary("adb", path.join(os.homedir(), "Library/Android/sdk/platform-tools/adb"));
  const emulatorPath = ensureBinary(
    "emulator",
    path.join(os.homedir(), "Library/Android/sdk/emulator/emulator")
  );
  const avdName = process.env.ANDROID_E2E_AVD || DEFAULT_AVD;

  const e2eMarker = `ANDROID_E2E_${Date.now()}`;
  const localMarkdown = path.join(outDir, "e2e_case.md");
  await fs.writeFile(
    localMarkdown,
    [
      "# Android Minimal E2E",
      "",
      `marker: ${e2eMarker}`,
      "",
      "This verifies open-with intent on Android.",
      "",
    ].join("\n"),
    "utf8"
  );

  let serial = null;
  let startedByScript = false;
  try {
    const emulatorState = await maybeStartEmulator(adbPath, emulatorPath, avdName);
    serial = emulatorState.serial;
    startedByScript = emulatorState.startedByScript;

    await adb(adbPath, serial, ["wait-for-device"]);
    await adb(adbPath, serial, ["install", "-r", apkPath]);
    await adb(adbPath, serial, ["shell", "am", "force-stop", PACKAGE_ID], { allowFailure: true });
    await adb(adbPath, serial, ["logcat", "-c"], { allowFailure: true });

    const deviceMarkdown = "/sdcard/Download/e2e_case.md";
    await adb(adbPath, serial, ["push", localMarkdown, deviceMarkdown]);

    const startOutput = await adb(adbPath, serial, [
      "shell",
      "am",
      "start",
      "-W",
      "-n",
      MAIN_ACTIVITY,
      "-a",
      "android.intent.action.VIEW",
      "-d",
      `file://${deviceMarkdown}`,
      "-t",
      "text/markdown",
    ]);
    await fs.writeFile(path.join(outDir, "am-start.txt"), `${startOutput.stdout}\n${startOutput.stderr}`, "utf8");

    await sleep(5000);

    const logcat = await adb(adbPath, serial, ["logcat", "-d"]);
    const logcatPath = path.join(outDir, "logcat.txt");
    await fs.writeFile(logcatPath, logcat.stdout, "utf8");

    const top = await adb(adbPath, serial, ["shell", "dumpsys", "activity", "top"], { allowFailure: true });
    const topPath = path.join(outDir, "activity-top.txt");
    await fs.writeFile(topPath, `${top.stdout}\n${top.stderr}`, "utf8");

    const screenshotPath = path.join(outDir, "screen.png");
    const screencap = await adb(adbPath, serial, ["exec-out", "screencap", "-p"], { rawStdout: true });
    await fs.writeFile(screenshotPath, screencap.stdout);

    const dumpPath = "/sdcard/Download/window_dump.xml";
    await adb(adbPath, serial, ["shell", "uiautomator", "dump", dumpPath], { allowFailure: true });
    const uiDump = await adb(adbPath, serial, ["shell", "cat", dumpPath], { allowFailure: true });
    await fs.writeFile(path.join(outDir, "window_dump.xml"), uiDump.stdout, "utf8");

    const hasIntentLog = logcat.stdout.includes("Intent markdown cached:");
    const hasOpenOkLog = logcat.stdout.includes("MD_VIEWER_OPEN_OK");
    const hasFileTitle = top.stdout.includes("e2e_case.md - Markdown Related");
    const startFailed = /Error: Activity not started, unable to resolve Intent/i.test(
      `${startOutput.stdout}\n${startOutput.stderr}`
    );

    const report = {
      ok: !startFailed && hasIntentLog && (hasOpenOkLog || hasFileTitle),
      generated_at: new Date().toISOString(),
      serial,
      avd_name: avdName,
      apk_path: apkPath,
      local_markdown: localMarkdown,
      device_markdown: deviceMarkdown,
      checks: {
        has_intent_log: hasIntentLog,
        has_open_ok_log: hasOpenOkLog,
        has_file_title: hasFileTitle,
        start_failed: startFailed,
      },
      artifacts: {
        out_dir: outDir,
        start_output: path.join(outDir, "am-start.txt"),
        logcat: logcatPath,
        activity_top: topPath,
        screenshot: screenshotPath,
        window_dump: path.join(outDir, "window_dump.xml"),
      },
    };

    await fs.writeFile(path.join(outDir, "result.json"), JSON.stringify(report, null, 2), "utf8");

    if (!report.ok) {
      throw new Error(
        `Android E2E failed. Checks: ${JSON.stringify(report.checks)}. See artifacts: ${outDir}`
      );
    }

    console.log(`Android E2E passed. Artifacts: ${outDir}`);
  } finally {
    if (serial && startedByScript) {
      await adb(adbPath, serial, ["emu", "kill"], { allowFailure: true });
    }
  }
}

main().catch((error) => {
  console.error(`Android E2E failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
