import { open, rename, unlink } from 'fs/promises';
import { randomBytes } from 'crypto';

/**
 * Writes content to a file atomically by writing to a temporary file first
 * and then renaming it. The temporary file is flushed to disk before the
 * rename, so a crash cannot leave a truncated file under the target name.
 *
 * @param {string} filePath - The target file path
 * @param {string} content - The text to write (UTF-8)
 */
export async function writeFileAtomic(filePath, content) {
    const tempPath = `${filePath}.${randomBytes(4).toString('hex')}.tmp`;

    try {
        const handle = await open(tempPath, 'w');
        try {
            await handle.writeFile(content, 'utf8');
            await handle.sync();
        } finally {
            await handle.close();
        }
        await rename(tempPath, filePath);
    } catch (error) {
        // Cleanup temp file if it was created and rename failed
        try {
            await unlink(tempPath);
        } catch {
            // Ignore unlink errors
        }
        throw error;
    }
}

/**
 * Serializes data as indented JSON and writes it with writeFileAtomic.
 *
 * @param {string} filePath - The target file path
 * @param {unknown} data - The JSON-serializable value to write
 */
export async function writeJsonAtomic(filePath, data) {
    await writeFileAtomic(filePath, JSON.stringify(data, null, 2));
}
