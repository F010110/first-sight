// Exposes the pure VIO modules to the classic (non-module) app.js.
import { blockFlow, summarizeFlow, grayVariance } from "./vio-flow.js";
import { fuseMotion, describeMotion } from "./motion-fusion.js";

window.VioMotion = { blockFlow, summarizeFlow, grayVariance, fuseMotion, describeMotion };
