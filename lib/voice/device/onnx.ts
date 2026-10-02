import path from "node:path";
import type { ModelRunner } from "../wake/pipeline";

/**
 * onnxruntime-node, loaded lazily and shared.
 *
 * Lazy for the same reason the browser build is: this module is reachable
 * from code the bundler walks, and a native `.node` binding evaluated at
 * import time is a crash waiting for a machine that doesn't have the
 * prebuilt binary for its architecture. Failing when voice actually starts
 * lets the rest of JARVIS keep working and lets the error name itself.
 */
type OrtNode = typeof import("onnxruntime-node");

let ort: OrtNode | null = null;
let loading: Promise<OrtNode> | null = null;

export async function loadRuntime(): Promise<OrtNode> {
  if (ort) return ort;
  if (loading) return loading;

  loading = (async () => {
    const runtime = await import("onnxruntime-node");
    // ORT logs graph-partitioning warnings at load; they're expected and
    // would otherwise scroll past every single startup.
    runtime.env.logLevel = "error";
    ort = runtime;
    return runtime;
  })();

  try {
    return await loading;
  } finally {
    loading = null;
  }
}

/**
 * Model files live under public/, which ships with the app on the device.
 *
 * The build warns that a computed path makes it trace the whole project into
 * the output. That is exactly what we want here — this app is deployed by
 * copying it onto a Pi, and the ONNX models in public/ have to come along.
 */
export function modelPath(...parts: string[]): string {
  const base = process.env.JARVIS_MODEL_DIR || path.join(process.cwd(), "public");
  return path.join(/*turbopackIgnore: true*/ base, ...parts);
}

/**
 * Wrap one single-input model file as a `ModelRunner`.
 *
 * Threads are capped at two: the wake word has a whole 80ms to produce a
 * score and a Pi has better things to do with its other cores, like
 * synthesising speech at the same time.
 */
export async function fileRunner(file: string, inputName: string): Promise<ModelRunner> {
  const runtime = await loadRuntime();
  const session = await runtime.InferenceSession.create(file, {
    graphOptimizationLevel: "all",
    intraOpNumThreads: 2,
    interOpNumThreads: 1,
  });

  return {
    async run(input, dims) {
      const output = await session.run({
        [inputName]: new runtime.Tensor("float32", input, dims),
      });
      return Object.values(output)[0].data as Float32Array;
    },
  };
}
