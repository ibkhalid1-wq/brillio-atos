import React from "react";
import { AbsoluteFill, Composition, Sequence } from "remotion";
import {
  SceneAlignment,
  SceneIndustries,
  SceneJourney,
  SceneClose,
  SceneGrounding,
  SceneNumbers,
  SceneQuestion,
  SceneReveal,
} from "./scenes";
import { FPS, T, TOTAL_FRAMES } from "./tokens";

const BoardCut: React.FC = () => (
  <AbsoluteFill style={{ background: "#0D0A22" }}>
    <Sequence from={T.question.from} durationInFrames={T.question.dur}>
      <SceneQuestion />
    </Sequence>
    <Sequence from={T.reveal.from} durationInFrames={T.reveal.dur}>
      <SceneReveal />
    </Sequence>
    <Sequence from={T.grounding.from} durationInFrames={T.grounding.dur}>
      <SceneGrounding />
    </Sequence>
    <Sequence from={T.alignment.from} durationInFrames={T.alignment.dur}>
      <SceneAlignment />
    </Sequence>
    <Sequence from={T.journey.from} durationInFrames={T.journey.dur}>
      <SceneJourney />
    </Sequence>
    <Sequence from={T.numbers.from} durationInFrames={T.numbers.dur}>
      <SceneNumbers />
    </Sequence>
    <Sequence from={T.industries.from} durationInFrames={T.industries.dur}>
      <SceneIndustries />
    </Sequence>
    <Sequence from={T.close.from} durationInFrames={T.close.dur}>
      <SceneClose />
    </Sequence>
  </AbsoluteFill>
);

export const RemotionRoot: React.FC = () => (
  <Composition
    id="BoardCut90"
    component={BoardCut}
    durationInFrames={TOTAL_FRAMES}
    fps={FPS}
    width={1920}
    height={1080}
  />
);
