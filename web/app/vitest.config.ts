import { defineConfig } from "vitest/config";
import path from "node:path";

// `environment: "node"` is intentional and sufficient: nothing under test
// touches the DOM. Components are deliberately out of scope (see
// kicad.test.ts's header on why arc-to-path is re-verified as plain geometry
// rather than by importing the .tsx file); the store's rAF loop is likewise
// exercised through step()/stepOnceSafe() rather than run(). `exclude` adds
// `.next` on top of vitest's own default excludes so a built app (next build
// output) can never accidentally get swept into a test run.
export default defineConfig({
    // The app uses Next's "@/..." path alias (see tsconfig.json's paths); Vite
    // does not read tsconfig paths, so it has to be declared here or any test
    // that pulls in a module using the alias fails to resolve (engine/store.ts
    // imports "@/extchip/client").
    resolve: {
        alias: { "@": path.resolve(__dirname, "src") },
    },
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
