// SPDX-License-Identifier: Apache-2.0
import React from 'react';
import { makeT, numberText } from './words.js';

/** The reader's words and digits, for every part of one chart. */
export const ChartWords = React.createContext({ t: makeT('en'), language: 'en', num: (n) => numberText(n, 'en') });

export const useWords = () => React.useContext(ChartWords);
