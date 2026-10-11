'use client';
import { useState } from 'react';
import { useServerInsertedHTML } from 'next/navigation';
import { ServerStyleSheet, StyleSheetManager, createGlobalStyle } from 'styled-components';
const GlobalStyle = createGlobalStyle`
  * { box-sizing: border-box; }
  html { scrollbar-width: none; }
  html::-webkit-scrollbar { display: none; }
  body { margin: 0; background: #090f1a; color: #dce5f3; font-family: Arial, Helvetica, sans-serif; }
  button, input, select, textarea { font: inherit; }
  button { cursor: pointer; } button:disabled { cursor: default; opacity: .4; }
  :focus-visible { outline: 2px solid #60a5fa; outline-offset: 3px; }
`;
export default function StyleRegistry({ children }: { children: React.ReactNode }) {
  const [sheet] = useState(() => new ServerStyleSheet());
  useServerInsertedHTML(() => {
    const styles = sheet.getStyleElement(); sheet.instance.clearTag(); return <>{styles}</>;
  });
  if (typeof window !== 'undefined') return <><GlobalStyle />{children}</>;
  return <StyleSheetManager sheet={sheet.instance}><GlobalStyle />{children}</StyleSheetManager>;
}
