// Public entry point of the engine. Platform-free: no Node or DOM APIs.

export { Game, initialState, renderBlocks } from './game.ts';
export type { ActionCtx, Block, BlockStyle, GameOptions, Host } from './game.ts';
export { compilePack, loadWorld, PackError } from './pack.ts';
export type { CompileResult } from './pack.ts';
export { validate } from './validator.ts';
export { isBundle, sourceFromBundle } from './bundle.ts';
export { inlineTheme, THEME_NOTES, themeType } from './theme.ts';
export type { PackBundle, ScriptImporter } from './bundle.ts';
export type { ValidationReport } from './validator.ts';
export { playWalkthrough, parseWalkthrough } from './walkthrough.ts';
export type { WalkthroughResult } from './walkthrough.ts';
export type * from './types.ts';
export type * from './script-api.ts';
