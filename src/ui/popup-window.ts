/**
 * Open a site page in the small window the native popups use.
 *
 * The gallery's archive, torrent and rename dialogs are sized windows on the site, not full pages;
 * opening them in a tab loses the gallery the user was reading. A blocked popup falls back to a
 * normal navigation so the action still works.
 */
export function openPopup(url: string, width: number, height: number): void {
  const features = `popup=yes,width=${width},height=${height},resizable=yes,scrollbars=yes`;
  const opened = window.open(url, "_blank", features);
  if (opened === null) {
    location.href = url;
  }
}
