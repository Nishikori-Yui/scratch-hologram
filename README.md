# Scratch Hologram

Independent Vue workbench for scratch holograms: static patterns, imported SVGs, rotating signature animation, reflection and scratch geometry views, and render diagnostics.

## Run

Requires Node.js 22.12+ (or 24+), npm, Rust and the wasm32-unknown-unknown target.

```sh
rustup target add wasm32-unknown-unknown
npm ci
npm run dev
```

Development runs at http://127.0.0.1:5173. All rendering code, styles, icons, font, signature assets, shader and WASM source live in this repository. No sibling checkout, symbolic link, website API, CDN or pre-rendered orbit assets are required.

## Verify and Build

```sh
npm test
npm run build
npx playwright install chromium
npm run test:e2e
npm run test:gpu
npm run preview
```

Build produces a static `dist/` with bundled module worker, shader, WASM, font and signature data. Host it on localhost or HTTPS for WebGPU; WASM raster rendering is the fallback when GPU rendering is unavailable. Diagnostics report the actual active backend and completed frames. Language defaults to English and can be switched to Chinese.

Themes initially follow the operating system. The header provides light/dark and independent soft-tone toggles, with saved choices applied before the app loads. Selecting the system's current light/dark mode restores automatic tracking, matching the website's behavior. Soft tone uses the website's warm-gray light palette and neutral-gray dark palette. The circular theme transition and tone-icon morph respect reduced motion; theme switching also works without View Transitions or browser storage.

`npm run test:gpu` starts a local Vite development server and explicitly requests the WebGPU backend in Chromium with a SwiftShader software adapter. It compares GPU and WASM pixels for disc tilt, light size, imported SVG geometry and rotating signatures, and checks all four render resolutions. A missing adapter or GPU fallback fails this test. This verifies rendering correctness; it does not measure hardware GPU performance.

## Implementation

- `src/components/ScratchHologramEmbed.vue`: workbench and bounded controls.
- `src/scratch-hologram.worker.js`: frame processing, geometry caching, WebGPU/WASM fallback.
- `src/scratch-hologram-webgpu.js` and `src/scratch-hologram.wgsl`: GPU renderer.
- `wasm/src/lib.rs`: geometry encoder and CPU renderer, rebuilt by `npm run build:wasm`.
- `scripts/check-independence.mjs`: verifies local imports/assets and rejects symlinks and references outside this repository.

The older orbit pre-render generator and its assets have been replaced by the live renderer. Existing Git history retains the previous implementation.

## License

The project source is available under the MIT License; see `LICENSE`.

Bundled third-party assets retain their original licenses: Inter uses the SIL Open Font License (`src/assets/fonts/Inter-LICENSE.txt`), and the two inline icon masks use IBM Carbon icons under Apache-2.0 (`src/assets/icons/LICENSE.txt`).
