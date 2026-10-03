/* Handing a file to the browser. One place, because a page cannot learn where
 * the file lands -- the browser decides -- so every caller must say the same
 * thing about it, and every caller must revoke the object URL. */

export function download(filename, text, mime = "text/plain;charset=utf-8") {
  const blob = text instanceof Blob ? text : new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}

/* Several files at once: the system share sheet where there is one that
 * takes files -- on an iPad that is where "Save to Files" and AirDrop live,
 * and a download would land somewhere the player cannot easily find -- and a
 * download of each otherwise. Resolves to "shared", "downloaded" or
 * "cancelled". `files` is [{name, blob}]. */
export async function shareOrDownload(files, title = "") {
  const asFiles = typeof File === "function"
    ? files.map(({ name, blob }) => new File([blob], name, { type: blob.type })) : [];
  if (asFiles.length && typeof navigator !== "undefined" && navigator.canShare?.({ files: asFiles })) {
    try {
      await navigator.share({ files: asFiles, title });
      return "shared";
    } catch (err) {
      if (err?.name === "AbortError") return "cancelled";
      // Anything else: fall through to a plain download.
    }
  }
  for (const { name, blob } of files) download(name, blob);
  return "downloaded";
}
