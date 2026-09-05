import React from 'react'; import { AbsoluteFill, Sequence } from 'remotion'; import { AnimatedCaption } from './AnimatedCaption';
export function IntroText({text}:{text?:string|null}) { return text?<Sequence from={60} durationInFrames={90}><AbsoluteFill style={{justifyContent:'center',alignItems:'center'}}><AnimatedCaption text={text} animation="instagram"/></AbsoluteFill></Sequence>:null; }
