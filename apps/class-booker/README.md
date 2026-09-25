# Class Booker

A generic installable shell for private class-booking shortcuts and dated calendar tickets. The public files contain no private event data or credentials. Authenticated snapshots supply dated events and original emails/PDFs; setup URLs accept shortcuts only.

Calendar events share the existing week view. Use Jump to date to reach any week in the supplied calendar window, or Next up to return to the next event. The date picker stays within the dates actually received. Recurring booking shortcuts still cover only this week and next week. Calendar decisions and invalidations supersede legacy tickets for the same occurrence. Missing, review and cancelled events cannot offer a purchase button.

The complete private snapshot is limited to 3.5 MB UTF-8. Sources are referenced by ID across days. Ready requires explicit ticket admission, order identity, positive quantity, an original PDF, issuer-supported coverage and a complete lifecycle check. Each event ages independently of the calendar refresh.

Originals are saved in one IndexedDB transaction with a monotonic revision and verified readback. Local storage retains shortcut compatibility and a revision watermark. A cache error is visible and cannot claim offline availability; stale or unavailable updates cannot claim a current ready ticket. Original email HTML uses the existing script-free iframe; PDFs retain their original bytes. Offline source images and issuer links may still require a connection.

Run synthetic contract, schedule and cache tests with `node --test apps/class-booker/*.test.mjs`. Browser acceptance should additionally verify cold offline restart, original PDF bytes, email rendering, cache denial, and the paired private routes.

The tile and installed PWA reference files in this folder. Keep them listed in `/protected-assets.json`.
