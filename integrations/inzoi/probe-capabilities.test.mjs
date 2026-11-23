import {test} from 'node:test';
import assert from 'node:assert/strict';
import {probeCapabilities} from './probe-capabilities.mjs';

test('default probe reads view only; never captures or certifies runtime', async () => {
  const calls = [];
  const receipt = await probeCapabilities(async command => {calls.push(command); return {mock: true};});
  assert.deepEqual(calls, ['camera.get_view']);
  assert.equal(receipt.threeCameraVerified, false);
  assert.equal(receipt.pixelsDecoded, false);
});
test('opt-in capture uses unique filename and preserves asynchronous pending status', async () => {
  const calls = [];
  const receipt = await probeCapabilities(async (command, params) => {
    calls.push({command, params}); return {pending: true, saved: false};
  }, {capture: true});
  assert.equal(calls.length, 4);
  assert.equal(calls[1].params.unique_suffix, true);
  assert.equal(calls[1].params.show_ui, false);
  assert.equal(receipt.calls[2].response.saved, false);
  assert.equal(receipt.poseImageAssociationVerified, false);
});
test('unavailable APIs remain errors, not fabricated success', async () => {
  const receipt = await probeCapabilities(async () => {throw Error('Unavailable B1Standalone');});
  assert.equal(receipt.calls[0].transportResolved, false);
  assert.equal(receipt.sameStateVerified, false);
});
