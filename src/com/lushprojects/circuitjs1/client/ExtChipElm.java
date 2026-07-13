package com.lushprojects.circuitjs1.client;

import com.google.gwt.user.client.ui.TextArea;
import com.lushprojects.circuitjs1.client.util.Locale;

/**
 * External co-simulated chip (fulgurlab lockstep bridge, docs/bridge-protocol.md).
 *
 * The chip's pins are live circuit nodes; the code behind them (Verilog for fpgasim,
 * bare-metal C for mcusim) runs in a sandboxed backend, advanced one quantum at a time
 * in lockstep with this circuit. All async work lives in war/fulgur-bridge.js
 * (window.FulgurBridge); this element only makes synchronous JSNI calls per timestep:
 * push input bits, report circuit time, read the latest quantum-boundary output bits.
 * If the backend falls a full quantum behind, the bridge pauses the simulation —
 * bounded skew, no blocking inside the circuit solver.
 *
 * Pins are DECLARED here (pin spec, e.g. "rst:in,led[0]:out") so the chip has a stable
 * footprint at construction; the bridge validates the declaration against what the
 * backend actually built and reports a mismatch as an error status.
 */
public class ExtChipElm extends ChipElm {
    static int nextBridgeId = 1;

    String bridgeUrl;
    String pinSpec;
    String source;
    String engine;
    double quantumNs;

    int bridgeId;
    String[] pinNames;
    boolean[] pinIsOutput;
    int inputCount, outputCount, postCount;

    public ExtChipElm(int xx, int yy) {
	super(xx, yy);
	bridgeUrl = "ws://localhost:3100";
	pinSpec = "in0:in,out0:out";
	source = "";
	engine = "";
	quantumNs = 1000000;
	setHighVoltage(3.3);
	bridgeId = nextBridgeId++;
	parsePinSpec();
	setupPins();
	setPoints();
	// no configureBridge() here: this ctor also builds the palette/menu dummy at
	// startup, and a fresh drop has no source yet — the session starts on first edit
    }

    public ExtChipElm(int xa, int ya, int xb, int yb, int f, StringTokenizer st) {
	super(xa, ya, xb, yb, f, st);
	bridgeUrl = CustomLogicModel.unescape(st.nextToken());
	pinSpec = CustomLogicModel.unescape(st.nextToken());
	quantumNs = new Double(st.nextToken()).doubleValue();
	engine = CustomLogicModel.unescape(st.nextToken());
	source = st.hasMoreTokens() ? CustomLogicModel.unescape(st.nextToken()) : "";
	bridgeId = nextBridgeId++;
	parsePinSpec();
	setupPins();
	allocNodes();
	setPoints();
	configureBridge();
    }

    String dump() {
	return super.dump() + " " + CustomLogicModel.escape(bridgeUrl) + " "
		+ CustomLogicModel.escape(pinSpec) + " " + quantumNs + " "
		+ CustomLogicModel.escape(engine) + " " + CustomLogicModel.escape(source);
    }

    /** "a:in,b[0]:out" -> pinNames/pinIsOutput, inputs first (bridge bit order). */
    void parsePinSpec() {
	String[] parts = (pinSpec == null ? "" : pinSpec).split(",");
	int n = 0;
	int i;
	for (i = 0; i != parts.length; i++)
	    if (parts[i].trim().length() > 0)
		n++;
	String[] inNames = new String[n];
	String[] outNames = new String[n];
	int nin = 0, nout = 0;
	for (i = 0; i != parts.length; i++) {
	    String s = parts[i].trim();
	    if (s.length() == 0)
		continue;
	    int colon = s.lastIndexOf(':');
	    String name = colon < 0 ? s : s.substring(0, colon).trim();
	    String dir = colon < 0 ? "in" : s.substring(colon + 1).trim();
	    if (dir.equals("out"))
		outNames[nout++] = name;
	    else
		inNames[nin++] = name;
	}
	inputCount = nin;
	outputCount = nout;
	postCount = nin + nout;
	pinNames = new String[postCount];
	pinIsOutput = new boolean[postCount];
	for (i = 0; i != nin; i++) {
	    pinNames[i] = inNames[i];
	    pinIsOutput[i] = false;
	}
	for (i = 0; i != nout; i++) {
	    pinNames[nin + i] = outNames[i];
	    pinIsOutput[nin + i] = true;
	}
    }

    @Override
    void setupPins() {
	if (pinNames == null) {
	    // called from the ChipElm constructor before our fields exist; real setup
	    // happens after parsePinSpec()
	    postCount = 0;
	    pins = new Pin[0];
	    return;
	}
	sizeY = inputCount > outputCount ? inputCount : outputCount;
	if (sizeY == 0)
	    sizeY = 1;
	sizeX = 2;
	pins = new Pin[postCount];
	int i, nin = 0, nout = 0;
	for (i = 0; i != postCount; i++) {
	    if (!pinIsOutput[i]) {
		pins[i] = new Pin(nin++, SIDE_W, pinNames[i]);
	    } else {
		pins[i] = new Pin(nout++, SIDE_E, pinNames[i]);
		pins[i].output = true;
	    }
	}
	allocNodes();
    }

    int getPostCount() { return postCount; }

    @Override
    int getVoltageSourceCount() { return outputCount; }

    void configureBridge() {
	if (source == null || source.trim().length() == 0)
	    return; // nothing to compile yet — stays "unconfigured"
	jsConfigure(bridgeId, bridgeUrl, source, canonicalPinSpec(), quantumNs, engine);
    }

    /** Pin spec normalised to bridge order (inputs first) for backend validation. */
    String canonicalPinSpec() {
	String s = "";
	int i;
	for (i = 0; i != postCount; i++) {
	    if (i > 0)
		s += ",";
	    s += pinNames[i] + ":" + (pinIsOutput[i] ? "out" : "in");
	}
	return s;
    }

    @Override
    void execute() {
	int bits = 0;
	int i, nin = 0;
	for (i = 0; i != postCount; i++)
	    if (!pinIsOutput[i]) {
		if (pins[i].value)
		    bits |= 1 << nin;
		nin++;
	    }
	jsSetInputs(bridgeId, bits);
	jsOnSimTime(bridgeId, sim.t * 1e9);
	int out = jsGetOutputs(bridgeId);
	int nout = 0;
	for (i = 0; i != postCount; i++)
	    if (pinIsOutput[i]) {
		pins[i].value = ((out >> nout) & 1) != 0;
		nout++;
	    }
    }

    void delete() {
	jsDispose(bridgeId);
	super.delete();
    }

    native void jsConfigure(int id, String url, String src, String pinSpec, double quantumNs, String engine) /*-{
	if ($wnd.FulgurBridge)
	    $wnd.FulgurBridge.configure(id, url, src, pinSpec, quantumNs, engine);
    }-*/;

    native void jsSetInputs(int id, int bits) /*-{
	if ($wnd.FulgurBridge)
	    $wnd.FulgurBridge.setInputs(id, bits);
    }-*/;

    native int jsGetOutputs(int id) /*-{
	return $wnd.FulgurBridge ? $wnd.FulgurBridge.getOutputs(id) : 0;
    }-*/;

    native void jsOnSimTime(int id, double tNs) /*-{
	if ($wnd.FulgurBridge)
	    $wnd.FulgurBridge.onSimTime(id, tNs);
    }-*/;

    native String jsGetStatus(int id) /*-{
	return $wnd.FulgurBridge ? $wnd.FulgurBridge.getStatus(id) : "bridge not loaded";
    }-*/;

    native void jsDispose(int id) /*-{
	if ($wnd.FulgurBridge)
	    $wnd.FulgurBridge.dispose(id);
    }-*/;

    public EditInfo getChipEditInfo(int n) {
	if (n == 0) {
	    EditInfo ei = new EditInfo("Bridge URL (fpgasim :3100, mcusim :3101)", 0, -1, -1);
	    ei.text = bridgeUrl;
	    ei.disallowSliders();
	    return ei;
	}
	if (n == 1) {
	    EditInfo ei = new EditInfo("Pins (name:in|out, comma-separated)", 0, -1, -1);
	    ei.text = pinSpec;
	    ei.disallowSliders();
	    return ei;
	}
	if (n == 2)
	    return new EditInfo("Quantum (ns)", quantumNs, 1000, 100000000).setDimensionless();
	if (n == 3) {
	    EditInfo ei = new EditInfo("Engine (mcusim: mainline/xpack; blank for fpgasim)", 0, -1, -1);
	    ei.text = engine;
	    ei.disallowSliders();
	    return ei;
	}
	if (n == 4) {
	    EditInfo ei = new EditInfo(EditInfo.makeLink("bridge-protocol.md", "Source (Verilog or C)"), 0, -1, -1);
	    ei.textArea = new TextArea();
	    ei.textArea.setVisibleLines(10);
	    ei.textArea.setCharacterWidth(60);
	    ei.textArea.setText(source);
	    return ei;
	}
	return null;
    }

    public void setChipEditValue(int n, EditInfo ei) {
	if (n == 0)
	    bridgeUrl = ei.textf.getText();
	if (n == 1) {
	    pinSpec = ei.textf.getText();
	    parsePinSpec();
	    setupPins();
	    setPoints();
	}
	if (n == 2)
	    quantumNs = ei.value;
	if (n == 3)
	    engine = ei.textf.getText();
	if (n == 4)
	    source = ei.textArea.getText();
	// any edit re-establishes the session with the new settings
	configureBridge();
    }

    boolean hasCustomVoltage() { return true; }

    int getDumpType() { return 460; }
    String getXmlDumpType() { return "extchip"; }

    String getElmType() { return "external chip"; }

    void getInfo(String arr[]) {
	arr[0] = "external chip (" + jsGetStatus(bridgeId) + ")";
	arr[1] = "bridge: " + bridgeUrl;
	arr[2] = "quantum: " + getUnitText(quantumNs * 1e-9, "s");
    }
}
