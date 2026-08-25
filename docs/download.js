/* Handing a file to the browser. One place, because a page cannot learn where
 * the file lands -- the browser decides -- so every caller must say the same
 * thing about it, and every caller must revoke the object URL. */

export function download(filename, text, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([text], { type: mime });
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
