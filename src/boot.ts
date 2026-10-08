/**
 * First thing on load: bring back how you left the office on screen (layout, finishes, theme)
 * from the local server, then start the app, which reads it as it loads.
 */
import { restorePrefs } from './sim/prefs';

await restorePrefs();
await import('./main');
