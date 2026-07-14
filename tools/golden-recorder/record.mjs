import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const OUT_DIR = path.join(__dirname, '../../web/engine/test/golden/fixtures');

async function main() {
    if (!fs.existsSync(OUT_DIR)) {
        fs.mkdirSync(OUT_DIR, { recursive: true });
    }

    const browser = await puppeteer.launch({ headless: "new" });
    const page = await browser.newPage();
    
    // Assuming python -m http.server 8000 is running in site/
    await page.goto('http://127.0.0.1:8000/circuitjs.html', { waitUntil: 'networkidle2' });
    
    // Wait for the CircuitJS1 API to be ready
    await page.waitForFunction('window.CircuitJS1 !== undefined');
    await new Promise(r => setTimeout(r, 1000)); // Give it a second to fully initialize

    const fixtures = fs.readdirSync(FIXTURES_DIR).filter(f => f.endsWith('.circuit.txt'));

    for (const fixture of fixtures) {
        console.log(`Recording fixture: ${fixture}`);
        const content = fs.readFileSync(path.join(FIXTURES_DIR, fixture), 'utf-8');
        
        // Parse probes from header
        // Example: #probe node:mid node:out
        const probeLine = content.split('\n').find(l => l.startsWith('#probe'));
        if (!probeLine) {
            console.warn(`Skipping ${fixture} (no #probe header)`);
            continue;
        }
        
        const probes = probeLine.replace('#probe', '').trim().split(/\s+/);
        
        // Import circuit
        await page.evaluate((circuitText) => {
            window.CircuitJS1.importCircuit(circuitText, false);
            window.CircuitJS1.setSimRunning(true);
        }, content);

        await new Promise(r => setTimeout(r, 500)); // Wait for circuit to settle and analyze

        await page.evaluate(() => {
            window.CircuitJS1.setSimRunning(false);
        });

        const STEPS = 100;
        const traces = {};
        for (const probe of probes) {
            traces[probe] = new Array(STEPS);
        }

        // Record
        for (let i = 0; i < STEPS; i++) {
            const vals = await page.evaluate((probeList) => {
                const results = {};
                for (const p of probeList) {
                    if (p.startsWith('node:')) {
                        const label = p.substring(5);
                        results[p] = window.CircuitJS1.getNodeVoltage(label);
                    }
                    // can add elm: currents later
                }
                // Step ONE iteration deterministically
                window.CircuitJS1.stepSim(1);
                return results;
            }, probes);

            for (const p of probes) {
                traces[p][i] = vals[p];
            }
        }

        // Save output
        const outData = {
            probes: traces,
            steps: STEPS
        };
        fs.writeFileSync(path.join(OUT_DIR, fixture.replace('.txt', '.json')), JSON.stringify(outData, null, 2));
    }

    await browser.close();
}

main().catch(console.error);
