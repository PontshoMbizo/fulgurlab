"use client";

import { useSyncExternalStore } from "react";
import { engineStore } from "@/engine/store";

export default function Toolbar() {
    useSyncExternalStore(engineStore.subscribe, engineStore.getVersion, engineStore.getVersion);
    const running = engineStore.isRunning();
    const status = engineStore.status;

    return (
        <div className="flex items-center gap-2 px-3 py-2 border-b border-neutral-800 bg-neutral-950 text-neutral-200 text-sm">
            <button
                className={`px-3 py-1 rounded ${running ? "bg-red-900/60 hover:bg-red-900" : "bg-emerald-900/60 hover:bg-emerald-900"}`}
                onClick={() => (running ? engineStore.stop() : engineStore.run())}
            >
                {running ? "Stop" : "Run"}
            </button>
            <button
                className="px-3 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
                onClick={() => engineStore.step()}
                disabled={running}
            >
                Step
            </button>
            <button
                className="px-3 py-1 rounded bg-neutral-800 hover:bg-neutral-700"
                onClick={() => engineStore.clear()}
            >
                Clear
            </button>
            <label className="flex items-center gap-1 ml-2 text-neutral-400">
                Speed
                <input
                    type="range"
                    min={1}
                    max={40}
                    defaultValue={engineStore.stepsPerFrame}
                    onChange={(e) => { engineStore.stepsPerFrame = Number(e.target.value); }}
                    className="w-24"
                />
            </label>
            <div className="flex-1" />
            <div className={`text-xs ${status.state === "error" ? "text-red-400" : "text-neutral-500"}`}>
                {status.state === "error" ? `Error: ${status.message}` : status.state === "running" ? "Running" : "Idle"}
            </div>
        </div>
    );
}
