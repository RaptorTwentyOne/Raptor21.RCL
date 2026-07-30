// Raptor htmx-4 glue extensions (ported from Rizzy, MIT). Import this AFTER htmx is on window (from
// vendor/htmx.ts) so registerExtension is available.
//
// These extensions are written against the htmx 4 extension API. No entry point imports this module, and
// the shipped bundle loads htmx 2, so they are inactive as distributed.

import './antiforgery';
import './confirmation';
import './nonce';
