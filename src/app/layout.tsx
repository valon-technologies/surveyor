import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/layout/providers";
import { AppShell } from "@/components/layout/app-shell";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Surveyor — Field-Level Data Mapping Studio",
  description: "Map fields between source and target schemas with LLM-assisted traceability",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('theme');if(t==='vaporwave'){var e=document.documentElement;e.dataset.theme='vaporwave';var v={'--color-background':'#0d0d14','--color-foreground':'#e2d9f3','--color-muted':'#1a1028','--color-muted-foreground':'#9b8bb8','--color-border':'#2d1b69','--color-input':'#2d1b69','--color-ring':'#c084fc','--color-primary':'#c084fc','--color-primary-foreground':'#0d0d14','--color-secondary':'#1a1028','--color-secondary-foreground':'#e2d9f3','--color-accent':'#2d1b4e','--color-accent-foreground':'#f472b6','--color-destructive':'#ff3366','--color-destructive-foreground':'#0d0d14','--color-card':'#13131f','--color-card-foreground':'#e2d9f3','--color-popover':'#13131f','--color-popover-foreground':'#e2d9f3','--color-sidebar':'#0a0a12','--color-sidebar-foreground':'#e2d9f3','--color-sidebar-border':'#2d1b69','--color-sidebar-accent':'#1a1028','--color-sidebar-accent-foreground':'#c084fc'};for(var k in v)e.style.setProperty(k,v[k]);}}catch(e){}` }} />
      </head>
      <body className={inter.className}>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
