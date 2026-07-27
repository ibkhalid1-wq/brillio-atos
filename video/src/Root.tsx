import React from "react";
import { AbsoluteFill, Composition, Sequence } from "remotion";
import {
  SceneAlignment,
  SceneClose,
  SceneDiagnosis,
  SceneGrounding,
  SceneIndustries,
  SceneJourney,
  SceneNumbers,
  SceneQuestion,
  SceneReveal,
} from "./scenes";
import { FPS, T, TOTAL_FRAMES } from "./tokens";
import { FadeScene, Grain, ProgressLine } from "./ui";

const BoardCut: React.FC = () => (
  <AbsoluteFill style={{ background: "#0D0A22" }}>
    <Sequence from={T.question.from} durationInFrames={T.question.dur}>
      <FadeScene dur={T.question.dur}><SceneQuestion /></FadeScene>
    </Sequence>
    <Sequence from={T.diagnosis.from} durationInFrames={T.diagnosis.dur}>
      <FadeScene dur={T.diagnosis.dur}><SceneDiagnosis /></FadeScene>
    </Sequence>
    <Sequence from={T.reveal.from} durationInFrames={T.reveal.dur}>
      <FadeScene dur={T.reveal.dur}><SceneReveal /></FadeScene>
    </Sequence>
    <Sequence from={T.alignment.from} durationInFrames={T.alignment.dur}>
      <FadeScene dur={T.alignment.dur}><SceneAlignment /></FadeScene>
    </Sequence>
    <Sequence from={T.grounding.from} durationInFrames={T.grounding.dur}>
      <FadeScene dur={T.grounding.dur}><SceneGrounding /></FadeScene>
    </Sequence>
    <Sequence from={T.journey.from} durationInFrames={T.journey.dur}>
      <FadeScene dur={T.journey.dur}><SceneJourney /></FadeScene>
    </Sequence>
    <Sequence from={T.numbers.from} durationInFrames={T.numbers.dur}>
      <FadeScene dur={T.numbers.dur}><SceneNumbers /></FadeScene>
    </Sequence>
    <Sequence from={T.industries.from} durationInFrames={T.industries.dur}>
      <FadeScene dur={T.industries.dur}><SceneIndustries /></FadeScene>
    </Sequence>
    <Sequence from={T.close.from} durationInFrames={T.close.dur}>
      <FadeScene dur={T.close.dur}><SceneClose /></FadeScene>
    </Sequence>
    <Grain />
    <ProgressLine total={TOTAL_FRAMES} />
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
