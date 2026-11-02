import type {AgentMessage} from '@earendil-works/pi-agent-core';
import type {SpatialCheckpoint} from './spatial-session.js';
export type SpatialContextVersion=Pick<SpatialCheckpoint,'observationId'|'atMs'|'index'|'tipId'|'contextPath'|'contextSHA256'|'memoryRef'>;

/** Shared evolving spatial module. The user-question transcript is owned separately by Pi. */
export class SpatialContextModule {
 private latest:SpatialContextVersion|null=null;
 publish(value:SpatialContextVersion){
  if(this.latest&&(value.index<=this.latest.index||value.atMs<this.latest.atMs))throw Error('Spatial context version regression');
  this.latest=structuredClone(value);
 }
 snapshot(){if(!this.latest)throw Error('Spatial context not ready');return structuredClone(this.latest);}
}

/** Projection only: never copies spatial entries into or writes question entries back to space. */
export function composeSessionContext(spatial:readonly AgentMessage[],questions:readonly AgentMessage[]):AgentMessage[]{
 return [...structuredClone(spatial),...structuredClone(questions)];
}
