import { WakeWordPipeline, type ModelRunner, type WakeModels } from "./pipeline";

export { WAKE_CONSTANTS } from "./pipeline";

/**
 * onnxruntime is imported lazily, never at module scope.
 *
 * The package resolves its wasm asset paths when it is first evaluated, which
 * throws "Invalid URL" under server rendering — and this module is reachable
 * from the page's component tree, so a static import 500s the whole app
 * before any of it is even used.
 *
 * The wasm-only bundle is deliberate too: the default entry pulls the JSEP
 * (WebGPU) build, a 28MB binary rather than 14MB, which we have no use for.
 */
type Ort = typeof import("onnxruntime-web/wasm");
let ort: Ort | null = null;

async function loadRuntime(): Promise<Ort> {
  if (ort) return ort;
  ort = await import("onnxruntime-web/wasm");
  // Serve the wasm locally and stay single-threaded: multi-threaded wasm
  // needs COOP/COEP cross-origin isolation, which would constrain the whole
  // app for no benefit at this workload.
  ort.env.wasm.wasmPaths = "/ort/";
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = "error";
  return ort;
}

const MODEL_BASE = "/models/wake";

async function runner(url: string, inputName: string): Promise<ModelRunner> {
  const runtime = await loadRuntime();
  const session = await runtime.InferenceSession.create(url, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });

  return {
    async run(input, dims) {
      const output = await session.run({ [inputName]: new runtime.Tensor("float32", input, dims) });
      return Object.values(output)[0].data as Float32Array;
    },
  };
}

async function loadModels(): Promise<WakeModels> {
  const [mel, embedding, wake] = await Promise.all([
    runner(`${MODEL_BASE}/melspectrogram.onnx`, "input"),
    runner(`${MODEL_BASE}/embedding_model.onnx`, "input_1"),
    runner(`${MODEL_BASE}/hey_jarvis_v0.1.onnx`, "x.1"),
  ]);
  return { mel, embedding, wake };
}

/**
 * openWakeWord "hey jarvis", running entirely in the browser.
 *
 * The model sequence lives in `pipeline.ts` and is shared with the device
 * build; this class only supplies the wasm runtime. Nothing here touches the
 * network after load, so microphone audio never leaves the machine until the
 * wake word fires.
 */
export class OpenWakeWord extends WakeWordPipeline {
  constructor() {
    super(loadModels);
  }
}
