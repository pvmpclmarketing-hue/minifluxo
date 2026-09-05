import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import type { TransitionPreset } from './types';
export function Transition({type}:{type:TransitionPreset}) { const frame=useCurrentFrame(); const opacity=interpolate(frame,[0,16],[0,1],{extrapolateRight:'clamp'}); return <div style={{position:'absolute',inset:0,opacity,backdropFilter:type==='blur_dissolve'?'blur(4px)':undefined,transform:type==='scale_dissolve'?`scale(${interpolate(frame,[0,16],[1.04,1])})`:undefined}}/>; }
