import React from 'react'; import { Composition, registerRoot } from 'remotion'; import { MusicVideo } from './MusicVideo'; import { createTimeline } from './timeline'; import sample from '../../sample-data.json';
const timeline=createTimeline({audioUrl:sample.audio_url,photos:sample.photos,lyrics:sample.lyrics,lyricsTimestamps:sample.lyrics_timestamps,introText:sample.intro_text});
export const RemotionRoot=()=> <Composition id="MusicVideo" component={MusicVideo} durationInFrames={1800} fps={30} width={1080} height={1920} defaultProps={{timeline}} calculateMetadata={({props})=>({durationInFrames:Math.max(1,Math.ceil(props.timeline.duration*props.timeline.fps))})}/>;
registerRoot(RemotionRoot);
