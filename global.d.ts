// Ambient asset-module declarations so bundler imports (Metro resolves these
// at build time) do not surface as "Cannot find module" in the editor.
declare module '*.png';
declare module '*.jpg';
declare module '*.jpeg';
declare module '*.gif';
declare module '*.ttf';
declare module '*.otf';
declare module '*.wav';
declare module '*.mp3';

// ---------------------------------------------------------------------------
// Expo / Hermes mobile globals that VS Code's JS analyser cannot infer from
// the standard web (lib.dom.d.ts) / ES (lib.es*.d.ts) type bundles.
//
// NOTE: Web/Node runtimes ALREADY ship `crypto`, `TextEncoder`, `AbortSignal`,
// `FileReader` and `navigator` inside VS Code's built-in DOM lib, so they must
// NOT be re-declared here (that causes duplicate-symbol errors). Only the
// true Hermes/Expo runtime globals that are absent from the stdlib bundles
// are declared below.
// ---------------------------------------------------------------------------

/** Set by the Hermes/Expo runtime; true for internal (non-release) builds. */
declare const __DEV__: boolean;
