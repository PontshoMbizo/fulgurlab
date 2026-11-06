# Using fulgurlab inside scope.io

There are three ways in, from least to most coupled.

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

`?embed=1` hides New/Open/Save/Examples. Add `?api=https://host` if the API lives
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
