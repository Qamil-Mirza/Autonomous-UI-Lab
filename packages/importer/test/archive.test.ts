import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { validateProject } from "../src/archive";
import { ImportError } from "../src/errors";
import { DEFAULT_ZIP_LIMITS, readZip, safeRelativePath } from "../src/zip";
import { makeExport, writeZip } from "./support/zip-writer";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof ImportError) return err.code;
    throw err;
  }
  return undefined;
}

describe("readZip", () => {
  it("reads stored and deflated entries", () => {
    const zip = writeZip([
      { name: "a.txt", data: "hello", method: 0 },
      { name: "dir/", data: "" },
      { name: "dir/b.txt", data: "x".repeat(1000) },
    ]);
    const files = readZip(zip);
    expect(files.map((f) => f.path)).toEqual(["a.txt", "dir/b.txt"]);
    expect(files[1]!.data.toString()).toBe("x".repeat(1000));
  });

  it.each([
    ["../evil.txt"],
    ["a/../../evil.txt"],
    ["/etc/passwd"],
    ["C:/windows/x"],
    ["a\\b.txt"],
    ["a//b.txt"],
    ["./a.txt"],
    ["a\u0000b"],
  ])("rejects the unsafe path %j", (name) => {
    expect(codeOf(() => readZip(writeZip([{ name, data: "x" }])))).toBe("ARCHIVE_UNSAFE_PATH");
  });

  it("rejects symlinks, even ones pointing inside the archive", () => {
    expect(codeOf(() => readZip(writeZip([{ name: "link", data: "../../etc/passwd", unixMode: 0o120777 }])))).toBe("ARCHIVE_SYMLINK");
    expect(codeOf(() => readZip(writeZip([{ name: "link", data: "src/App.tsx", unixMode: 0o120777 }])))).toBe("ARCHIVE_SYMLINK");
  });

  it("accepts regular files made on Unix", () => {
    expect(readZip(writeZip([{ name: "a.txt", data: "x", unixMode: 0o100644 }]))).toHaveLength(1);
  });

  it("rejects malformed archives", () => {
    expect(codeOf(() => readZip(Buffer.from("not a zip at all, just text")))).toBe("ARCHIVE_MALFORMED");
    const good = writeZip([{ name: "a.txt", data: "hello" }]);
    expect(codeOf(() => readZip(good.subarray(0, good.length - 30)))).toBe("ARCHIVE_MALFORMED");
    expect(codeOf(() => readZip(writeZip([{ name: "a.txt", data: "hello", declaredCrc: 1234 }])))).toBe("ARCHIVE_MALFORMED");
  });

  it("never inflates past the declared size (bomb with a lying header)", () => {
    const bomb = writeZip([{ name: "bomb.txt", data: Buffer.alloc(5_000_000), declaredSize: 100 }]);
    expect(codeOf(() => readZip(bomb))).toBe("ARCHIVE_MALFORMED");
  });

  it("enforces size and count limits", () => {
    const limits = { ...DEFAULT_ZIP_LIMITS, maxArchiveBytes: 1000, maxEntries: 3, maxFileBytes: 100, maxTotalBytes: 150 };
    expect(codeOf(() => readZip(Buffer.alloc(2000), limits))).toBe("ARCHIVE_TOO_LARGE");
    expect(codeOf(() => readZip(writeZip(["a", "b", "c", "d"].map((name) => ({ name, data: "x" }))), limits))).toBe("ARCHIVE_TOO_MANY_FILES");
    expect(codeOf(() => readZip(writeZip([{ name: "big", data: "x".repeat(101) }]), limits))).toBe("ARCHIVE_TOO_LARGE_EXTRACTED");
    expect(codeOf(() => readZip(writeZip([{ name: "a", data: "x".repeat(80) }, { name: "b", data: "x".repeat(80) }]), limits))).toBe("ARCHIVE_TOO_LARGE_EXTRACTED");
  });

  it("rejects duplicate and case-colliding names", () => {
    expect(codeOf(() => readZip(writeZip([{ name: "a.ts", data: "1" }, { name: "A.ts", data: "2" }])))).toBe("ARCHIVE_DUPLICATE_PATH");
    expect(codeOf(() => readZip(writeZip([{ name: "a", data: "1" }, { name: "a/b", data: "2" }])))).toBe("ARCHIVE_DUPLICATE_PATH");
  });

  it("rejects encryption and unknown compression", () => {
    expect(codeOf(() => readZip(writeZip([{ name: "a", data: "1", encrypted: true }])))).toBe("ARCHIVE_UNSUPPORTED");
    const zip = writeZip([{ name: "a", data: "1", method: 0 }]);
    // Patch method in both headers to 12 (bzip2).
    zip.writeUInt16LE(12, 8);
    const cd = zip.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    zip.writeUInt16LE(12, cd + 10);
    expect(codeOf(() => readZip(zip))).toBe("ARCHIVE_UNSUPPORTED");
  });

  it("rejects overlapping entries", () => {
    const data = deflateRawSync(Buffer.from("same"));
    const zip = writeZip([{ name: "a", data: "same" }, { name: "b", data: "same" }]);
    const cd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    zip.writeUInt32LE(0, cd + 42); // second entry points at the first entry's data
    expect(data.length).toBeGreaterThan(0);
    expect(codeOf(() => readZip(zip))).toBe("ARCHIVE_MALFORMED");
  });

  it("safeRelativePath keeps ordinary nested paths", () => {
    expect(safeRelativePath("src/components/Cart.tsx")).toBe("src/components/Cart.tsx");
  });
});

describe("validateProject", () => {
  it("accepts a Make-style export at the archive root", () => {
    const { files, report } = validateProject(makeExport());
    expect(report.appRoot).toBe("");
    expect(report.wrapper).toBeUndefined();
    expect(report.viteConfig).toBe("vite.config.ts");
    expect(files.map((f) => f.path)).toContain("src/App.tsx");
  });

  it("strips a single wrapper directory and OS clutter", () => {
    const zip = makeExport({
      wrapper: "My Make App",
      extra: [{ name: ".DS_Store", data: "junk" }, { name: "src/.DS_Store", data: "junk" }],
      outside: [{ name: "__MACOSX/My Make App/._App.tsx", data: "junk" }],
    });
    const { files, report } = validateProject(zip);
    expect(report.wrapper).toBe("My Make App");
    expect(report.skipped.junk).toBe(3);
    expect(files.every((f) => !f.path.includes(".DS_Store"))).toBe(true);
    expect(files.map((f) => f.path)).toContain("package.json");
  });

  it("drops node_modules and .git from the upload", () => {
    const { files, report } = validateProject(makeExport({ extra: [{ name: "node_modules/evil/index.js", data: "x" }, { name: ".git/config", data: "x" }] }));
    expect(files.some((f) => f.path.startsWith("node_modules"))).toBe(false);
    expect(report.skipped.generated).toBe(2);
  });

  it("finds a nested app root", () => {
    const zip = makeExport({ wrapper: "export/project" });
    expect(validateProject(zip).report.appRoot).toBe("project");
  });

  it("explains unsupported or incomplete projects", () => {
    expect(codeOf(() => validateProject(makeExport({ omit: ["vite.config.ts"] })))).toBe("MISSING_VITE_CONFIG");
    expect(codeOf(() => validateProject(makeExport({ omit: ["index.html"] })))).toBe("MISSING_INDEX_HTML");
    expect(codeOf(() => validateProject(writeZip([{ name: "README.md", data: "hi" }])))).toBe("NO_APP_ROOT");
    expect(codeOf(() => validateProject(makeExport({ pkg: { dependencies: { next: "15", react: "19", "react-dom": "19" } } })))).toBe("UNSUPPORTED_FRAMEWORK");
    expect(codeOf(() => validateProject(makeExport({ pkg: { dependencies: { vue: "3" }, devDependencies: { vite: "6" } } })))).toBe("UNSUPPORTED_FRAMEWORK");
    expect(codeOf(() => validateProject(makeExport({ pkg: { dependencies: { react: "19", "react-dom": "19" } } })))).toBe("UNSUPPORTED_FRAMEWORK");
    expect(codeOf(() => validateProject(makeExport({ extra: [], pkg: "nope" as unknown as object })))).toBe("INVALID_PACKAGE_JSON");
  });

  it("refuses an archive holding two apps", () => {
    const a = makeExport({ wrapper: "one" });
    const one = readZip(a).map((f) => ({ name: f.path, data: f.data }));
    const zip = writeZip([...one, ...one.map((f) => ({ ...f, name: f.name.replace(/^one\//, "two/") }))]);
    expect(codeOf(() => validateProject(zip))).toBe("AMBIGUOUS_APP_ROOT");
  });
});
