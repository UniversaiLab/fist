'use strict';
// Single entry point re-exporting every shared module, so consumers (the
// Electron main process, the Vite-bundled renderer, and eventually a React
// Native app) just do `require('@soul-connection/core-logic')` instead of
// reaching into individual files.
//
// Deliberately a single `module.exports = {...}` (not per-name `exports.X =`
// statements) -- Vite/Rollup's static CJS-named-export detection is
// unreliable for a re-exporting entry point like this regardless of which
// shape is used (verified: even individual exports.X assignments dropped
// some names silently), so the renderer imports this whole object as a
// default import and destructures at runtime instead of relying on that
// static analysis at all. See src/*.jsx's `import CoreLogic from ...`.

module.exports = {
  ...require('./parsers.js'),
  ...require('./singboxConfig.js'),
  ...require('./format.js'),
  ...require('./score.js'),
  ...require('./geo.js'),
  ...require('./settingsSchema.js'),
};
