/**
 * HTML to PDF with a headless browser on the server. The VPS has Google Chrome, other machines
 * may have Chromium: the first one found is used (PDF_BROWSER can name one).
 */
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const BROWSERS = [process.env.PDF_BROWSER, "chromium", "google-chrome", "google-chrome-stable", "chromium-browser"].filter((one): one is string => !!one);
let found: string | null = null;

export async function htmlToPdf(html: string): Promise<Buffer> {
  const directory = await mkdtemp(join(tmpdir(), "idea-stream-pdf-"));
  try {
    const htmlPath = join(directory, "page.html");
    const pdfPath = join(directory, "page.pdf");
    await writeFile(htmlPath, html);
    const args = ["--headless", "--no-sandbox", "--disable-gpu", "--print-to-pdf-no-header", "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`];
    let lastError: unknown = null;
    for (const browser of found ? [found] : BROWSERS) {
      try {
        await run(browser, args, { timeout: 90_000 });
        found = browser;
        return await readFile(pdfPath);
      } catch (error) {
        lastError = error;
        // Not installed: try the next one. Anything else is a real failure.
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    throw lastError ?? new Error("No browser for PDF");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
