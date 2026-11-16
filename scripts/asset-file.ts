/** Byte helpers shared by the asset-refresh scripts. */

/** Whether two byte arrays hold exactly the same bytes. */
export function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index++) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

/** Read an existing asset, or null when it has not been vendored yet. */
export async function readExistingAsset(path: string): Promise<Uint8Array | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    return null;
  }
  return new Uint8Array(await file.arrayBuffer());
}
