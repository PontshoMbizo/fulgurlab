# CircuitJS1 Simulator Features

## Signal Scope Functionalities
The Signal Scope in CircuitJS1 is highly versatile and allows for extensive analysis of circuit states, waveforms, and component behaviors. It provides multiple display modes, custom plots, and configurable triggers.

### 1. Measurements and Values (Plots)
You can plot various electrical properties depending on the component being probed:
- **Voltage**: Show the voltage across a component or at a node.
- **Current**: Show the current flowing through a component.
- **Resistance**: Show the resistance (useful for variable resistors/memristors).
- **Power Consumed**: Show the power dissipation of a component.
- **Charge**: Show charge (specifically for capacitors).
- **Transistor-Specific**: Show Base Current (Ib), Collector Current (Ic), Emitter Current (Ie), Base-Emitter Voltage (Vbe), Base-Collector Voltage (Vbc), and Collector-Emitter Voltage (Vce).

### 2. Displayed Information (On-Screen Data)
The scope can continuously calculate and display the following metrics overlaid on the plot:
- **Scale**: Show the vertical axis scale (e.g., V/div).
- **Peak Value**: Display the maximum positive value.
- **Negative Peak Value**: Display the maximum negative value.
- **Peak-to-Peak (P2P)**: Display the total amplitude range (Max - Min).
- **Frequency**: Automatically calculate and display the frequency of periodic signals.
- **Average**: Display the DC average value of the signal.
- **RMS Average**: Display the Root Mean Square (RMS) value.
- **Duty Cycle**: Display the duty cycle percentage of pulse/square waves.
- **Phase Angle**: Display the phase angle (useful in AC circuits).
- **Extended Elm Info**: Show detailed information about the element being probed.

### 3. Advanced Analysis and XY Plots
- **Spectrum (FFT)**: Perform a Fast Fourier Transform to display the frequency spectrum of the signal (useful for audio and RF analysis).
- **Log Spectrum**: Display the FFT spectrum on a logarithmic scale.
- **V vs I**: Plot Voltage against Current (creates an I-V curve, useful for diodes/transistors).
- **Vce vs Ic**: Specifically plot Collector-Emitter Voltage against Collector Current for transistor characteristic curves.
- **Custom X-Y Plots**: Assign specific measurements to the X and Y axes independently, and map values to Plot Brightness, Red, Green, and Blue color channels to create highly customized multidimensional visualizations.

### 4. Trigger Controls
- **Trigger Modes**: 
  - **Free Run**: Continuous display without synchronization.
  - **Normal**: Updates only when the trigger condition is met.
  - **Auto**: Triggers when conditions are met, otherwise updates automatically.
- **Trigger Edge**: Select between **Rising** edge or **Falling** edge.
- **Trigger Level**: Set a specific manual threshold level for the trigger to activate.

### 5. Scaling and Positioning
- **Vertical Scale (Y-Axis)**:
  - **Auto Scale**: Continuously adjust scale to fit the waveform.
  - **Max Scale**: Lock to the historical maximum bounds.
  - **Manual Scale**: Manually set the bounds or scale per division. Allows adjusting the number of vertical divisions.
  - **AC/DC Coupling**: Toggle between AC (removes DC offset) and DC coupled inputs.
  - **Position**: Adjust the vertical offset of the waveform.
- **Horizontal Scale (X-Axis/Time)**:
  - Adjust the horizontal time-base speed (time per division).
  
### 6. Display Settings
- **Trail Persistence**: Adjust how long old traces remain on the screen (from 0 to many simulation steps), creating a phosphor persistence effect like analog oscilloscopes.
- **Custom Labels**: Add a custom text label to the scope window.

### 7. Window Management
- **Stack / Unstack**: Stack multiple scopes vertically or unstack them.
- **Combine**: Overlay multiple traces onto a single scope window.
- **Dock / Undock**: Dock scopes into the main UI panel or pop them out into floating windows.
- **Export**: Export the currently scoped data points to a CSV file.
- **Reset**: Clear the accumulated data and restart the plot.

## JavaScript API Access
CircuitJS1 exposes a global object on the window (`window.CircuitJS1`) which can be used to query the state of the simulator programmatically. We have extended this API to expose Signal Scope's advanced calculated information and plots.

### `CircuitJS1.getScopeCount()`
Returns the total number of currently active scopes in the simulator.
```javascript
let count = CircuitJS1.getScopeCount();
console.log("Active Scopes:", count);
```

### `CircuitJS1.getScopeData(index)`
Returns an object containing the core properties and the dynamically calculated electrical parameters for the given scope (indexed from `0` to `scopeCount - 1`).

**Returns:**
```javascript
{
  "text": "Scope 1",       // The custom label of the scope
  "speed": 128,            // The time-base speed (simulation steps per pixel)
  "maxValue": 5.0,         // Peak positive value
  "minValue": -5.0,        // Peak negative value
  "p2p": 10.0,             // Peak-to-Peak value
  "rms": 3.53,             // Root Mean Square (RMS)
  "average": 0.0,          // DC Average
  "dutyCycle": 50.0,       // Duty Cycle percentage (0-100)
  "frequency": 1000.0      // Calculated fundamental frequency in Hz
}
```
*Note: If the scope waveform is flat or non-periodic, `frequency` and `dutyCycle` may return `0`.*

### `CircuitJS1.getScopeAdvancedPlot(index)`
Returns an object containing raw data for the advanced visualization plots (e.g., FFT spectrum, X-Y plots) if they are currently enabled on the scope.

**Returns:**
```javascript
{
  // Present only if "Show Spectrum" (FFT) is enabled
  "fft": {
    "real": [ ... ],       // Array of real components (magnitude part 1)
    "imag": [ ... ],       // Array of imaginary components (magnitude part 2)
    "maxMagnitude": 4.2    // The maximum magnitude found in the spectrum
  },
  
  // Present only if "Plot X/Y" or "Show V vs I" is enabled
  "plot2d": {
    "plotX": 0,            // The ID of the measurement plotted on the X axis
    "plotY": 1,            // The ID of the measurement plotted on the Y axis
    "plotXY": true         // Boolean indicating if 2D plotting is active
  }
}
```

#### Example: Analyzing FFT Data via JS
If you want to render your own custom spectrum analyzer UI:
```javascript
let plotData = CircuitJS1.getScopeAdvancedPlot(0);
if (plotData && plotData.fft) {
    let magnitudes = [];
    let numBins = plotData.fft.real.length;
    
    for(let i = 0; i < numBins; i++) {
        let r = plotData.fft.real[i];
        let im = plotData.fft.imag[i];
        // Calculate the magnitude of the frequency bin
        let mag = Math.sqrt(r*r + im*im);
        // Calculate decibels (dB) relative to max magnitude
        let db = 20 * Math.log10(mag / plotData.fft.maxMagnitude);
        magnitudes.push(db);
    }
    console.log("Spectrum (dB):", magnitudes);
}
```
