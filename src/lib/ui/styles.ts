/**
 * The stylesheets as strings. The in-page shadow root takes the list sheet only. Extension pages
 * take it with the page sheet, which holds the settings, welcome and first-run rules.
 */
import listCss from './styles.css?inline';
import pageCss from './pages.css?inline';

/** The list stylesheet, for the in-page shadow root. */
export const APP_CSS: string = listCss;

/** The rules that only extension pages use. */
export const PAGE_CSS: string = pageCss;

/** Adds both stylesheets to an extension page once. */
export function installStyles(doc: Document): void {
  if (doc.head.querySelector('style[data-weekrow]')) return;
  const style = doc.createElement('style');
  style.dataset.weekrow = '';
  style.textContent = `${APP_CSS}\n${PAGE_CSS}`;
  doc.head.prepend(style);
}
