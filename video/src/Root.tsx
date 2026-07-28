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
  SceneTeam,
  SceneValue,
} from "./scenes";
import { FPS, T, TOTAL_FRAMES } from "./tokens";
import { FadeScene, Grain, ProgressLine } from "./ui";

const BoardCut: React.FC = () => (
  <AbsoluteFill style={{ background: "#0D0A22" }}>
    <Sequence from={T.seg1.from} durationInFrames={T.seg1.dur}>
      <FadeScene dur={T.seg1.dur}><SceneQuestion /></FadeScene>
    </Sequence>
    <Sequence from={T.seg2.from} durationInFrames={T.seg2.dur}>
      <FadeScene dur={T.seg2.dur}><SceneDiagnosis /></FadeScene>
    </Sequence>
    <Sequence from={T.seg3.from} durationInFrames={T.seg3.dur}>
      <FadeScene dur={T.seg3.dur}><SceneReveal /></FadeScene>
    </Sequence>
    <Sequence from={T.seg4.from} durationInFrames={T.seg4.dur}>
      <FadeScene dur={T.seg4.dur}><SceneAlignment /></FadeScene>
    </Sequence>
    <Sequence from={T.seg5.from} durationInFrames={T.seg5.dur}>
      <FadeScene dur={T.seg5.dur}><SceneGrounding /></FadeScene>
    </Sequence>
    <Sequence from={T.seg6.from} durationInFrames={T.seg6.dur}>
      <FadeScene dur={T.seg6.dur}><SceneJourney /></FadeScene>
    </Sequence>
    <Sequence from={T.seg7.from} durationInFrames={T.seg7.dur}>
      <FadeScene dur={T.seg7.dur}><SceneNumbers /></FadeScene>
    </Sequence>
    <Sequence from={T.seg8.from} durationInFrames={T.seg8.dur}>
      <FadeScene dur={T.seg8.dur}><SceneIndustries /></FadeScene>
    </Sequence>
    <Sequence from={T.seg9.from} durationInFrames={T.seg9.dur}>
      <FadeScene dur={T.seg9.dur}><SceneValue /></FadeScene>
    </Sequence>
    <Sequence from={T.seg10.from} durationInFrames={T.seg10.dur}>
      <FadeScene dur={T.seg10.dur}><SceneClose /></FadeScene>
    </Sequence>
    <Sequence from={T.seg11.from} durationInFrames={T.seg11.dur}>
      <FadeScene dur={T.seg11.dur}><SceneTeam /></FadeScene>
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
