/** Official UI-Mod CLI probe, not an installed UI Mod or a three-camera exporter.
 * Call with window.inzoi.cli.execute.bind(window.inzoi.cli) in a supported host.
 * No game launch, camera mutation, simulation mutation, or background capture loop.
 */
export async function probeCapabilities(execute, {capture = false} = {}) {
  if (typeof execute !== 'function') throw new TypeError('A real inZOI CLI execute binding is required');
  const receipt = {schema: 'first-sight-inzoi-probe-v1', calls: [], threeCameraVerified: false,
    sameStateVerified: false, pixelsDecoded: false, poseImageAssociationVerified: false};
  const call = async (command, params) => {
    try {
      const response = await execute(command, params);
      receipt.calls.push({command, response, transportResolved: true});
      // Do not infer API success from a resolved Promise; retain the raw result envelope.
      return response;
    } catch (error) {
      receipt.calls.push({command, transportResolved: false, error: String(error)});
      return null;
    }
  };
  await call('camera.get_view');
  if (capture) {
    await call('screenshot.capture', {filename: 'first_sight_probe', show_ui: false, unique_suffix: true});
    // Engine capture is delayed. One status read only; never label request as saved.
    await call('screenshot.get_last');
    await call('camera.get_view');
  }
  return receipt;
}
