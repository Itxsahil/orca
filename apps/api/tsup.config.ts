import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node22',
  platform: 'node',
  clean: true,
  sourcemap: true,
  // Bundle our workspace packages (they ship TypeScript source)...
  noExternal: [/^@repo\//],
  // ...but load every library from node_modules at runtime. Bundling CommonJS
  // libraries (pg, express) into an ESM file breaks their require() calls.
  external: [/^(?!@repo\/)[^./]/],
});
