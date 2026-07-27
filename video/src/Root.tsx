import React from "react";
import { AbsoluteFill, Composition, Sequence } from "remotion";
import {
  SceneAlignment,
  SceneClose,
  SceneDay0,
  SceneDay8,
  SceneGrounding,
  SceneIndustries,
  SceneJourney,
  SceneNumbers,
  SceneQuestion,
  SceneReveal,
} from "./scenes";
import { FPS, T, TOTAL_FRAMES } from "./tokens";
import { DayCounter, FadeScene, Grain, ProgressLine } from "./ui";

const BoardCut: React.FC = () => (
  <AbsoluteFill style={{ background: "#0D0A22" }}>
    <Sequence from={T.question.from} durationInFrames={T.question.dur}>
      <FadeScene dur={T.question.dur}><SceneQuestion /></FadeScene>
    </Sequence>
    <Sequence from={T.day0.from} durationInFrames={T.day0.dur}>
      <FadeScene dur={T.day0.dur}><SceneDay0 /></FadeScene>
    </Sequence>
    <Sequence from={T.reveal.from} durationInFrames={T.reveal.dur}>
      <FadeScene dur={T.reveal.dur}><SceneReveal /></FadeScene>
    </Sequence>
    <Sequence from={T.listening.from} durationInFrames={T.listening.dur}>
      <FadeScene dur={T.listening.dur}><SceneAlignment /></FadeScene>
    </Sequence>
    <Sequence from={T.day8.from} durationInFrames={T.day8.dur}>
      <FadeScene dur={T.day8.dur}><SceneDay8 /></FadeScene>
    </Sequence>
    <Sequence from={T.agrees.from} durationInFrames={T.agrees.dur}>
      <FadeScene dur={T.agrees.dur}><SceneGrounding /></FadeScene>
    </Sequence>
    <Sequence from={T.gates.from} durationInFrames={T.gates.dur}>
      <FadeScene dur={T.gates.dur}><SceneJourney /></FadeScene>
    </Sequence>
    <Sequence from={T.day21.from} durationInFrames={T.day21.dur}>
      <FadeScene dur={T.day21.dur}><SceneNumbers /></FadeScene>
    </Sequence>
    <Sequence from={T.industries.from} durationInFrames={T.industries.dur}>
      <FadeScene dur={T.industries.dur}><SceneIndustries /></FadeScene>
    </Sequence>
    <Sequence from={T.close.from} durationInFrames={T.close.dur}>
      <FadeScene dur={T.close.dur}><SceneClose /></FadeScene>
    </Sequence>
    <Grain />
    <DayCounter />
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
