import React from 'react';
export function PhotoBackground({src}:{src:string}) { return <img src={src} style={{position:'absolute',inset:-45,width:'calc(100% + 90px)',height:'calc(100% + 90px)',objectFit:'cover',filter:'blur(30px) brightness(.65)',transform:'scale(1.1)'}} />; }
