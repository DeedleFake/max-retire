#!/usr/bin/env node
// Drive Maximize My Retirement the way a user does.
// Usage: node scripts/verify-retirement.mjs <doctor|launch|cleanup|drive> [feature]
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const root = "/workspace";
const url = "http://127.0.0.1:8080/";
const evidenceRoot = join(root, "artifacts/verify-retirement");
const runDir = join(evidenceRoot, "run");
const pidFile = join(runDir, "server.pid");

const feature = process.argv[3] ?? "";
const command = process.argv[2] ?? "";

function evidenceDir(name) {
  const dir = join(evidenceRoot, name);
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function pageReady(page) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
  if (!response || response.status() >= 400) throw new Error(`GET ${url} returned ${response?.status() ?? "no response"}`);
  await page.getByTestId("text-app-title").waitFor({ timeout: 20000 });
  const title = (await page.getByTestId("text-app-title").innerText()).trim();
  if (title !== "Maximize My Retirement") throw new Error(`title was ${JSON.stringify(title)}`);
  await page.getByTestId("row-summary-2026").waitFor({ timeout: 20000 });
}

async function withPage(fn) {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await pageReady(page);
    return await fn(page);
  } finally {
    await browser.close();
  }
}

function firstSummaryYear(page) {
  return page.locator("[data-testid^='row-summary-']").first().getAttribute("data-testid").then((id) => {
    const year = id?.replace("row-summary-", "");
    if (!year) throw new Error("no summary row");
    return year;
  });
}

async function doctor() {
  mkdirSync(evidenceRoot, { recursive: true });
  const report = { ok: false, url, ownedByThisRun: existsSync(pidFile), title: null, error: null };
  try {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await pageReady(page);
      report.title = (await page.getByTestId("text-app-title").innerText()).trim();
      report.ok = true;
    } finally {
      await browser.close();
    }
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
  }
  writeFileSync(join(evidenceRoot, "doctor.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report));
  process.exit(report.ok ? 0 : 1);
}

function launch() {
  if (existsSync(pidFile)) {
    console.log(JSON.stringify({ ok: true, alreadyStartedByThisRun: true, pid: Number(readFileSync(pidFile, "utf8")) }));
    return;
  }
  mkdirSync(runDir, { recursive: true });
  const child = spawn("npm", ["run", "dev"], {
    cwd: root,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  writeFileSync(pidFile, String(child.pid));
  console.log(JSON.stringify({ ok: true, pid: child.pid, pidFile }));
}

function cleanup() {
  if (existsSync(pidFile)) {
    const pid = Number(readFileSync(pidFile, "utf8"));
    try {
      process.kill(pid, "SIGTERM");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  }
  rmSync(runDir, { recursive: true, force: true });
  console.log(JSON.stringify({ ok: true, removed: runDir, evidenceKept: evidenceRoot }));
}

async function driveBalance(page) {
  const dir = evidenceDir("balance");
  const year = await firstSummaryYear(page);
  const cell = page.getByTestId(`text-spendable-${year}`);
  const before = (await cell.innerText()).trim();
  writeFileSync(join(dir, "before.txt"), before + "\n");
  await page.getByTestId("tab-taxable").click();
  const input = page.getByTestId("input-taxable-balance");
  await input.click();
  await input.fill("500000");
  await input.press("Tab");
  await page.waitForFunction(
    ([testId, previous]) => document.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() !== previous,
    [`text-spendable-${year}`, before],
    { timeout: 10000 },
  );
  const after = (await cell.innerText()).trim();
  writeFileSync(join(dir, "after.txt"), after + "\n");
  await page.screenshot({ path: join(dir, "page.png"), fullPage: true });
  const entered = await page.getByTestId("input-taxable-balance").inputValue();
  writeFileSync(join(dir, "action.json"), JSON.stringify({ year, before, after, entered, feature: "balance" }, null, 2));
  if (before === after) throw new Error(`spendable for ${year} did not change`);
  console.log(JSON.stringify({ ok: true, feature: "balance", year, before, after, evidence: dir }));
}

async function driveAgi(page) {
  const dir = evidenceDir("agi");
  const year = await firstSummaryYear(page);
  const later = String(Number(year) + 1);
  await page.getByTestId("input-agi").click();
  await page.getByTestId("input-agi").fill("300000");
  await page.getByTestId("input-agi").press("Tab");
  const firstBefore = (await page.getByTestId(`text-agi-${year}`).innerText()).trim();
  const laterBefore = (await page.getByTestId(`text-agi-${later}`).innerText()).trim();
  await page.getByTestId("checkbox-agi-first-year").click();
  await page.waitForFunction(
    ([testId, previous]) => document.querySelector(`[data-testid="${testId}"]`)?.textContent?.trim() !== previous,
    [`text-agi-${later}`, laterBefore],
    { timeout: 10000 },
  );
  const firstAfter = (await page.getByTestId(`text-agi-${year}`).innerText()).trim();
  const laterAfter = (await page.getByTestId(`text-agi-${later}`).innerText()).trim();
  await page.screenshot({ path: join(dir, "page.png"), fullPage: true });
  writeFileSync(
    join(dir, "action.json"),
    JSON.stringify({ year, later, firstBefore, laterBefore, firstAfter, laterAfter, feature: "agi" }, null, 2),
  );
  if (firstAfter !== firstBefore) throw new Error("checking Only the first year changed the first year AGI");
  if (laterAfter === laterBefore) throw new Error("checking Only the first year did not change the next year AGI");
  console.log(JSON.stringify({ ok: true, feature: "agi", evidence: dir }));
}

async function driveSaveLoad(page) {
  const dir = evidenceDir("save-load");
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("button-save-plan").click();
  const download = await downloadPromise;
  const savedPath = join(dir, "retirement-plan.json");
  await download.saveAs(savedPath);
  const saved = readFileSync(savedPath, "utf8");
  if (!saved.includes("birthYear")) throw new Error("saved plan did not contain birthYear");
  await page.getByTestId("input-load-plan").setInputFiles(savedPath);
  await page.getByTestId("text-plan-transfer-status").waitFor({ timeout: 10000 });
  const status = (await page.getByTestId("text-plan-transfer-status").innerText()).trim();
  await page.screenshot({ path: join(dir, "page.png"), fullPage: true });
  writeFileSync(join(dir, "action.json"), JSON.stringify({ status, bytes: saved.length, feature: "save-load" }, null, 2));
  if (!status.startsWith("Loaded from")) throw new Error(`load status was ${JSON.stringify(status)}`);
  console.log(JSON.stringify({ ok: true, feature: "save-load", status, evidence: dir }));
}

async function driveGuide(page) {
  const dir = evidenceDir("guide");
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("link-user-guide").click();
  const download = await downloadPromise;
  const pdfPath = join(dir, "guide.pdf");
  await download.saveAs(pdfPath);
  const bytes = readFileSync(pdfPath);
  await page.screenshot({ path: join(dir, "page.png"), fullPage: false });
  writeFileSync(join(dir, "action.json"), JSON.stringify({ bytes: bytes.length, feature: "guide" }, null, 2));
  if (bytes.length < 1000 || bytes.subarray(0, 4).toString() !== "%PDF") throw new Error("Guide did not download a PDF");
  console.log(JSON.stringify({ ok: true, feature: "guide", bytes: bytes.length, evidence: dir }));
}

const drives = {
  balance: driveBalance,
  agi: driveAgi,
  "save-load": driveSaveLoad,
  guide: driveGuide,
};

async function main() {
  if (command === "doctor") return doctor();
  if (command === "launch") return launch();
  if (command === "cleanup") return cleanup();
  if (command === "drive") {
    const drive = drives[feature];
    if (!drive) {
      console.error(`unknown feature ${JSON.stringify(feature)}. Use ${Object.keys(drives).join(", ")}`);
      process.exit(2);
    }
    await withPage(drive);
    return;
  }
  console.error("usage: node scripts/verify-retirement.mjs <doctor|launch|cleanup|drive> [feature]");
  process.exit(2);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
