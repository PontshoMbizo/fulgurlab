package com.lushprojects.circuitjs1.client;

import com.google.gwt.core.client.JavaScriptObject;
import com.google.gwt.core.client.JsArray;
import com.google.gwt.core.client.JsArrayNumber;

public class JSInterface {

    CirSim app;

    JSInterface(CirSim app) {
	this.app = app;
    }

    void setExtVoltage(String name, double v) {
	int i;
	for (i = 0; i != app.elmList.size(); i++) {
	    CircuitElm ce = app.getElm(i);
	    if (ce instanceof ExtVoltageElm) {
		ExtVoltageElm eve = (ExtVoltageElm) ce;
		if (eve.getName().equals(name))
		    eve.setVoltage(v);
	    }
	}
    }

    native JsArray<JavaScriptObject> getJSArray() /*-{ return []; }-*/;

    // Small helpers for building plain JS objects returned to the API.
    native JavaScriptObject newJSObject() /*-{ return {}; }-*/;
    native void jsPut(JavaScriptObject o, String k, double v) /*-{ o[k] = v; }-*/;
    native void jsPutStr(JavaScriptObject o, String k, String v) /*-{ o[k] = v; }-*/;
    native void jsPutBool(JavaScriptObject o, String k, boolean v) /*-{ o[k] = v; }-*/;
    native void jsPutArray(JavaScriptObject o, String k, JsArrayNumber v) /*-{ o[k] = v; }-*/;
    native void jsPutObject(JavaScriptObject o, String k, JavaScriptObject v) /*-{ o[k] = v; }-*/;
    native JsArrayNumber getJSArrayNumber() /*-{ return []; }-*/;

    JsArray<JavaScriptObject> getJSElements() {
	int i;
	JsArray<JavaScriptObject> arr = getJSArray();
	for (i = 0; i != app.elmList.size(); i++) {
	    CircuitElm ce = app.getElm(i);
	    ce.addJSMethods();
	    arr.push(ce.getJavaScriptObject());
	}
	return arr;
    }

    double getLabeledNodeVoltage(String name) { return app.sim.getLabeledNodeVoltage(name); }

    // Delegate methods for JSNI access
    void setSimRunning(boolean run) { app.setSimRunning(run); }
    boolean simIsRunning() { return app.simIsRunning(); }
    void doExportAsSVGFromAPI() { app.imageExporter.doExportAsSVGFromAPI(); }
    String dumpCircuit() { return app.dumpCircuit(); }
    void importCircuitFromText(String t, boolean s) { app.importCircuitFromText(t, s); }
    double getTime() { return app.sim.t; }
    double getTimeStep() { return app.sim.timeStep; }
    void setTimeStep(double ts) { app.sim.timeStep = ts; }
    double getMaxTimeStep() { return app.sim.maxTimeStep; }
    void setMaxTimeStep(double ts) { app.sim.maxTimeStep = app.sim.timeStep = ts; }

    void stepSim(int n) {
        app.setSimRunning(false);
        for (int i = 0; i < n; i++)
            app.sim.stepDeterministic();
    }

    JsArrayNumber getNodeVoltageList() {
        JsArrayNumber arr = getJSArrayNumber();
        if (app.sim != null && app.sim.matrices != null && app.sim.matrices.length > 0) {
            CircuitMatrix m = app.sim.matrices[0];
            for (int i = 0; i < m.nodeCount; i++)
                arr.push(m.nodeVoltages[i]);
        }
        return arr;
    }

    // Premium UI extensions
    void reset() { app.resetAction(); }
    void setSpeed(double pct) {
        if(app.ui != null && app.ui.speedBar != null) {
            app.ui.speedBar.setValue((int) ((pct / 100.0) * 260));
        }
    }
    void zoomIn() { app.mouse.zoomCircuit(20, true); }
    void zoomOut() { app.mouse.zoomCircuit(-20, true); }
    void zoomFit() { app.centerCircuit(); }
    void triggerMenu(String menu, String item) {
        if ("scopes".equals(menu)) {
            if ("stackAll".equals(item)) app.scopeManager.stackAll();
            else if ("unstackAll".equals(item)) app.scopeManager.unstackAll();
            else if ("combineAll".equals(item)) app.scopeManager.combineAll();
        } else if ("main".equals(menu)) {
            if ("exportasurl".equals(item)) app.commands.doExportAsUrl();
            else if ("exportaslocalfile".equals(item)) app.commands.doExportAsLocalFile();
            else if ("exportastext".equals(item)) app.commands.doExportAsText();
            else if ("exportasimage".equals(item)) app.imageExporter.doExportAsImage();
            else if ("newblankcircuit".equals(item)) {
                app.undoManager.pushUndo();
                app.menus.readSetupFile("blank.txt", "Blank Circuit");
            } else {
                if (app.ui.contextPanel != null) app.ui.contextPanel.hide();
                app.setMouseMode(MouseManager.MODE_ADD_ELM);
                if (item.length() > 0) app.ui.mouseModeStr = item;
                if ("DragAll".equals(item)) app.setMouseMode(MouseManager.MODE_DRAG_ALL);
                else if ("DragRow".equals(item)) app.setMouseMode(MouseManager.MODE_DRAG_ROW);
                else if ("DragColumn".equals(item)) app.setMouseMode(MouseManager.MODE_DRAG_COLUMN);
                else if ("DragSelected".equals(item)) app.setMouseMode(MouseManager.MODE_DRAG_SELECTED);
                else if ("DragPost".equals(item)) app.setMouseMode(MouseManager.MODE_DRAG_POST);
                else if ("Select".equals(item)) app.setMouseMode(MouseManager.MODE_SELECT);
                app.updateToolbar();
                app.mouse.tempMouseMode = app.mouse.mouseMode;
                app.repaint();
            }
        } else {
            // Any other menu (file, edit, view, zoom, options, …) is dispatched
            // through the native command handler, so Import From Text, Save As
            // (exportaslocalfile), Create Subcircuit, etc. all work without
            // re-implementing each one here.
            app.commands.menuPerformed(menu, item);
        }
    }

    JavaScriptObject getElementByLabel(String label) {
        for (int i = 0; i < app.elmList.size(); i++) {
            CircuitElm ce = app.getElm(i);
            String l = null;
            if (ce instanceof LabeledNodeElm) l = ((LabeledNodeElm)ce).getName();
            else if (ce instanceof ExtVoltageElm) l = ((ExtVoltageElm)ce).getName();
            if (l != null && l.equals(label)) {
                ce.addJSMethods();
                return ce.getJavaScriptObject();
            }
        }
        return null;
    }

    JsArray<JavaScriptObject> getElementsByType(String type) {
        JsArray<JavaScriptObject> arr = getJSArray();
        for (int i = 0; i < app.elmList.size(); i++) {
            CircuitElm ce = app.getElm(i);
            if (ce.getClassName().equals(type)) {
                ce.addJSMethods();
                arr.push(ce.getJavaScriptObject());
            }
        }
        return arr;
    }

    String getSimulationErrors() { return app.stopMessage; }
    boolean isCircuitValid() { return app.stopMessage == null; }

    boolean setElementProperty(String label, String property, double value) {
        for (int i = 0; i < app.elmList.size(); i++) {
            CircuitElm ce = app.getElm(i);
            String l = null;
            if (ce instanceof LabeledNodeElm) l = ((LabeledNodeElm)ce).getName();
            else if (ce instanceof ExtVoltageElm) l = ((ExtVoltageElm)ce).getName();

            if (l != null && l.equals(label)) {
                for (int j = 0; ; j++) {
                    EditInfo ei = ce.getEditInfo(j);
                    if (ei == null) break;
                    if (ei.name != null && ei.name.equalsIgnoreCase(property)) {
                        ei.value = value;
                        ce.setEditValue(j, ei);
                        // Re-stamp the solver matrix; setEditValue only mutates the
                        // element field, so without this the change has no effect on
                        // the running simulation until the next structural re-analyze.
                        app.needAnalyze();
                        return true;
                    }
                }
                break;
            }
        }
        return false;
    }

    static class VoltageListener {
        String label;
        double threshold;
        double lastVoltage;
    }
    java.util.ArrayList<VoltageListener> voltageListeners = new java.util.ArrayList<>();

    void addNodeVoltageListener(String label, double threshold) {
        VoltageListener vl = new VoltageListener();
        vl.label = label;
        vl.threshold = threshold;
        vl.lastVoltage = Double.NaN;
        voltageListeners.add(vl);
    }
    
    void checkVoltageListeners() {
        for(VoltageListener vl : voltageListeners) {
            double v = app.sim.getLabeledNodeVoltage(vl.label);
            if (Double.isNaN(vl.lastVoltage) || Math.abs(v - vl.lastVoltage) >= vl.threshold) {
                vl.lastVoltage = v;
                callNodeVoltageHook(vl.label, v);
            }
        }
    }

    native void callNodeVoltageHook(String label, double voltage) /*-{
        var hook = $wnd.CircuitJS1.onnodevoltagechange;
        if (hook)
            hook($wnd.CircuitJS1, label, voltage);
    }-*/;

    // ---- Additional inspection / convenience methods -----------------------

    // Total number of elements currently on the canvas.
    int getElementCount() { return app.elmList.size(); }

    // Current sim speed as a 0-100 percentage (inverse of setSpeed).
    double getSpeed() {
        if (app.ui == null || app.ui.speedBar == null) return 0;
        return (int) (app.ui.speedBar.getValue() / 260.0 * 100.0 + 0.5);
    }

    // Resonant frequency 1/(2*pi*sqrt(L*C)) from the first inductor and
    // capacitor found. Returns NaN if the circuit has no L-C pair.
    double getResonantFrequency() {
        InductorElm ind = null;
        CapacitorElm cap = null;
        for (int i = 0; i < app.elmList.size(); i++) {
            CircuitElm ce = app.getElm(i);
            if (ind == null && ce instanceof InductorElm) ind = (InductorElm) ce;
            if (cap == null && ce instanceof CapacitorElm) cap = (CapacitorElm) ce;
        }
        if (ind == null || cap == null) return Double.NaN;
        double lc = ind.inductance * cap.capacitance;
        if (lc <= 0) return Double.NaN;
        return 1.0 / (2 * Math.PI * Math.sqrt(lc));
    }

    // {label: voltage} for every labeled node in one call, avoiding N round
    // trips through getNodeVoltage(label) per timestep.
    JavaScriptObject getLabeledNodeVoltages() {
        JavaScriptObject o = newJSObject();
        for (int i = 0; i < app.elmList.size(); i++) {
            CircuitElm ce = app.getElm(i);
            if (ce instanceof LabeledNodeElm) {
                String name = ((LabeledNodeElm) ce).getName();
                jsPut(o, name, app.sim.getLabeledNodeVoltage(name));
            }
        }
        return o;
    }

    // Lightweight health + inventory snapshot (does not force a run).
    JavaScriptObject validateCircuit() {
        JavaScriptObject o = newJSObject();
        jsPutBool(o, "valid", app.stopMessage == null);
        jsPutStr(o, "error", app.stopMessage);
        jsPut(o, "elementCount", app.elmList.size());
        double rf = getResonantFrequency();
        if (!Double.isNaN(rf)) jsPut(o, "resonantFrequency", rf);
        return o;
    }

    // Full state in a single JSNI round-trip, convenient for UI polling.
    JavaScriptObject getState() {
        JavaScriptObject o = newJSObject();
        jsPutBool(o, "running", app.simIsRunning());
        jsPut(o, "time", app.sim.t);
        jsPut(o, "timeStep", app.sim.timeStep);
        jsPut(o, "speed", getSpeed());
        jsPut(o, "elementCount", app.elmList.size());
        jsPutBool(o, "valid", app.stopMessage == null);
        jsPutStr(o, "error", app.stopMessage);
        return o;
    }

    int getScopeCount() {
        if (app.scopeManager == null) return 0;
        return app.scopeManager.scopeCount;
    }

    JavaScriptObject getScopeData(int index) {
        if (app.scopeManager == null) return null;
        if (index < 0 || index >= app.scopeManager.scopeCount) return null;
        Scope s = app.scopeManager.scopes[index];
        JavaScriptObject o = newJSObject();
        jsPutStr(o, "text", s.getText() != null ? s.getText() : "");
        jsPut(o, "speed", s.speed);
        
        if (s.visiblePlots.size() > 0) {
            ScopePlot plot = s.visiblePlots.firstElement();
            s.calcMaxAndMin(plot.units);
            jsPut(o, "maxValue", s.maxValue);
            jsPut(o, "minValue", s.minValue);
            jsPut(o, "p2p", s.maxValue - s.minValue);
            jsPut(o, "rms", s.overlays.getRMS());
            jsPut(o, "average", s.overlays.getAverage());
            jsPut(o, "dutyCycle", s.overlays.getDutyCycle());
            jsPut(o, "frequency", s.overlays.getFrequency());
        }
        return o;
    }

    JavaScriptObject getScopeAdvancedPlot(int index) {
        if (app.scopeManager == null) return null;
        if (index < 0 || index >= app.scopeManager.scopeCount) return null;
        Scope s = app.scopeManager.scopes[index];
        JavaScriptObject o = newJSObject();
        
        if (s.fftPlot != null && s.fftPlot.enabled && s.fftPlot.fftReal != null) {
            JavaScriptObject fft = newJSObject();
            JsArrayNumber realArr = getJSArrayNumber();
            JsArrayNumber imagArr = getJSArrayNumber();
            for (int i = 0; i < s.scopePointCount / 2; i++) {
                realArr.push(s.fftPlot.fftReal[i]);
                imagArr.push(s.fftPlot.fftImag[i]);
            }
            jsPutArray(fft, "real", realArr);
            jsPutArray(fft, "imag", imagArr);
            jsPut(fft, "maxMagnitude", s.fftPlot.fftMaxMagnitude);
            jsPutObject(o, "fft", fft);
        }

        if (s.plot2d != null && s.plot2d.enabled) {
            JavaScriptObject xy = newJSObject();
            jsPut(xy, "plotX", s.plot2d.plotX);
            jsPut(xy, "plotY", s.plot2d.plotY);
            jsPutBool(xy, "plotXY", s.plot2d.plotXY);
            jsPutObject(o, "plot2d", xy);
        }

        return o;
    }

    native void setupJSInterface() /*-{
	var that = this;
	$wnd.CircuitJS1 = {
	    setSimRunning: $entry(function(run) { that.@com.lushprojects.circuitjs1.client.JSInterface::setSimRunning(Z)(run); } ),
	    getTime: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::getTime()(); } ),
	    getTimeStep: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::getTimeStep()(); } ),
	    setTimeStep: $entry(function(ts) { that.@com.lushprojects.circuitjs1.client.JSInterface::setTimeStep(D)(ts); } ), // don't use this, see #843
	    getMaxTimeStep: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::getMaxTimeStep()(); } ),
	    setMaxTimeStep: $entry(function(ts) { that.@com.lushprojects.circuitjs1.client.JSInterface::setMaxTimeStep(D)(ts); } ),
	    stepSim: $entry(function(n) { that.@com.lushprojects.circuitjs1.client.JSInterface::stepSim(I)(n); } ),
	    getNodeVoltageList: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::getNodeVoltageList()(); } ),
	    isRunning: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::simIsRunning()(); } ),
	    getNodeVoltage: $entry(function(n) { return that.@com.lushprojects.circuitjs1.client.JSInterface::getLabeledNodeVoltage(Ljava/lang/String;)(n); } ),
	    setExtVoltage: $entry(function(n, v) { that.@com.lushprojects.circuitjs1.client.JSInterface::setExtVoltage(Ljava/lang/String;D)(n, v); } ),
	    getElements: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::getJSElements()(); } ),
	    getCircuitAsSVG: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::doExportAsSVGFromAPI()(); } ),
	    exportCircuit: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::dumpCircuit()(); } ),
	    importCircuit: $entry(function(circuit, subcircuitsOnly) { return that.@com.lushprojects.circuitjs1.client.JSInterface::importCircuitFromText(Ljava/lang/String;Z)(circuit, subcircuitsOnly); }),
        
	    // Premium UI extensions
	    reset: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::reset()(); } ),
	    setSpeed: $entry(function(pct) { return that.@com.lushprojects.circuitjs1.client.JSInterface::setSpeed(D)(pct); } ),
	    zoomIn: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::zoomIn()(); } ),
	    zoomOut: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::zoomOut()(); } ),
	    zoomFit: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::zoomFit()(); } ),
	    getElementByLabel: $entry(function(l) { return that.@com.lushprojects.circuitjs1.client.JSInterface::getElementByLabel(Ljava/lang/String;)(l); } ),
	    getElementsByType: $entry(function(t) { return that.@com.lushprojects.circuitjs1.client.JSInterface::getElementsByType(Ljava/lang/String;)(t); } ),
	    triggerMenu: $entry(function(m, i) { return that.@com.lushprojects.circuitjs1.client.JSInterface::triggerMenu(Ljava/lang/String;Ljava/lang/String;)(m, i); } ),
	    getSimulationErrors: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::getSimulationErrors()(); } ),
	    isCircuitValid: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::isCircuitValid()(); } ),
	    setElementProperty: $entry(function(l, p, v) { return that.@com.lushprojects.circuitjs1.client.JSInterface::setElementProperty(Ljava/lang/String;Ljava/lang/String;D)(l, p, v); } ),
	    addNodeVoltageListener: $entry(function(l, t) { that.@com.lushprojects.circuitjs1.client.JSInterface::addNodeVoltageListener(Ljava/lang/String;D)(l, t); } ),
	    getElementCount: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::getElementCount()(); } ),
	    getSpeed: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::getSpeed()(); } ),
	    getResonantFrequency: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::getResonantFrequency()(); } ),
	    getLabeledNodeVoltages: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::getLabeledNodeVoltages()(); } ),
	    validateCircuit: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::validateCircuit()(); } ),
	    getState: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::getState()(); } ),
	    getScopeCount: $entry(function() { return that.@com.lushprojects.circuitjs1.client.JSInterface::getScopeCount()(); } ),
	    getScopeData: $entry(function(i) { return that.@com.lushprojects.circuitjs1.client.JSInterface::getScopeData(I)(i); } ),
	    getScopeAdvancedPlot: $entry(function(i) { return that.@com.lushprojects.circuitjs1.client.JSInterface::getScopeAdvancedPlot(I)(i); } )
	};
	var hook = $wnd.oncircuitjsloaded;
	if (hook)
	    hook($wnd.CircuitJS1);
    }-*/;

    native void callUpdateHook() /*-{
	var hook = $wnd.CircuitJS1.onupdate;
	if (hook)
	    hook($wnd.CircuitJS1);
    }-*/;

    native void callAnalyzeHook() /*-{
	var hook = $wnd.CircuitJS1.onanalyze;
	if (hook)
	    hook($wnd.CircuitJS1);
    }-*/;

    native void callTimeStepHook() /*-{
	var hook = $wnd.CircuitJS1.ontimestep;
	if (hook)
	    hook($wnd.CircuitJS1);
    }-*/;

    native void callSVGRenderedHook(String svgData) /*-{
	var hook = $wnd.CircuitJS1.onsvgrendered;
	if (hook)
	    hook($wnd.CircuitJS1, svgData);
    }-*/;
}
