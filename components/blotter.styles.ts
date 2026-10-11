'use client';
import styled from 'styled-components';
export const Page = styled.main`padding: 28px; max-width: 1920px; margin: auto; @media(max-width: 700px) { padding: 12px; }`;
export const Header = styled.header`
  display: flex; justify-content: space-between; gap: 20px; align-items: center;
  h1 { margin: 8px 0; font-size: 28px; letter-spacing: -.8px; }
  p { margin: 6px 0; color: #91a4bf; font-size: 13px; }
  small { color: #5eead4; letter-spacing: 2px; font-weight: bold; }
`;
export const Button = styled.button<{ $primary?: boolean; $danger?: boolean }>`
  border: 1px solid ${p => p.$primary ? '#3b82f6' : '#314057'}; border-radius: 7px;
  padding: 9px 14px; background: ${p => p.$primary ? '#2563eb' : '#172235'};
  color: ${p => p.$danger ? '#fda4af' : '#e2e8f0'}; white-space: nowrap;
  &:hover:not(:disabled) { filter: brightness(1.2); }
`;
export const Toolbar = styled.div`display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin: 20px 0 14px; font-size: 13px; color: #91a4bf;`;
export const Metrics = styled.div`
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 20px 0;
  > div { padding: 16px; border: 1px solid #223149; border-radius: 9px; background: #111b2b; }
  strong { display: block; font-size: 24px; color: #eef6ff; margin-top: 8px; font-variant-numeric: tabular-nums; }
  span { color: #91a4bf; font-size: 12px; }
  @media(max-width:700px) { grid-template-columns: repeat(2, 1fr); }
`;
export const Grid = styled.div`
  overflow: auto; max-height: 65vh; border: 1px solid #26354b; border-radius: 9px; background: #0f1928;
  table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 12px; }
  caption { text-align: left; padding: 12px; color: #91a4bf; }
  thead { position: sticky; top: 0; z-index: 2; background: #172337; }
  th { min-width: 145px; text-align: left; padding: 12px 10px; border-bottom: 1px solid #314057; vertical-align: top; }
  th:first-child { min-width: 180px; }
  th button { background: none; border: none; padding: 0; color: #c3d2e9; width: 100%; text-align: left; margin-bottom: 10px; display: flex; justify-content: space-between; }
  th input:not([type=checkbox]) { width: 100%; padding: 7px 8px; background: #0d1624; color: #dce5f3; border: 1px solid #314057; border-radius: 5px; font-weight: normal; }
  td { white-space: nowrap; padding: 11px 10px; border-bottom: 1px solid #1e2a3c; font-variant-numeric: tabular-nums; }
  td:first-child { color: #93c5fd; font-weight: bold; }
  input[type=checkbox] { accent-color: #3b82f6; margin-right: 10px; }
`;
export const OrderRow = styled.tr<{ $selected: boolean }>`
  background: ${p => p.$selected ? '#183555' : 'transparent'};
  &:hover { background: ${p => p.$selected ? '#204266' : '#152237'}; }
`;
export const Badge = styled.span<{ $value?: string }>`
  display: inline-block; padding: 4px 8px; border-radius: 5px; font-size: 11px; font-weight: bold;
  background: ${p => ['Aceita', 'Executada', 'Compra'].includes(p.$value ?? '') ? '#10382f' : ['Rejeitada', 'Cancelada', 'Venda'].includes(p.$value ?? '') ? '#3e202c' : '#233147'};
  color: ${p => ['Aceita', 'Executada', 'Compra'].includes(p.$value ?? '') ? '#6ee7b7' : ['Rejeitada', 'Cancelada', 'Venda'].includes(p.$value ?? '') ? '#fda4af' : '#a5c7f5'};
`;
export const Footer = styled.footer`display:flex; align-items:center; flex-wrap:wrap; gap:12px; margin-top:16px; color:#91a4bf; font-size:13px;`;
export const Message = styled.div<{ $error?: boolean }>`padding: 12px; border-radius: 7px; margin: 12px 0; white-space: pre-wrap; color: ${p => p.$error ? '#fecdd3' : '#a7f3d0'}; background: ${p => p.$error ? '#351b27' : '#102c28'};`;
export const Menu = styled.div<{ $x: number; $y: number }>`
  position: fixed; z-index: 20; left: ${p => p.$x}px; top: ${p => p.$y}px; width: 240px;
  max-height: calc(100vh - 16px); overflow-y: auto; border: 1px solid #3c4d68; background: #172337; padding: 8px; border-radius: 9px; box-shadow: 0 15px 50px #0008;
  strong { display:block; padding: 8px; color:#91a4bf; font-size:12px; }
  button { display:block; width:100%; text-align:left; background:none; color:#e2e8f0; border:none; padding:11px 10px; border-radius:5px; }
  button:hover:not(:disabled), button:focus { background:#263c59; }
`;
export const Overlay = styled.div`position:fixed; inset:0; background:#0009; z-index:30; display:flex; align-items:center; justify-content:center; padding:20px;`;
export const Dialog = styled.div`
  width: 560px; max-width: 100%; max-height: 90vh; overflow:auto; background:#152135; border:1px solid #3c4d68; border-radius:12px; padding:24px;
  h2 { margin-top:0; font-size:20px; } p { color:#91a4bf; font-size:13px; }
  form { display:grid; gap:14px; }
  label { display:grid; gap:6px; color:#bfcee2; font-size:13px; }
  input, select, textarea { color:#e2e8f0; background:#0d1624; border:1px solid #314057; border-radius:6px; padding:10px; width:100%; }
  input:disabled, select:disabled { opacity:.5; }
  textarea { min-height:70px; }
`;
