# Using fulgurlab inside scope.io

There are three ways in, from least to most coupled. scope.io itself uses the first one (with its
`scopeio:*` messages, below) for authoring and solving, and the third for grading.

## scope.io's protocol

scope.io drives all of its embedded simulators (fpgasim, mcusim, fulgurlab, fulgurspice) with the
same messages. The code is in `web/src/scopeio.ts`.

| Direction | Message | When |
|---|---|---|
| editor → host | `{ type: 'scopeio:ready' }` | the listener is registered; the host (re)sends init |
| host → editor | `{ type: 'scopeio:init', protocol: 2, mode, starterCode, config }` | once the editor is ready |
| editor → host | `{ type: 'scopeio:change', code }` | 0.8 s after the learner stops editing (the host keeps a draft) |
| editor → host | `{ type: 'scopeio:result', payload }` | the host's action button was pressed |

- `mode` chooses the action button and what is locked:

  | mode | button | runs first | locked blocks | Lock toggle |
  |---|---|---|---|---|
  | `export` | Save starter | no | editable | shown |
  | `capture` | Capture golden | yes | editable | shown |
  | `solve` | Submit | yes | enforced | hidden |

- `starterCode` is the diagram as JSON text (`''` starts empty). Duplicate inits are ignored: the
  editor seeds from the first one only.
- `config`: `{ lockSettings?: boolean, theme?: 'auto' | 'light' }`. `lockSettings` (default: on in
  `solve`) makes stop time and sample step read-only, so a submission runs on the problem's time grid.
  `theme: 'light'` ignores the system dark setting.
- `payload`: `{ code, ok, log?, scopes? }`. `code` is the diagram as JSON text, `log` explains a failed
  run, and `scopes` (capture mode only) holds the traces for the host's golden.

**Locked blocks.** A block with `"locked": true` (editor-only, the server ignores it) can be moved and
wired in `solve` mode, but not deleted, re-parameterised or grouped into a subsystem. That is
convenience, not security: scope.io's grader re-checks every locked block of the starter against the
submitted diagram (same id, type and parameters) before it re-simulates it.

**Grading.** scope.io never trusts the traces a browser posts. Its server sends the submitted `code`
to `POST /api/simulate` with `Authorization: Bearer $FULGUR_GRADER_TOKEN`, which skips the per-client
rate limit (`RATE_LIMIT_PER_MIN`, default 30 a minute).

**Deployment for scope.io.**
- The page must be frameable by scope.io. If nginx sends `X-Frame-Options` or a CSP, allow scope.io's
  origins: `add_header Content-Security-Policy "frame-ancestors 'self' https://<scope.io origin>";`
- Set `FULGUR_GRADER_TOKEN` on the server (compose reads it from the environment or
  `compose.override.yml`) and the same value as `FULGURLAB_GRADER_TOKEN` in scope.io.
- `TRUST_PROXY=1` behind nginx, so the rate limit keys on the client and not on nginx.
- `change` and `result` messages go only to the origin that sent `init` (or `fulgurlab:load`); only the
  empty `ready` messages go to `'*'`.

## 1. iframe + postMessage

Serve fulgurlab (for example with `docker compose up`) and embed it:

```html
<iframe id="sim" src="https://sim.example.com/?embed=1" style="width:100%;height:720px;border:0"></iframe>
<script>
  const sim = document.getElementById('sim');
  window.addEventListener('message', (e) => {
    if (e.origin !== 'https://sim.example.com') return;
    const msg = e.data;
    if (msg.type === 'fulgurlab:ready') {
      // start the learner from a problem's starter diagram
      sim.contentWindow.postMessage({ type: 'fulgurlab:load', netlist: starterDiagram }, 'https://sim.example.com');
    }
    if (msg.type === 'fulgurlab:change') saveDraft(msg.netlist);
    if (msg.type === 'fulgurlab:result' && msg.result.ok) grade(msg.result.scopes, msg.netlist);
  });
</script>
```

`?embed=1` hides New/Open/Save/Examples. `fulgurlab:change` and `fulgurlab:result` are posted only to
the origin that sent the last `fulgurlab:load`, so send a load before listening for them. Add `?api=https://host` if the API lives
on a different origin than the page, and set `CORS_ORIGINS` on the server to
match.

## 2. React component

```tsx
import { FulgurEditor } from '<path-to-fulgurlab>/web/src';
import '<path-to-fulgurlab>/web/src/editor/styles.css';

<FulgurEditor
  initial={starterDiagram}
  apiBase="https://sim.example.com"   // '' = same origin
  compact
  onChange={saveDraft}
  onResult={(result, netlist) => result.ok && grade(result.scopes, netlist)}
/>
```

To load a new diagram later, change `initial` and bump `loadKey`. The component
fills its parent's height (minimum 560 px).

## 3. API only (recommended for grading)

Don't trust results posted back by the browser. Grade on the server by
re-simulating the submitted netlist:

```ts
const res = await fetch('http://fulgurlab:8080/api/simulate', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(submittedNetlist),
}).then((r) => r.json());

if (res.ok) {
  const y = res.scopes.response.y[0];   // first input of the scope with id "response"
  const t = res.scopes.response.t;
  // e.g. overshoot < 10 %, settling time < 2 s, steady-state error < 1 %
}
```

A problem can fix the scope ids it expects (e.g. a locked `response` scope in the
starter diagram) so the grader knows where to look.
