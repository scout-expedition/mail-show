"use client";

import { memo } from "react";
import { Handle, Position } from "@xyflow/react";

const HIT = 24;

/**
 * Per-edge target node minted in edit mode for every arrow-terminator
 * edge. Lets two converging edges sit at distinct X positions on a
 * letter/report's top edge AND remain independently grab-able for
 * drag-to-reconnect — the parent letter/report's own target Handle is
 * only 8px wide, so when two arrows converge there is no way to grab the
 * second edge from the underlying node alone.
 *
 * Node footprint is 1×1; the Handle paints a 24×24 invisible hit zone
 * centered on the node's anchor (the visible circle is drawn by the edge
 * via EdgeLabelRenderer, not here).
 */
function EndpointTargetNode() {
  return (
    <div style={{ width: 1, height: 1, position: "relative" }}>
      <Handle
        type="target"
        position={Position.Top}
        // Drop-only: receives reconnect drops for this specific edge, but
        // never starts a new connection drag.
        isConnectable
        isConnectableStart={false}
        style={{
          width: HIT,
          height: HIT,
          minWidth: HIT,
          minHeight: HIT,
          borderRadius: "50%",
          background: "transparent",
          border: "none",
          top: 0,
          left: 0,
          transform: "translate(-50%, -50%)",
        }}
      />
    </div>
  );
}

export default memo(EndpointTargetNode);
