# Scope.io and CircuitJS Development Guidelines

This document contains rules, operational guidelines, and context for AI agents working on the Scope.io and CircuitJS1 projects. Future agents must adhere to these rules to ensure safe, stable changes and efficient workflow. If you discover a better pattern or run into a persistent issue, **update this document** to help future agents!

## 1. Project Architecture
The workspace consists of two tightly-coupled projects:
* **CircuitJS1** (`/home/pontsho/Workspace/projects/circuitjs1`): The core circuit simulation engine written in Java and compiled to Javascript via GWT.
* **Scope.io** (`/home/pontsho/Workspace/projects/ohmify`): A Next.js 16 (Turbopack) web application that wraps the CircuitJS engine within an `iframe` (specifically in `components/Simulator.jsx`) to provide an interactive educational platform.

## 2. Making Changes to CircuitJS1 (The Engine)
When you modify Java files or core HTML/CSS in `circuitjs1`, you no longer need to manually compile and copy them.
We have GitHub Actions set up for this process.

**How to Ship:**
1. Navigate to the `circuitjs1` directory.
2. Commit your changes using `git add` and `git commit`.
3. Run `git push` to push to the GitHub repository.
4. The GitHub Action will automatically run `./gradlew makeSite` and handle publishing the updated engine to Scope.io.

## 3. Modifying Scope.io (The Web App)
Scope.io is built with Next.js and uses TailwindCSS for styling.

**Simulator UI Integration:**
* The custom simulation UI lives in `components/Simulator.jsx`.
* **CRITICAL: React Event Propagation:** When building custom UI overlays (like dropdown menus) over the simulator iframe, do **not** use `document.addEventListener("click", ...)` to detect outside clicks. Because of how React synthetic events interact with native DOM events, `e.stopPropagation()` in React will not prevent native document listeners from firing, causing menus to instantly close. 
* **The Fix:** Always use a full-screen invisible overlay `div` (e.g., `className="absolute inset-0 z-10"`) with an `onClick` handler to close menus safely.
* The simulator iframe is initialized with query parameters like `?hideMenu=true&hideSidebar=true` to suppress the native CircuitJS UI so our custom React UI can take over.

## 4. Running Tests
* **Automated Scripts:** There are Puppeteer test scripts located in the `ohmify` root (e.g., `test_ui_class.js`, `test_ui_screenshot.js`). Use these via `node <script_name>` to quickly validate UI states and class additions without needing a browser window.
* **Dev Server:** Run `npm run dev` to start the Next.js server for manual testing. *Note: Port 3000 might occasionally be locked; Next.js will fallback to 3001, so ensure your Puppeteer scripts point to the right port if testing against the dev server.*

## 5. Iteration and Safety
* **Avoid Silent Failures:** If you edit `Simulator.jsx` and add React state, be exceedingly careful with syntax (e.g., unmatched braces). 
* **State Syncing:** Remember that the React UI and the CircuitJS iframe are two different worlds. Use `sim.triggerMenu(menu, action)` to map React button clicks to native CircuitJS operations.
* **Continuous Improvement:** If you find a new edge case or a better way to structure testing between the two repos, update this `AGENTS.md` file immediately!

## 6. Deployment Process
Deployments are handled fully automatically via GitHub Actions.
1. Committing to `circuitjs1` automatically builds and publishes the engine package.
2. Committing to `ohmify` main branch automatically deploys the Next.js app to production on scope.io.
