import { readFileSync } from "fs";

/**
 * Reads the project's package.json and prints runtime and dependency versions.
 *
 * This function outputs:
 * - The currently running Bun runtime version.
 * - All dependency versions listed in package.json including:
 *   - dependencies
 *   - devDependencies
 *   - peerDependencies
 *
 * Intended for debugging, logging, or diagnostics so users can quickly
 * verify their runtime and installed package versions.
 *
 * @returns {void}
 */
export function PrintRuntimeVersions() {
  try {
    const pkg = JSON.parse(readFileSync("./package.json", "utf8"));

    console.log(`Bun Runtime: ${Bun.version}\n`);

    /**
     * Helper for printing dependency groups
     * @param {string} name - Section name in package.json
     * @param {Record<string, string>} deps - Dependency object
     */
    function printDeps(name, deps) {
      if (!deps) return;

      console.log(`${name}:`);
      for (const [pkg, version] of Object.entries(deps)) {
        console.log(`  ${pkg}: ${version}`);
      }
      console.log("");
    }

    printDeps("Dependencies", pkg.dependencies);
    printDeps("Dev Dependencies", pkg.devDependencies);
    printDeps("Peer Dependencies", pkg.peerDependencies);
  } catch (err) {
    console.error("Failed to read package.json for version output:", err);
  }
}

/**
 * Detects the operating system platform the runtime is currently running on.
 * Uses Node/Bun's `process.platform` value and normalizes it to a readable name.
 *
 * Supported platforms:
 * - linux
 * - macos
 * - windows
 * - freebsd
 * - openbsd
 * - unknown (fallback)
 *
 * @returns {"linux" | "macos" | "windows" | "freebsd" | "openbsd" | "unknown"}
 * A normalized platform string describing the current operating system.
 */
export function DetectPlatform() {
  switch (process.platform) {
    case "linux":
      return "linux";

    case "darwin":
      return "macos";

    case "win32":
      return "windows";

    case "freebsd":
      return "freebsd";

    case "openbsd":
      return "openbsd";

    default:
      return "unknown";
  }
}
