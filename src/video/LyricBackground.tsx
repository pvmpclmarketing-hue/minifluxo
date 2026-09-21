import React from 'react';
import { AbsoluteFill, Img, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

export function LyricBackground({src}:{src:string}) {
  const frame=useCurrentFrame();
  const {durationInFrames}=useVideoConfig();
  const progress=interpolate(frame,[0,Math.max(1,durationInFrames)],[0,1],{extrapolateRight:'clamp'});
  return <AbsoluteFill style={{overflow:'hidden',background:'#120c10'}}>
    <Img src={src} style={{width:'100%',height:'100%',objectFit:'cover',transform:`scale(${1.035+progress*.055}) translate(${progress*-1.4}%,${progress*-1.8}%)`}} />
    <AbsoluteFill style={{background:'linear-gradient(180deg, rgba(10,5,11,.26), rgba(10,5,11,.44) 48%, rgba(8,4,7,.64))'}} />
  </AbsoluteFill>;
}
