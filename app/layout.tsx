import StyleRegistry from '@/components/StyleRegistry';
export const metadata = { title: 'Blotter offline', description: 'Datatable local com PouchDB e CouchDB' };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="pt-BR"><body><StyleRegistry>{children}</StyleRegistry></body></html>;
}
