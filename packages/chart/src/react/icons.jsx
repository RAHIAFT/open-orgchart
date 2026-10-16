// SPDX-License-Identifier: Apache-2.0
/** The few marks the chart's tools wear: plain strokes on a 24 x 24 grid, coloured by the text around them. */
import React from 'react';

function Icon({ size = 16, className, children, label }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
         className={className} aria-hidden={label ? undefined : 'true'} aria-label={label} role={label ? 'img' : undefined} focusable="false">
      {children}
    </svg>
  );
}

export const Plus = (p) => <Icon {...p}><path d="M12 5v14M5 12h14" /></Icon>;
export const Minus = (p) => <Icon {...p}><path d="M5 12h14" /></Icon>;
export const Close = (p) => <Icon {...p}><path d="M6 6l12 12M18 6L6 18" /></Icon>;
export const Search = (p) => <Icon {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.6-3.6" /></Icon>;
export const Fit = (p) => <Icon {...p}><path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4" /><rect x="8.5" y="8.5" width="7" height="7" rx="1.5" /></Icon>;
export const FullScreen = (p) => <Icon {...p}><path d="M4 10V4h6M20 10V4h-6M4 14v6h6M20 14v6h-6" /></Icon>;
export const Down = (p) => <Icon {...p}><path d="M6 9l6 6 6-6" /></Icon>;
export const Side = (p) => <Icon {...p}><path d="M9 6l6 6-6 6" /></Icon>;
export const Crown = (p) => <Icon {...p}><path d="M4 18h16M5 15L3.5 7.5l5 3.5L12 5l3.5 6 5-3.5L19 15z" /></Icon>;
export const People = (p) => <Icon {...p}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.6 3.3-5.5 6.5-5.5s5.7 1.9 6.5 5.5M16 4.6a3.5 3.5 0 0 1 0 6.8M21.5 20c-.5-2.6-1.8-4.3-3.8-5" /></Icon>;
export const Sliders = (p) => <Icon {...p}><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></Icon>;
export const Download = (p) => <Icon {...p}><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></Icon>;
export const File = (p) => <Icon {...p}><path d="M6 3h8l4 4v14H6zM14 3v4h4" /></Icon>;
export const Picture = (p) => <Icon {...p}><rect x="3.5" y="5" width="17" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M20.5 16l-5-5-8 8" /></Icon>;
export const Table = (p) => <Icon {...p}><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="M3.5 10h17M3.5 14.5h17M10 5v14" /></Icon>;
export const Spinner = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" className="ooc-spin" aria-hidden="true" focusable="false">
    <path d="M21 12a9 9 0 1 1-9-9" />
  </svg>
);
