import { WakeWordPipeline, type WakeModels } from "../wake/pipeline";
import { fileRunner, modelPath } from "./onnx";

/**
 * "Hey JARVIS" on the device itself.
 *
 * Identical to the browser detector — same three model files, same pipeline
 * class — with onnxruntime-node reading them off disk instead of the browser
 * fetching them over HTTP. On a Pi 3 a single core runs this comfortably in
 * real time, which is what makes always-on listening free.
 */
async function loadModels(): Promise<WakeModels> {
  const [mel, embedding, wake] = await Promise.all([
    fileRunner(modelPath("models", "wake", "melspectrogram.onnx"), "input"),
    fileRunner(modelPath("models", "wake", "embedding_model.onnx"), "input_1"),
    fileRunner(modelPath("models", "wake", "hey_jarvis_v0.1.onnx"), "x.1"),
  ]);
  return { mel, embedding, wake };
}

export class DeviceWakeWord extends WakeWordPipeline {
  constructor() {
    super(loadModels);
  }
}
