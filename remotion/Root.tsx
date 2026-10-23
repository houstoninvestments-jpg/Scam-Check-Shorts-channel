import React from "react";
import { Composition } from "remotion";
import { ScamShort } from "./ScamShort";
import type { ShortProps } from "./props";
import { H, W } from "./theme";
import sample from "./sample-props.json";

export const Root: React.FC = () => (
  <Composition
    id="ScamShort"
    component={ScamShort}
    width={W}
    height={H}
    fps={30}
    durationInFrames={900}
    defaultProps={sample as unknown as ShortProps}
    calculateMetadata={({ props }) => ({ durationInFrames: props.timeline.total })}
  />
);
