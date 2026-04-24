"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";

/**
 * Invisible 1×1 node that serves as a dead-end target for actions that
 * don't connect to another letter. The edge component paints the circle
 * terminator; this node just provides coordinates xyflow can route to.
 */
function StubTargetNode(_props: NodeProps) {
  return (
    <div style={{ width: 1, height: 1 }}>
      <Handle
        type="target"
        position={Position.Left}
        isConnectable={false}
        className="!h-1 !w-1 !border-none !bg-transparent"
      />
    </div>
  );
}

export default memo(StubTargetNode);
