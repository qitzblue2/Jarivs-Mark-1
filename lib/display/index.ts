import { powerStatus, setPower } from "./cec";
import * as state from "./state";
import type { Display, DisplayContent, DisplayStatus, DisplayView, PowerStatus } from "./types";

export type {
  Display,
  DisplayContent,
  DisplayEvent,
  DisplayStatus,
  DisplayView,
  PowerStatus,
} from "./types";
export { subscribe, ping, connectedCount, resetDisplayState } from "./state";

/**
 * The HDMI display: a kiosk browser on the Pi, plus CEC for the projector.
 *
 * Content reaches the browser over SSE; power goes down the HDMI cable. The
 * two are independent on purpose — a blank screen on a powered projector and
 * a picture sent to a projector that is off are both states worth being able
 * to reach and to report.
 */
class HdmiDisplay implements Display {
  async show(content: DisplayContent): Promise<void> {
    state.setContent(content);
  }

  async clear(): Promise<void> {
    state.setContent(null);
  }

  async setView(view: DisplayView): Promise<void> {
    state.setView(view);
  }

  async power(on: boolean): Promise<PowerStatus> {
    return setPower(on);
  }

  async status(): Promise<DisplayStatus> {
    return {
      connected: state.connectedCount(),
      content: state.currentContent(),
      view: state.currentView(),
      since: state.contentSince(),
      power: await powerStatus(),
    };
  }
}

export const display: Display = new HdmiDisplay();

/**
 * Is anything actually going to see this?
 *
 * Worth asking before a tool claims success: pushing content with no display
 * connected succeeds at every technical level and shows nobody anything, and
 * a model told "done" will not mention it.
 */
export function displayConnected(): boolean {
  return state.connectedCount() > 0;
}
