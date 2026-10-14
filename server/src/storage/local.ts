import fs from 'node:fs';
import path from 'node:path';
import archiver from 'archiver';
import AdmZip from 'adm-zip';

/** Recursively sum file sizes under a directory. */
export function dirSize(dir: string): number {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirSize(full);
    else total += fs.statSync(full).size;
  }
  return total;
}

/** Zip a directory recursively (including the images/ subfolder) into destZip.
 *  destZip MUST be outside `dir` to avoid the archive including itself. */
export function zipDir(dir: string, destZip: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destZip);
    const archive = archiver('zip', { zlib: { level: 9 } });
    output.on('close', () => resolve(destZip));
    archive.on('error', reject);
    archive.pipe(output);
    archive.directory(dir, false);
    archive.finalize();
  });
}

export function removeDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** Extract a zip into destDir with zip-slip protection (rejects entries escaping destDir). */
export function unzipToDir(zipPath: string, destDir: string): void {
  const zip = new AdmZip(zipPath);
  const root = path.resolve(destDir);
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;
    const name = entry.entryName.replace(/\\/g, '/');
    const target = path.resolve(root, name);
    if (target !== root && !target.startsWith(root + path.sep)) {
      throw new Error(`Unsafe zip entry rejected: ${entry.entryName}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.getData());
  }
}
