import { defineConfig } from "vitest/config";

// Minimal config -- this app has exactly one test file today
// (src/kicad/kicad.test.ts), covering the parser/model/bindings modules
// only. `environment: "node"` is intentional and sufficient: none of the
// tested modules touch the DOM (SymbolPreview.tsx is a component and is
// deliberately excluded from test coverage per the task's scope -- see
// kicad.test.ts's own header comment on why arc-to-path is re-verified as
// plain geometry instead of importing the .tsx file). `exclude` adds
// `.next` on top of vitest's own default excludes so a built app
// (next build output) can never accidentally get swept into a test run.
export default defineConfig({
    // `css: { postcss: {} }` stops Vite's own config loader from
    // auto-discovering this app's postcss.config.mjs (Tailwind v4's
    // `plugins: ["@tailwindcss/postcss"]` shorthand, resolved specially by
    // Next's own build pipeline) -- Vite's generic PostCSS loader doesn't
    // understand that shorthand and crashes trying to load it, even though
    // none of the tested modules (parser/model/bindings, all plain .ts with
    // no styling) need any CSS processing at all.
    css: { postcss: {} },
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
        exclude: ["**/node_modules/**", "**/.next/**"],
    },
});
