import React from 'react'; import { Audio } from 'remotion';
export function AudioTrack({src,volume=1}:{src:string;volume?:number}) { return <Audio src={src} volume={volume}/>; }
