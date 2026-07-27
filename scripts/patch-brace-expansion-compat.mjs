import { access, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootNodeModules = path.join(projectRoot, "node_modules");

const replacements = [
  {
    before: "var expand = require('brace-expansion')",
    after:
      "var braceExpansion = require('brace-expansion')\n" +
      "var expand = braceExpansion.expand || braceExpansion",
  },
  {
    before: "const expand = require('brace-expansion')",
    after:
      "const braceExpansion = require('brace-expansion')\n" +
      "const expand = braceExpansion.expand || braceExpansion",
  },
];

let patchedCount = 0;

async function exists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function patchMinimatch(packageDir) {
  const packageJsonPath = path.join(packageDir, "package.json");
  const sourcePath = path.join(packageDir, "minimatch.js");

  if (!(await exists(packageJsonPath)) || !(await exists(sourcePath))) return;

  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const major = Number.parseInt(String(packageJson.version).split(".")[0], 10);

  if (!Number.isFinite(major) || major > 5) return;

  let source = await readFile(sourcePath, "utf8");
  if (source.includes("braceExpansion.expand || braceExpansion")) return;

  for (const replacement of replacements) {
    if (!source.includes(replacement.before)) continue;
    source = source.replace(replacement.before, replacement.after);
    await writeFile(sourcePath, source);
    patchedCount += 1;
    return;
  }

  throw new Error(
    `Không thể áp dụng tương thích brace-expansion cho minimatch ${packageJson.version}`,
  );
}

async function scanPackage(packageDir, packageName) {
  if (packageName === "minimatch") {
    await patchMinimatch(packageDir);
  }

  const nestedNodeModules = path.join(packageDir, "node_modules");
  if (await exists(nestedNodeModules)) {
    await scanNodeModules(nestedNodeModules);
  }
}

async function scanNodeModules(nodeModulesDir) {
  const entries = await readdir(nodeModulesDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    if (entry.name.startsWith("@")) {
      const scopeDir = path.join(nodeModulesDir, entry.name);
      const scopedPackages = await readdir(scopeDir, { withFileTypes: true });
      for (const scopedPackage of scopedPackages) {
        if (!scopedPackage.isDirectory()) continue;
        await scanPackage(path.join(scopeDir, scopedPackage.name), scopedPackage.name);
      }
      continue;
    }

    await scanPackage(path.join(nodeModulesDir, entry.name), entry.name);
  }
}

if (await exists(rootNodeModules)) {
  await scanNodeModules(rootNodeModules);
  console.log(
    `Đã áp dụng tương thích brace-expansion cho ${patchedCount} gói minimatch.`,
  );
} else {
  console.log("Không có node_modules; bỏ qua bước tương thích brace-expansion.");
}
