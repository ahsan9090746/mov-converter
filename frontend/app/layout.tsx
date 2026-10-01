import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Convert MOV to MP4 Online - Free MOV to MP4 Converter',
  description:
    'Convert MOV videos to MP4 online quickly and easily. Upload your MOV file and download a compatible MP4 video.',
  openGraph: {
    title: 'Convert MOV to MP4 Online - Free MOV to MP4 Converter',
    description:
      'Convert MOV videos to MP4 online quickly and easily. Upload your MOV file and download a compatible MP4 video.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans">{children}</body>
    </html>
  );
}
