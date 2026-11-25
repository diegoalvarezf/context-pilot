import { describe, expect, it } from "vitest";
import { isIgnoredPath, looksMinified } from "../src/indexer/ignore.js";

describe("isIgnoredPath", () => {
  it.each([
    "APPs/x/assets/js/chart.min.js",
    "assets/chart.umd.min.js",
    "a/b/app.bundle.js",
    "a/style.min.css",
    "APPs/neftaliblanco.oest/_del_CMS_SUPERVISOR/index.php",
    "old/NMO_old/index.php",
    "a/historico/x.php",
    "includes/vendor/autoload.php",
    "includes/PHPMailer/src/SMTP.php",
  ])("ignora %s", (p) => expect(isIgnoredPath(p)).toBe(true));

  it.each(["includes/scheduled_tasks.php", "assets/js/app.js", "APPs/X/index.php", "src/oldest.ts"])("conserva %s", (p) =>
    expect(isIgnoredPath(p)).toBe(false),
  );

  it("amplía por proyecto con ignored_paths (nombre, prefijo y glob)", () => {
    const extra = ["tmp", "legacy/api", "*_backup"];
    expect(isIgnoredPath("a/tmp/x.php", { extra })).toBe(true);
    expect(isIgnoredPath("legacy/api/x.php", { extra })).toBe(true);
    expect(isIgnoredPath("legacy/other/x.php", { extra })).toBe(false);
    expect(isIgnoredPath("app_backup/x.php", { extra })).toBe(true);
  });
});

describe("looksMinified", () => {
  it("detecta JS grande con líneas larguísimas y no el código normal", () => {
    const min = "var a=1;".repeat(60_000);
    expect(looksMinified(min, min.length)).toBe(true);
    const normal = "function f() {\n  return 1;\n}\n".repeat(20_000);
    expect(looksMinified(normal, normal.length)).toBe(false);
  });
});
